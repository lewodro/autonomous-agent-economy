//! Trusted-backend custody bookkeeping. Real verification/money movement is delegated to the rail.
use super::{escrow::*, mock_escrow::MockEscrow, primitives::*, rail::*};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedBackendEscrow {
    bookkeeping: MockEscrow,
}
impl MatchEscrow for TrustedBackendEscrow {
    fn open(
        id: RunId,
        participants: BTreeMap<AgentId, AccountId>,
        amount: Amount,
        account: AccountId,
    ) -> Result<Self> {
        Ok(Self {
            bookkeeping: MockEscrow::open(id, participants, amount, account)?,
        })
    }
    fn verify_deposit(&self, rail: &dyn PaymentRail, r: &PaymentReceipt) -> Result<AgentId> {
        self.bookkeeping.verify_deposit(rail, r)
    }
    fn deposit(&mut self, rail: &dyn PaymentRail, r: &PaymentReceipt) -> Result<()> {
        self.bookkeeping.deposit(rail, r)
    }
    fn lock(&mut self, rail: &dyn PaymentRail) -> Result<()> {
        self.bookkeeping.lock(rail)
    }
    fn settle(&mut self, rail: &mut dyn PaymentRail, winner: &AgentId) -> Result<PaymentReceipt> {
        self.bookkeeping.settle(rail, winner)
    }
    fn refund(&mut self, rail: &mut dyn PaymentRail) -> Result<Vec<PaymentReceipt>> {
        self.bookkeeping.refund(rail)
    }
    fn status(&self) -> Result<EscrowView> {
        self.bookkeeping.status()
    }
}
