use super::primitives::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentPurpose {
    Entry,
    Payout,
    Refund,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentIntent {
    pub operation_id: OperationId,
    pub match_id: RunId,
    pub payer: AccountId,
    pub payee: AccountId,
    pub amount: Amount,
    pub purpose: PaymentPurpose,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreparedPayment {
    pub intent: PaymentIntent,
    pub authorization: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationStatus {
    Pending,
    Confirmed,
    Rejected,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentReceipt {
    pub receipt_id: OperationId,
    pub intent: PaymentIntent,
    pub status: ConfirmationStatus,
    pub external_reference: Option<String>,
}
/// Rail implementations execute authorized intents; they never select a winner.
pub trait PaymentRail {
    fn get_balance(&self, account: &AccountId) -> Result<Amount>;
    fn prepare_payment(&mut self, intent: PaymentIntent) -> Result<PreparedPayment>;
    fn submit_payment(&mut self, payment: &PreparedPayment) -> Result<PaymentReceipt>;
    fn verify_payment(&self, receipt: &PaymentReceipt, expected: &PaymentIntent) -> Result<()>;
    /// Read/reconcile a known operation only. Never creates or submits a payment.
    fn reconcile_payment(&mut self, _intent: &PaymentIntent) -> Result<Option<PaymentReceipt>> {
        Ok(None)
    }
    fn refund(&mut self, intent: PaymentIntent) -> Result<PaymentReceipt> {
        if intent.purpose != PaymentPurpose::Refund {
            return Err(EconomyError::Conflict);
        }
        let prepared = self.prepare_payment(intent)?;
        self.submit_payment(&prepared)
    }
    fn settle(&mut self, intent: PaymentIntent) -> Result<PaymentReceipt> {
        if intent.purpose != PaymentPurpose::Payout {
            return Err(EconomyError::Conflict);
        }
        let prepared = self.prepare_payment(intent)?;
        self.submit_payment(&prepared)
    }
}
/// Domain-separated retry key; changing any participant or intent changes the key.
pub fn operation_id(
    run: &RunId,
    purpose: PaymentPurpose,
    payer: &AccountId,
    payee: &AccountId,
) -> Result<OperationId> {
    use crate::hashing::sha256_hex;
    let bytes = serde_json::to_vec(&(run, purpose, payer, payee))
        .map_err(|e| EconomyError::InvalidInput(e.to_string()))?;
    OperationId::new(format!(
        "op-{}",
        sha256_hex([b"last-seat/economy-operation/v1:".as_slice(), &bytes].concat())
    ))
}
