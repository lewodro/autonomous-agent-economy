use super::{primitives::*, rail::*};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EscrowState {
    Open,
    Locked,
    Settled,
    RefundPending,
    Refunded,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EscrowView {
    pub match_id: RunId,
    pub account: AccountId,
    pub state: EscrowState,
    pub deposits: BTreeMap<AgentId, Amount>,
    pub pot_amount: Amount,
}
/// Escrow checks custody accounting; the coordinator authorizes match results/refunds.
pub trait MatchEscrow {
    fn open(
        match_id: RunId,
        participants: BTreeMap<AgentId, AccountId>,
        entry: Amount,
        account: AccountId,
    ) -> Result<Self>
    where
        Self: Sized;
    fn verify_deposit(&self, rail: &dyn PaymentRail, receipt: &PaymentReceipt) -> Result<AgentId>;
    fn deposit(&mut self, rail: &dyn PaymentRail, receipt: &PaymentReceipt) -> Result<()>;
    fn lock(&mut self, rail: &dyn PaymentRail) -> Result<()>;
    fn settle(&mut self, rail: &mut dyn PaymentRail, winner: &AgentId) -> Result<PaymentReceipt>;
    fn refund(&mut self, rail: &mut dyn PaymentRail) -> Result<Vec<PaymentReceipt>>;
    fn status(&self) -> Result<EscrowView>;
}
