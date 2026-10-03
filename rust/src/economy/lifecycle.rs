use super::primitives::{EconomyError, Result};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EconomyState {
    Unfunded,
    Funding,
    Funded,
    Locked,
    Running,
    SettlementPending,
    Settled,
    RefundPending,
    Refunded,
    Failed,
}
impl EconomyState {
    pub fn transition(self, next: Self) -> Result<Self> {
        use EconomyState::*;
        let valid = matches!(
            (self, next),
            (Unfunded, Funding)
                | (Funding, Funded)
                | (Funded, Locked)
                | (Locked, Running)
                | (Running, SettlementPending)
                | (SettlementPending, Settled)
                | (Funding, RefundPending)
                | (Funded, RefundPending)
                | (Locked, RefundPending)
                | (Failed, RefundPending)
                | (RefundPending, Refunded)
                | (Unfunded, Failed)
                | (Funding, Failed)
                | (Funded, Failed)
                | (Locked, Failed)
                | (Running, Failed)
                | (SettlementPending, Failed)
        );
        if valid {
            Ok(next)
        } else {
            Err(EconomyError::InvalidTransition(format!(
                "{self:?} -> {next:?}"
            )))
        }
    }
    pub fn terminal(self) -> bool {
        matches!(self, Self::Settled | Self::Refunded)
    }
}
