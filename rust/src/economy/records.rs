//! Durable operation facts. These records contain public payment data, never key material.
use super::{config::PaymentMode, primitives::*, rail::*};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    Created,
    Pending,
    Submitted,
    Confirmed,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaymentRecord {
    pub intent: PaymentIntent,
    pub rail: PaymentMode,
    pub currency: String,
    pub status: OperationStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub retry_count: u32,
    pub next_retry_at: u64,
    pub prepared: Option<PreparedPayment>,
    pub receipt: Option<PaymentReceipt>,
    pub last_error: Option<EconomyError>,
}
impl PaymentRecord {
    /// Persisted labels are not proof: confirmation must retain its exact receipt.
    pub fn validate(&self) -> Result<()> {
        self.rail.validate()?;
        if self.currency != "SOL"
            || self
                .prepared
                .as_ref()
                .is_some_and(|p| p.intent != self.intent)
            || (self.status == OperationStatus::Submitted && self.prepared.is_none())
            || (self.status == OperationStatus::Confirmed) != self.receipt.is_some()
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(receipt) = &self.receipt {
            if self.prepared.is_none()
                || receipt.intent != self.intent
                || receipt.receipt_id != self.intent.operation_id
                || receipt.status != ConfirmationStatus::Confirmed
                || (self.rail == PaymentMode::Local
                    && receipt
                        .external_reference
                        .as_ref()
                        .is_none_or(|r| r.is_empty()))
            {
                return Err(EconomyError::UnverifiedPayment);
            }
        }
        Ok(())
    }
    pub fn new(intent: PaymentIntent, rail: PaymentMode, now: u64) -> Result<Self> {
        rail.validate()?;
        Ok(Self {
            intent,
            rail,
            currency: "SOL".into(),
            status: OperationStatus::Created,
            created_at: now,
            updated_at: now,
            retry_count: 0,
            next_retry_at: now,
            prepared: None,
            receipt: None,
            last_error: None,
        })
    }
    pub fn submitted(&mut self, prepared: PreparedPayment, now: u64) -> Result<()> {
        if prepared.intent != self.intent || self.status == OperationStatus::Failed {
            return Err(EconomyError::Conflict);
        }
        if let Some(prior) = &self.prepared {
            if prior != &prepared {
                return Err(EconomyError::Conflict);
            }
        }
        if self.status != OperationStatus::Confirmed {
            self.prepared = Some(prepared);
            self.status = OperationStatus::Submitted;
            self.updated_at = now;
        }
        Ok(())
    }
    pub fn confirmed(&mut self, receipt: PaymentReceipt, now: u64) -> Result<()> {
        if receipt.intent != self.intent
            || receipt.receipt_id != self.intent.operation_id
            || receipt.status != ConfirmationStatus::Confirmed
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(prior) = &self.receipt {
            if prior != &receipt {
                return Err(EconomyError::Conflict);
            }
            return Ok(());
        }
        if self.status != OperationStatus::Submitted {
            return Err(EconomyError::InvalidTransition(
                "Confirmation requires a submitted operation".into(),
            ));
        }
        self.receipt = Some(receipt);
        self.status = OperationStatus::Confirmed;
        self.updated_at = now;
        self.last_error = None;
        Ok(())
    }
    pub fn retry(&mut self, error: EconomyError, now: u64) -> Result<()> {
        self.retry_count = self
            .retry_count
            .checked_add(1)
            .ok_or(EconomyError::Overflow)?;
        self.updated_at = now;
        self.next_retry_at = now.saturating_add(1u64 << self.retry_count.min(6));
        self.last_error = Some(error);
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettlementRecord {
    pub settlement_id: OperationId,
    pub match_id: RunId,
    pub winner_id: AgentId,
    pub pot_amount: Amount,
    pub fee_amount: Amount,
    pub payout_amount: Amount,
    pub payment_rail: PaymentMode,
    pub transaction_reference: Option<String>,
    pub status: OperationStatus,
    pub created_at: u64,
    pub confirmed_at: Option<u64>,
}
