use crate::wallet::*;
use ed25519_dalek::SigningKey;
use serde_json::json;
pub struct SolanaWallet {
    signer: SigningKey,
    network: Network,
    approved: String,
    wallet: AgentWallet,
    pub activity: Vec<WalletEvent>,
}
impl SolanaWallet {
    pub fn new(signer: SigningKey, network: Network, approved: String) -> Result<Self, String> {
        if network == Network::Local && std::env::var("LOCAL_GENESIS_HASH").ok().is_none_or(|hash| hash.trim().is_empty()) {
            return Err("Local wallet requires an explicit LOCAL_GENESIS_HASH".into());
        }
        let genesis = rpc_on(&network, "getGenesisHash", json!([]))?;
        let valid = match network {
            Network::Devnet => genesis.as_str() == Some(DEVNET_GENESIS),
            Network::Local => std::env::var("LOCAL_GENESIS_HASH")
                .ok()
                .is_some_and(|expected| {
                    genesis.as_str() == Some(&expected) && expected != DEVNET_GENESIS
                }),
        };
        if !valid {
            return Err(
                "Unexpected test-network genesis; local requires LOCAL_GENESIS_HASH".into(),
            );
        }
        let wallet = AgentWallet {
            address: address(&signer),
            balance: 0,
            spending_limit: 1_000_000,
            mode: match network {
                Network::Devnet => WalletMode::Devnet,
                Network::Local => WalletMode::Local,
            },
        };
        let mut result = Self {
            signer,
            network,
            approved,
            wallet,
            activity: vec![],
        };
        result.refresh()?;
        Ok(result)
    }
    pub fn refresh(&mut self) -> Result<(), String> {
        self.wallet.balance = rpc_on(
            &self.network,
            "getBalance",
            json!([self.wallet.address,{"commitment":"confirmed"}]),
        )?["value"]
            .as_u64()
            .ok_or("Invalid balance")?;
        Ok(())
    }
    fn event(
        &mut self,
        kind: &str,
        amount: u64,
        reason: &str,
        signature: Option<String>,
    ) -> WalletEvent {
        let e = WalletEvent {
            seq: self.activity.len(),
            turn: 0,
            kind: kind.into(),
            address: self.wallet.address.clone(),
            amount,
            reason: reason.into(),
            signature,
        };
        self.activity.push(e.clone());
        e
    }
    fn send(&mut self, destination: &str, amount: u64) -> Result<WalletEvent, String> {
        self.refresh()?;
        let hash = rpc_on(
            &self.network,
            "getLatestBlockhash",
            json!([{"commitment":"confirmed"}]),
        )?["value"]["blockhash"]
            .as_str()
            .ok_or("Invalid blockhash")?
            .to_owned();
        let message = transfer_message(&self.wallet.address, destination, &hash, amount)?;
        let fee = rpc_on(
            &self.network,
            "getFeeForMessage",
            json!([base64(&message),{"commitment":"confirmed"}]),
        )?["value"]
            .as_u64()
            .ok_or("Expired fee estimate")?;
        if self.wallet.balance < required_balance(amount, fee)? {
            return Err("Insufficient test funds, fee and reserve".into());
        }
        let wire = signed_transaction(&self.signer, &message);
        let simulation = rpc_on(
            &self.network,
            "simulateTransaction",
            json!([base64(&wire),{"encoding":"base64","commitment":"confirmed","sigVerify":true}]),
        )?;
        if !simulation["value"]["err"].is_null() {
            return Err(format!(
                "Simulation rejected: {}",
                simulation["value"]["err"]
            ));
        }
        self.event(
            "WalletTransactionRequested",
            amount,
            "Approved test transfer; simulation passed",
            None,
        );
        // Reserve before submission: transport failure can hide a successful send.
        let signature = submit_with_reservation(&mut self.wallet, amount, || {
            rpc_on(&self.network,"sendTransaction",json!([base64(&wire),{"encoding":"base64","preflightCommitment":"confirmed","maxRetries":2}]))?
                .as_str().map(str::to_owned).ok_or_else(|| "Invalid signature".into())
        })?;
        confirm(&self.network, &signature)?;
        self.refresh()?;
        self.event(
            "WalletNetworkFee",
            fee,
            "Network fee separate from reward",
            Some(signature.clone()),
        );
        Ok(self.event(
            "WalletTransactionConfirmed",
            amount,
            "Confirmed capped test-network transfer",
            Some(signature),
        ))
    }
}
fn required_balance(amount: u64, fee: u64) -> Result<u64, String> {
    amount.checked_add(fee).and_then(|total| total.checked_add(890_880))
        .ok_or_else(|| "Invalid fee estimate: balance requirement overflow".into())
}
fn submit_with_reservation(wallet: &mut AgentWallet, amount: u64, submit: impl FnOnce() -> Result<String, String>) -> Result<String, String> {
    wallet.spending_limit = wallet.spending_limit.checked_sub(amount).ok_or("Wallet spending budget exhausted")?;
    submit()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fee_overflow_cannot_bypass_reserve() {
        assert_eq!(required_balance(1_000_000, 5_000).unwrap(), 1_895_880);
        assert!(required_balance(1_000_000, u64::MAX).is_err());
        assert!(required_balance(1_000_000, u64::MAX - 1_000_000).is_err());
    }
    #[test]
    fn uncertain_submission_cannot_retry_the_same_spending_budget() {
        let mut wallet = mock_view(42, "agent");
        assert!(submit_with_reservation(&mut wallet, 1_000_000, || Err("Receipt lost after submission".into())).is_err());
        assert_eq!(wallet.spending_limit, 0);
        assert!(submit_with_reservation(&mut wallet, 1, || panic!("Exhausted budget must not submit")).is_err());
    }
}
impl WalletCapability for SolanaWallet {
    fn view(&self) -> AgentWallet {
        self.wallet.clone()
    }
    fn transfer(&mut self, destination: &str, amount: u64) -> Result<WalletEvent, String> {
        if destination != self.approved
            || amount == 0
            || amount > self.wallet.spending_limit
            || amount > 1_000_000
        {
            return Err("Wallet policy denied recipient or spending budget".into());
        }
        let result = self.send(destination, amount);
        if let Err(error) = &result {
            self.event("WalletTransactionFailed", amount, error, None);
        }
        result
    }
}
pub fn confirm(network: &Network, signature: &str) -> Result<(), String> {
    for _ in 0..20 {
        let result = rpc_on(
            network,
            "getSignatureStatuses",
            json!([[signature],{"searchTransactionHistory":true}]),
        )?;
        let s = &result["value"][0];
        if !s["err"].is_null() {
            return Err(format!("Transaction failed: {}", s["err"]));
        }
        if matches!(
            s["confirmationStatus"].as_str(),
            Some("confirmed" | "finalized")
        ) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Err(format!(
        "Confirmation timed out; check {signature} before retrying"
    ))
}
