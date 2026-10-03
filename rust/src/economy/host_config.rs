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
        if !matches!(self.economy.mode, PaymentMode::Mock | PaymentMode::Local) {
            return Err(EconomyError::NotImplemented(
                "Funded admission supports mock or pinned local validator only".into(),
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
