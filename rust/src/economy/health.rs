//! Public diagnostics, never key material or prepared transaction authorization.
use super::{
    config::PaymentMode,
    lifecycle::EconomyState,
    records::{OperationStatus, PaymentRecord},
};
use serde::Serialize;
#[derive(Debug, Serialize)]
pub struct EconomyHealth {
    pub payment_mode: PaymentMode,
    /// Last balance reads succeeded; mock readiness is not external RPC evidence.
    pub rpc_ready: bool,
    /// Host journal was opened and its writer lease acquired.
    pub storage_ready: bool,
    pub pending_intents: usize,
    pub pending_receipts: usize,
    pub pending_settlements: usize,
    pub pending_refunds: usize,
    pub mainnet_enabled: bool,
}
impl EconomyHealth {
    pub fn observed<'a>(
        mode: PaymentMode,
        state: EconomyState,
        rpc_ready: bool,
        records: impl Iterator<Item = &'a PaymentRecord>,
    ) -> Self {
        let mut health = Self {
            payment_mode: mode,
            rpc_ready,
            storage_ready: true,
            pending_intents: 0,
            pending_receipts: 0,
            pending_settlements: usize::from(state == EconomyState::SettlementPending),
            pending_refunds: usize::from(state == EconomyState::RefundPending),
            mainnet_enabled: false,
        };
        for record in records {
            if record.status == OperationStatus::Created {
                health.pending_intents += 1;
            }
            if matches!(
                record.status,
                OperationStatus::Pending | OperationStatus::Submitted
            ) && record.receipt.is_none()
            {
                health.pending_receipts += 1;
            }
        }
        health
    }
}
