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
