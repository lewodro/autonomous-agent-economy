use super::{
    config::{EconomyConfig, PaymentMode},
    fees::FeePolicy,
    primitives::*,
};
use crate::model::Config;
use serde::{Deserialize, Serialize};
fn timeout() -> u64 {
    600
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FundedMatchConfig {
    pub simulation: Config,
    pub economy: EconomyConfig,
    #[serde(default)]
    pub fees: FeePolicy,
    #[serde(default = "timeout")]
    pub funding_timeout_seconds: u64,
}
impl FundedMatchConfig {
    pub fn validate(&self) -> Result<()> {
        self.economy.validate()?;
        self.fees.prototype()?;
        if self.simulation.agents.iter().any(|agent| {
            agent.id == "fee-sponsor"
                || agent.id == "host-authority"
                || agent.id.starts_with("escrow-")
        }) {
            return Err(EconomyError::InvalidInput(
                "Funded agents must not use reserved custody account IDs".into(),
            ));
        }
        if !matches!(
            self.economy.mode,
            PaymentMode::Mock | PaymentMode::Local | PaymentMode::Devnet
        ) {
            return Err(EconomyError::NotImplemented(
                "Funded admission supports mock, pinned local validator, or Solana devnet only"
                    .into(),
            ));
        }
        if !(1..=86400).contains(&self.funding_timeout_seconds) {
            return Err(EconomyError::InvalidInput(
                "Funding timeout must be 1–86400 seconds".into(),
            ));
        }
        crate::config::validate(&self.simulation).map_err(EconomyError::InvalidInput)
    }
}
