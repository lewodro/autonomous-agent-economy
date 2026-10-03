//! Read-only devnet foundation. No entry, refund or payout submission is enabled.
use super::{config::PaymentMode, primitives::*, rail::*};
use crate::wallet::{rpc, DEVNET, DEVNET_GENESIS};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SolanaPublicKey([u8; 32]);
impl SolanaPublicKey {
    pub fn parse(value: &str) -> Result<Self> {
        let bytes = bs58::decode(value)
            .into_vec()
            .map_err(|_| EconomyError::InvalidInput("Invalid Solana public key".into()))?;
        let key: [u8; 32] = bytes.try_into().map_err(|_| {
            EconomyError::InvalidInput("Solana public key must contain 32 bytes".into())
        })?;
        Ok(Self(key))
    }
    pub fn address(&self) -> String {
        bs58::encode(self.0).into_string()
    }
}
impl TryFrom<String> for SolanaPublicKey {
    type Error = EconomyError;
    fn try_from(value: String) -> Result<Self> {
        Self::parse(&value)
    }
}
impl From<SolanaPublicKey> for String {
    fn from(value: SolanaPublicKey) -> String {
        value.address()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DevnetRailConfig {
    pub mode: PaymentMode,
    pub rpc_url: String,
    pub expected_genesis: String,
}
impl Default for DevnetRailConfig {
    fn default() -> Self {
        Self {
            mode: PaymentMode::Devnet,
            rpc_url: DEVNET.into(),
            expected_genesis: DEVNET_GENESIS.into(),
        }
    }
}
impl DevnetRailConfig {
    pub fn validate(&self) -> Result<()> {
        self.mode.validate()?;
        if self.mode != PaymentMode::Devnet
            || self.rpc_url != DEVNET
            || self.expected_genesis != DEVNET_GENESIS
        {
            return Err(EconomyError::InvalidInput(
                "This read-only adapter requires the fixed devnet endpoint/genesis".into(),
            ));
        }
        Ok(())
    }
}
pub fn decode_balance(value: Value) -> Result<Amount> {
    if value["context"]["slot"].as_u64().is_none() {
        return Err(EconomyError::AdapterFailure(
            "Balance response lacks slot context".into(),
        ));
    }
    value["value"]
        .as_u64()
        .map(Amount::new)
        .ok_or_else(|| EconomyError::AdapterFailure("Balance must be integer base units".into()))
}
pub struct SolanaDevnetRail {
    config: DevnetRailConfig,
    accounts: BTreeMap<AccountId, SolanaPublicKey>,
}
impl SolanaDevnetRail {
    pub fn new(
        config: DevnetRailConfig,
        accounts: BTreeMap<AccountId, SolanaPublicKey>,
    ) -> Result<Self> {
        config.validate()?;
        if accounts.is_empty() || accounts.len() > 21 {
            return Err(EconomyError::InvalidInput(
                "Map 1–21 public test accounts".into(),
            ));
        }
        Ok(Self { config, accounts })
    }
    fn disabled<T>() -> Result<T> {
        Err(EconomyError::NotImplemented(
            "Devnet match escrow/payment submission is not implemented".into(),
        ))
    }
}
impl PaymentRail for SolanaDevnetRail {
    fn get_balance(&self, account: &AccountId) -> Result<Amount> {
        self.config.validate()?;
        let key = self
            .accounts
            .get(account)
            .ok_or_else(|| EconomyError::InvalidInput("Unknown test account".into()))?;
        let genesis = rpc("getGenesisHash", json!([])).map_err(EconomyError::AdapterFailure)?;
        if genesis.as_str() != Some(DEVNET_GENESIS) {
            return Err(EconomyError::AdapterFailure(
                "Unexpected devnet genesis".into(),
            ));
        }
        decode_balance(
            rpc(
                "getBalance",
                json!([key.address(),{"commitment":"confirmed"}]),
            )
            .map_err(EconomyError::AdapterFailure)?,
        )
    }
    fn prepare_payment(&mut self, _intent: PaymentIntent) -> Result<PreparedPayment> {
        Self::disabled()
    }
    fn submit_payment(&mut self, _payment: &PreparedPayment) -> Result<PaymentReceipt> {
        Self::disabled()
    }
    fn verify_payment(&self, _receipt: &PaymentReceipt, _expected: &PaymentIntent) -> Result<()> {
        Self::disabled()
    }
}
