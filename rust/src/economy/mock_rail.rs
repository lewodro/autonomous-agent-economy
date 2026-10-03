use super::{primitives::*, rail::*, treasury::TreasuryLedger};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
#[derive(Clone, Debug)]
pub struct MockPaymentRail {
    ledger: TreasuryLedger,
    reserve: Amount,
    prepared: BTreeMap<OperationId, PreparedPayment>,
    receipts: BTreeMap<OperationId, PaymentReceipt>,
}
impl MockPaymentRail {
    pub fn new(ledger: TreasuryLedger, reserve: Amount) -> Self {
        Self {
            ledger,
            reserve,
            prepared: BTreeMap::new(),
            receipts: BTreeMap::new(),
        }
    }
    pub fn total(&self) -> Result<Amount> {
        self.ledger.total()
    }
    pub fn receipt_count(&self) -> usize {
        self.receipts.len()
    }
}
impl PaymentRail for MockPaymentRail {
    fn get_balance(&self, account: &AccountId) -> Result<Amount> {
        self.ledger.balance(account)
    }
    fn prepare_payment(&mut self, intent: PaymentIntent) -> Result<PreparedPayment> {
        if let Some(prior) = self.prepared.get(&intent.operation_id) {
            return if prior.intent == intent {
                Ok(prior.clone())
            } else {
                Err(EconomyError::Conflict)
            };
        }
        if intent.payer == intent.payee {
            return Err(EconomyError::InvalidInput(
                "Distinct accounts required".into(),
            ));
        }
        let remaining = self.get_balance(&intent.payer)?.subtract(intent.amount)?;
        self.get_balance(&intent.payee)?;
        if intent.purpose == PaymentPurpose::Entry {
            remaining.subtract(self.reserve)?;
        }
        let bytes =
            serde_json::to_vec(&intent).map_err(|e| EconomyError::InvalidInput(e.to_string()))?;
        let authorization = format!(
            "mock-{:x}",
            Sha256::digest([b"last-seat/mock-payment/v1:".as_slice(), &bytes].concat())
        );
        let prepared = PreparedPayment {
            intent,
            authorization,
        };
        self.prepared
            .insert(prepared.intent.operation_id.clone(), prepared.clone());
        Ok(prepared)
    }
    fn submit_payment(&mut self, payment: &PreparedPayment) -> Result<PaymentReceipt> {
        let id = &payment.intent.operation_id;
        if self.prepared.get(id) != Some(payment) {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(receipt) = self.receipts.get(id) {
            return Ok(receipt.clone());
        }
        let intent = &payment.intent;
        if intent.purpose == PaymentPurpose::Entry {
            self.get_balance(&intent.payer)?
                .subtract(intent.amount)?
                .subtract(self.reserve)?;
        }
        self.ledger
            .transfer(&intent.payer, &intent.payee, intent.amount)?;
        let receipt = PaymentReceipt {
            receipt_id: id.clone(),
            intent: intent.clone(),
            status: ConfirmationStatus::Confirmed,
            external_reference: None,
        };
        self.receipts.insert(id.clone(), receipt.clone());
        Ok(receipt)
    }
    fn verify_payment(&self, receipt: &PaymentReceipt, expected: &PaymentIntent) -> Result<()> {
        if receipt.status != ConfirmationStatus::Confirmed
            || &receipt.intent != expected
            || self.receipts.get(&receipt.receipt_id) != Some(receipt)
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        Ok(())
    }
}
