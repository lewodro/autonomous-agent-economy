//! Durable authoritative host. All funded admission/settlement uses this service, including labs.
use super::{
    attestation::*, backend_escrow::TrustedBackendEscrow, backend_rail::BackendRail,
    coordinator::EconomyCoordinator, durable_rail::now, escrow::MatchEscrow,
    host_config::FundedMatchConfig, lifecycle::EconomyState, local_signer::LocalDevSigner,
    primitives::*, rail::*, records::*, refund::RefundReason, repository::*,
};
use crate::{
    engine,
    model::{Decision, Replay},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct HostSnapshot {
    pub(super) format: u32,
    pub(super) session: OperationId,
    pub(super) config: FundedMatchConfig,
    pub(super) simulation: Replay,
    pub(super) economy: EconomyCoordinator<BackendRail, TrustedBackendEscrow>,
    pub(super) funding_deadline: u64,
    pub(super) attestation: Option<CompletionAttestation>,
    pub(super) settlement: Option<SettlementRecord>,
    pub(super) cancellation: Option<RefundReason>,
}
pub struct FundedHost {
    pub(super) root: PathBuf,
    pub(super) repository: JsonRepository,
    pub(super) snapshot: HostSnapshot,
}
impl FundedHost {
    pub fn load(root: &Path, session: &str) -> Result<Self> {
        let id = OperationId::new(session)?;
        let directory = root.join("sessions").join(id.as_str());
        if !directory.exists() {
            return Err(EconomyError::InvalidInput(
                "Funded session not found".into(),
            ));
        }
        let repository = JsonRepository::open(directory)?;
        let snapshot: HostSnapshot = repository
            .read("host")?
            .ok_or_else(|| EconomyError::InvalidInput("Funded session not found".into()))?;
        if snapshot.format != 1 || snapshot.session != id {
            return Err(EconomyError::Conflict);
        }
        snapshot.config.validate()?;
        let policy = snapshot.config.economy.validate()?;
        if policy.entry != snapshot.economy.view().entry_amount
            || policy.mode != snapshot.economy.rail.mode()
            || snapshot.economy.view().match_id != snapshot.economy.binding.run_id(&id)?
            || snapshot.config.simulation != snapshot.simulation.config
            || snapshot.config.economy.mode != snapshot.economy.view().payment_mode
        {
            return Err(EconomyError::Conflict);
        }
        if matches!(
            snapshot.economy.view().state,
            EconomyState::SettlementPending | EconomyState::Settled
        ) && (snapshot.attestation.is_none() || snapshot.settlement.is_none())
        {
            return Err(EconomyError::InvalidAttestation);
        }
        if let Some(record) = &snapshot.settlement {
            let view = snapshot.economy.view();
            let pot = view
                .entry_amount
                .multiply(view.required_agents.len() as u64)?;
            let expected_id = operation_id(
                &view.match_id,
                PaymentPurpose::Payout,
                &snapshot.economy.escrow.status()?.account,
                &AccountId::new(record.winner_id.as_str())?,
            )?;
            if record.settlement_id != expected_id
                || record.match_id != view.match_id
                || Some(record.winner_id.as_str()) != snapshot.simulation.winner.as_deref()
                || record.pot_amount != pot
                || record.payout_amount != pot
                || record.fee_amount != Amount::ZERO
                || record.payment_rail != view.payment_mode
            {
                return Err(EconomyError::SettlementNotAuthorized);
            }
        }
        snapshot.economy.validate_recovery(&snapshot.simulation)?;
        let mut host = Self {
            root: root.into(),
            repository,
            snapshot,
        };
        if let Some(a) = &host.snapshot.attestation {
            host.authority()?.verify(
                &host.snapshot.economy.view().match_id,
                &host.snapshot.simulation,
                a,
            )?;
        }
        host.snapshot.economy.rail.reload()?;
        Ok(host)
    }
    pub fn list(root: &Path) -> Result<Vec<String>> {
        let directory = root.join("sessions");
        let entries = match std::fs::read_dir(directory) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(EconomyError::AdapterFailure(e.to_string())),
        };
        let mut sessions = vec![];
        for entry in entries {
            let e = entry.map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
            if e.file_type()
                .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?
                .is_dir()
            {
                let s = e.file_name().to_string_lossy().to_string();
                OperationId::new(&s)?;
                let repo = JsonRepository::open(e.path())?;
                let complete = repo.read::<HostSnapshot>("host")?.is_some();
                drop(repo);
                if complete {
                    let h = Self::load(root, &s)?;
                    sessions.push(h.snapshot.session.as_str().into());
                }
            }
        }
        sessions.sort();
        Ok(sessions)
    }
    /// Remove a host created by a failed admission setup, but only before it can hold funds.
    pub fn discard_unfunded(root: &Path, session: &str) -> Result<bool> {
        let id = OperationId::new(session)?;
        let directory = root.join("sessions").join(id.as_str());
        if !directory.exists() {
            return Ok(false);
        }
        let host = Self::load(root, session)?;
        let view = host.snapshot.economy.view();
        if !matches!(view.state, EconomyState::Unfunded | EconomyState::Funding)
            || !host.snapshot.economy.rail.records().is_empty()
            || !view.funded_agents.is_empty()
            || view.pot_amount != Amount::ZERO
            || host.snapshot.simulation.final_state.turn != 0
            || host.snapshot.simulation.final_state.ended
            || host.snapshot.attestation.is_some()
            || host.snapshot.settlement.is_some()
            || host.snapshot.cancellation.is_some()
        {
            return Err(EconomyError::Conflict);
        }
        drop(host);
        std::fs::remove_dir_all(&directory)
            .map_err(|error| EconomyError::StorageFailure(error.to_string()))?;
        std::fs::File::open(directory.parent().ok_or(EconomyError::Conflict)?)
            .and_then(|folder| folder.sync_all())
            .map_err(|error| EconomyError::StorageFailure(error.to_string()))?;
        Ok(true)
    }
    pub(super) fn save(&mut self) -> Result<()> {
        self.observe_payment_events()?;
        self.repository.write("host", &self.snapshot)
    }
    fn authority(&self) -> Result<HostAuthority> {
        Ok(LocalDevSigner::load_or_create(
            &self.root.join("host-authority.wallet.bin"),
            AgentId::new("host-authority")?,
        )?
        .authority())
    }
    pub fn replay(&self) -> &Replay {
        &self.snapshot.simulation
    }
    pub fn view(&self) -> Value {
        let economy = self.snapshot.economy.view();
        let mut rpc_ready = true;
        let mut wallets = vec![];
        let addresses = self.snapshot.economy.rail.addresses();
        let mut ids: Vec<_> = economy
            .required_agents
            .iter()
            .map(|id| AccountId::new(id.as_str()).unwrap())
            .chain(std::iter::once(
                self.snapshot.economy.escrow.status().unwrap().account,
            ))
            .collect();
        if addresses.contains_key(&AccountId::new("fee-sponsor").unwrap()) {
            ids.push(AccountId::new("fee-sponsor").unwrap());
        }
        for id in ids {
            let result = if rpc_ready {
                self.snapshot.economy.rail.get_balance(&id)
            } else {
                Err(EconomyError::RpcUnavailable("RPC unavailable".into()))
            };
            if result.is_err() {
                rpc_ready = false;
            }
            let address = addresses.get(&id);
            let explorer_url = if economy.payment_mode == super::config::PaymentMode::Devnet {
                address
                    .map(|address| format!("https://solscan.io/account/{address}?cluster=devnet"))
            } else {
                None
            };
            wallets.push(json!({"account":id,"address":address,"balance":result.ok(),"explorer_url":explorer_url}));
        }
        let operations:Vec<_>=self.snapshot.economy.rail.records().values().map(|r|{
            let reference=r.receipt.as_ref().and_then(|r|r.external_reference.clone()).or_else(||r.prepared.as_ref().and_then(|p|serde_json::from_str::<super::local_transaction::SignedLocalTransfer>(&p.authorization).ok().map(|s|s.reference)));
            let explorer_url=if economy.payment_mode==super::config::PaymentMode::Devnet {reference.as_ref().map(|signature|format!("https://solscan.io/tx/{signature}?cluster=devnet"))}else{None};
            json!({"id":r.intent.operation_id,"purpose":r.intent.purpose,"payer":r.intent.payer,"payee":r.intent.payee,"amount":r.intent.amount,"status":r.status,"created_at":r.created_at,"updated_at":r.updated_at,"retry_count":r.retry_count,"next_retry_at":r.next_retry_at,"reference":reference,"explorer_url":explorer_url,"error":r.last_error})
        }).collect();
        json!({"session":self.snapshot.session,"economy":economy,"events":self.snapshot.economy.events(),"wallets":wallets,"operations":operations,"settlement":self.snapshot.settlement,"attestation":self.snapshot.attestation,"funding_deadline":self.snapshot.funding_deadline,"expected_pot":economy.entry_amount.multiply(economy.required_agents.len() as u64).unwrap(),"health":super::health::EconomyHealth::observed(economy.payment_mode,economy.state,rpc_ready,self.snapshot.economy.rail.records().values())})
    }
    fn admit(&mut self) -> Result<()> {
        if self.snapshot.economy.view().state == EconomyState::Funded {
            // A saved cancellation must finish its original refund, never admit a game.
            if self.snapshot.cancellation.is_some() {
                return Err(EconomyError::InvalidTransition(
                    "Cancellation is pending; resume the original refund before admission".into(),
                ));
            }
            // Read-only reconciliation cannot admit a late deposit or initiate refunds.
            if now() >= self.snapshot.funding_deadline {
                return Err(EconomyError::FundingClosed);
            }
            self.snapshot.economy.lock()?;
            self.snapshot.economy.start()?;
            self.save()?;
        }
        Ok(())
    }
    pub fn prepare_entry(&mut self, agent: &str) -> Result<Value> {
        if self.snapshot.economy.view().state != EconomyState::Funding
            || now() >= self.snapshot.funding_deadline
        {
            return Err(EconomyError::FundingClosed);
        }
        let a = AgentId::new(agent)?;
        if !self.snapshot.economy.view().required_agents.contains(&a) {
            return Err(EconomyError::WrongRecipient);
        }
        let view = self.snapshot.economy.view();
        let payer = AccountId::new(agent)?;
        let payee = self.snapshot.economy.escrow.status()?.account;
        let intent = PaymentIntent {
            operation_id: operation_id(&view.match_id, PaymentPurpose::Entry, &payer, &payee)?,
            match_id: view.match_id,
            payer,
            payee,
            amount: view.entry_amount,
            purpose: PaymentPurpose::Entry,
        };
        self.snapshot.economy.rail.prepare_payment(intent)?;
        self.save()?;
        Ok(self.view())
    }
    pub fn fund(&mut self, agent: &str) -> Result<Value> {
        if now() >= self.snapshot.funding_deadline
            && self.snapshot.economy.view().state == EconomyState::Funding
        {
            self.cancel(RefundReason::FundingFailed)?;
            return Err(EconomyError::FundingClosed);
        }
        self.save()?;
        let result = self.snapshot.economy.fund(&AgentId::new(agent)?);
        self.save()?;
        result?;
        self.admit()?;
        Ok(self.view())
    }
    pub fn step(&mut self, expected: u32, decisions: Option<Vec<Decision>>) -> Result<Value> {
        self.admit()?;
        if self.snapshot.economy.view().state != EconomyState::Running {
            return Err(EconomyError::InvalidTransition(
                "Funded match not admitted".into(),
            ));
        }
        if self.snapshot.simulation.final_state.turn != expected {
            return Err(EconomyError::Conflict);
        }
        let events = engine::advance(&mut self.snapshot.simulation, decisions)
            .map_err(EconomyError::InvalidInput)?;
        self.save()?;
        if self.snapshot.simulation.final_state.ended {
            self.finalize()?;
        }
        Ok(json!({"events":events,"replay":self.snapshot.simulation,"economy":self.view()}))
    }
    fn attest(&mut self) -> Result<()> {
        if self.snapshot.attestation.is_none() {
            self.snapshot.attestation = Some(self.authority()?.attest(
                self.snapshot.economy.view().match_id,
                &self.snapshot.simulation,
                now(),
            )?);
            self.save()?;
        }
        Ok(())
    }
    pub fn finalize(&mut self) -> Result<Value> {
        self.attest()?;
        let authority = self.authority()?;
        let a = self
            .snapshot
            .attestation
            .as_ref()
            .cloned()
            .ok_or(EconomyError::InvalidAttestation)?;
        authority.verify(
            &self.snapshot.economy.view().match_id,
            &self.snapshot.simulation,
            &a,
        )?;
        if let Some(winner) = self.snapshot.simulation.winner.clone() {
            if self.snapshot.settlement.is_none() {
                let view = self.snapshot.economy.view();
                let payee = AccountId::new(&winner)?;
                let payer = self.snapshot.economy.escrow.status()?.account;
                self.snapshot.settlement = Some(SettlementRecord {
                    settlement_id: operation_id(
                        &view.match_id,
                        PaymentPurpose::Payout,
                        &payer,
                        &payee,
                    )?,
                    match_id: view.match_id,
                    winner_id: AgentId::new(&winner)?,
                    pot_amount: view.pot_amount,
                    fee_amount: Amount::ZERO,
                    payout_amount: view.pot_amount,
                    payment_rail: view.payment_mode,
                    transaction_reference: None,
                    status: OperationStatus::Pending,
                    created_at: now(),
                    confirmed_at: None,
                });
                self.save()?;
            }
            let result =
                self.snapshot
                    .economy
                    .settle_attested(&self.snapshot.simulation, &a, &authority);
            self.save()?;
            let settled = result?;
            let record = self.snapshot.settlement.as_mut().unwrap();
            record.status = OperationStatus::Confirmed;
            record.confirmed_at.get_or_insert(now());
            record.transaction_reference = self
                .snapshot
                .economy
                .rail
                .records()
                .get(&settled.receipt_id)
                .and_then(|r| r.receipt.as_ref())
                .and_then(|r| r.external_reference.clone());
            self.save()?;
        } else {
            self.cancel(RefundReason::NoWinnerFinished)?;
        }
        Ok(self.view())
    }
    pub fn cancel(&mut self, reason: RefundReason) -> Result<Value> {
        // Reconcile unknown entries before closing funding; never refund around an ambiguous deposit.
        self.reconcile_known()?;
        if self.snapshot.economy.rail.records().values().any(|r| {
            r.intent.purpose == PaymentPurpose::Entry && r.status == OperationStatus::Submitted
        }) {
            return Err(EconomyError::RpcUnavailable(
                "Resolve pending entry before cancellation".into(),
            ));
        }
        if self.snapshot.cancellation.is_some_and(|r| r != reason) {
            return Err(EconomyError::Conflict);
        }
        let state = self.snapshot.economy.view().state;
        let draw = reason == RefundReason::NoWinnerFinished
            && self.snapshot.simulation.final_state.ended
            && self.snapshot.simulation.winner.is_none()
            && self.snapshot.attestation.is_some();
        if !matches!(state, EconomyState::RefundPending | EconomyState::Refunded)
            && !reason.allowed(state, draw)
        {
            return Err(EconomyError::InvalidTransition(
                "Cancellation is not authorized for this phase".into(),
            ));
        }
        self.snapshot.cancellation = Some(reason);
        self.save()?;
        let result = self
            .snapshot
            .economy
            .refund(reason, Some(&self.snapshot.simulation));
        self.save()?;
        result?;
        Ok(self.view())
    }
    fn reconcile_known(&mut self) -> Result<()> {
        self.snapshot.economy.rail.reconcile()?;
        let records: Vec<_> = self
            .snapshot
            .economy
            .rail
            .records()
            .values()
            .cloned()
            .collect();
        for r in &records {
            if r.status == OperationStatus::Confirmed
                && r.intent.purpose == PaymentPurpose::Entry
                && self.snapshot.economy.view().state == EconomyState::Funding
            {
                self.snapshot
                    .economy
                    .fund(&AgentId::new(r.intent.payer.as_str())?)?;
            }
        }
        self.save()?;
        Ok(())
    }
    /// Verification only: never creates or broadcasts new payments, payouts or refunds.
    pub fn reconcile(&mut self) -> Result<Value> {
        self.reconcile_known()?;
        let records: Vec<_> = self
            .snapshot
            .economy
            .rail
            .records()
            .values()
            .cloned()
            .collect();
        if records.iter().any(|r| {
            r.status == OperationStatus::Confirmed && r.intent.purpose == PaymentPurpose::Payout
        }) && self.snapshot.attestation.is_some()
        {
            self.finalize()?;
        }
        if let Some(reason) = self.snapshot.cancellation {
            let funded = self.snapshot.economy.view().funded_agents.len();
            let refunds = records
                .iter()
                .filter(|r| {
                    r.status == OperationStatus::Confirmed
                        && r.intent.purpose == PaymentPurpose::Refund
                })
                .count();
            if funded == refunds
                && matches!(
                    self.snapshot.economy.view().state,
                    EconomyState::Funding | EconomyState::Funded | EconomyState::RefundPending
                )
            {
                self.snapshot
                    .economy
                    .refund(reason, Some(&self.snapshot.simulation))?;
                self.save()?;
            }
        }
        self.admit()?;
        Ok(self.view())
    }
    pub fn expire(&mut self) -> Result<Value> {
        if self.snapshot.economy.view().state == EconomyState::RefundPending {
            let reason = self.snapshot.cancellation.ok_or(EconomyError::Conflict)?;
            self.cancel(reason)
        } else if now() >= self.snapshot.funding_deadline
            && matches!(
                self.snapshot.economy.view().state,
                EconomyState::Funding | EconomyState::Funded
            )
        {
            self.cancel(RefundReason::FundingFailed)
        } else {
            Ok(self.view())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_setup_can_discard_only_an_untouched_funding_host() {
        let root = std::env::temp_dir().join(format!(
            "discard-funded-{}",
            crate::wallet::address(&crate::wallet::key().unwrap())
        ));
        let config: FundedMatchConfig = serde_json::from_value(json!({
            "simulation":crate::config::default_config(2,42),
            "economy":{"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"}
        })).unwrap();
        let host = FundedHost::create(&root, "discard-me", config.clone()).unwrap();
        drop(host);
        assert!(FundedHost::discard_unfunded(&root, "discard-me").unwrap());
        assert!(!FundedHost::discard_unfunded(&root, "discard-me").unwrap());
        assert!(FundedHost::list(&root).unwrap().is_empty());

        let mut host = FundedHost::create(&root, "keep-me", config).unwrap();
        host.fund("agent-1").unwrap();
        drop(host);
        assert_eq!(
            FundedHost::discard_unfunded(&root, "keep-me"),
            Err(EconomyError::Conflict)
        );
        assert_eq!(FundedHost::list(&root).unwrap(), vec!["keep-me"]);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn late_verified_funding_cannot_bypass_deadline_or_refund_during_reconciliation() {
        let root = std::env::temp_dir().join(format!(
            "late-funding-{}",
            crate::wallet::address(&crate::wallet::key().unwrap())
        ));
        let config=serde_json::from_value(json!({"simulation":crate::config::default_config(2,42),"economy":{"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"}})).unwrap();
        let mut host = FundedHost::create(&root, "late", config).unwrap();
        host.fund("agent-1").unwrap();
        host.snapshot
            .economy
            .fund(&AgentId::new("agent-2").unwrap())
            .unwrap();
        host.snapshot.funding_deadline = 0;
        host.save().unwrap();
        drop(host);
        let mut host = FundedHost::load(&root, "late").unwrap();
        assert_eq!(host.reconcile(), Err(EconomyError::FundingClosed));
        assert_eq!(host.replay().final_state.turn, 0);
        assert_eq!(host.view()["economy"]["pot_amount"], "40000000");
        assert_eq!(host.view()["operations"].as_array().unwrap().len(), 2);
        let refunded = host.expire().unwrap();
        assert_eq!(refunded["economy"]["state"], "refunded");
        assert_eq!(refunded["wallets"][0]["balance"], "1000000000");
        drop(host);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn scheduler_resumes_pending_refund_with_original_reason_after_restart() {
        let root = std::env::temp_dir().join(format!(
            "refund-retry-{}",
            crate::wallet::address(&crate::wallet::key().unwrap())
        ));
        let config = serde_json::from_value(json!({
            "simulation": crate::config::default_config(2,42),
            "economy": {"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"}
        })).unwrap();
        let mut host = FundedHost::create(&root, "retry", config).unwrap();
        host.fund("agent-1").unwrap();
        // Crash point: cancellation authorized and journaled, before refunds finish.
        host.snapshot.cancellation = Some(RefundReason::CancelledBeforeStart);
        host.snapshot.economy.economy.state = EconomyState::RefundPending;
        host.snapshot
            .economy
            .emit(super::super::events::EconomyEventKind::RefundStarted {
                reason: "CancelledBeforeStart".into(),
            });
        host.save().unwrap();
        drop(host);
        let mut host = FundedHost::load(&root, "retry").unwrap();
        let view = host.expire().unwrap();
        assert_eq!(view["economy"]["state"], "refunded");
        assert_eq!(view["wallets"][0]["balance"], "1000000000");
        let operations = view["operations"].clone();
        assert_eq!(host.expire().unwrap()["operations"], operations);
        drop(host);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn funded_recovery_admits_on_time_but_never_after_saved_cancellation() {
        for cancelled in [false, true] {
            let root = std::env::temp_dir().join(format!(
                "admission-retry-{}",
                crate::wallet::address(&crate::wallet::key().unwrap())
            ));
            let config=serde_json::from_value(json!({"simulation":crate::config::default_config(2,42),"economy":{"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"}})).unwrap();
            let mut host = FundedHost::create(&root, "admission", config).unwrap();
            for id in ["agent-1", "agent-2"] {
                host.snapshot
                    .economy
                    .fund(&AgentId::new(id).unwrap())
                    .unwrap();
            }
            if cancelled {
                host.snapshot.cancellation = Some(RefundReason::CancelledBeforeStart);
            }
            host.save().unwrap();
            drop(host);
            let mut host = FundedHost::load(&root, "admission").unwrap();
            let operations = host.view()["operations"].clone();
            if cancelled {
                assert!(host.reconcile().is_err());
                assert_eq!(host.view()["economy"]["state"], "funded");
                host.cancel(RefundReason::CancelledBeforeStart).unwrap();
                assert_eq!(host.view()["economy"]["state"], "refunded");
            } else {
                assert_eq!(host.reconcile().unwrap()["economy"]["state"], "running");
                assert_eq!(host.view()["operations"], operations);
            }
            assert_eq!(host.replay().final_state.turn, 0);
            drop(host);
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
