//! Persisted mock rail: intent before execution, debit and receipt in one atomic revision.
use super::{mock_rail::MockPaymentRail, primitives::*, rail::*, records::*, repository::*};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DurableMockRail {
    pub(super) directory: PathBuf,
    pub(super) backend: MockPaymentRail,
    pub(super) records: BTreeMap<OperationId, PaymentRecord>,
}
impl DurableMockRail {
    pub fn create(directory: PathBuf, backend: MockPaymentRail) -> Result<Self> {
        let repo = JsonRepository::open(&directory)?;
        if repo.read::<Self>("rail")?.is_some() {
            return Err(EconomyError::Conflict);
        }
        let rail = Self {
            directory,
            backend,
            records: BTreeMap::new(),
        };
        repo.write("rail", &rail)?;
        Ok(rail)
    }
    pub fn reload(&mut self) -> Result<()> {
        let repo = JsonRepository::open(&self.directory)?;
        let loaded = repo
            .read::<Self>("rail")?
            .ok_or_else(|| EconomyError::AdapterFailure("Missing existing rail journal".into()))?;
        if loaded.directory != self.directory {
            return Err(EconomyError::Conflict);
        }
        loaded.backend.total()?;
        for (id, r) in &loaded.records {
            if id != &r.intent.operation_id || r.rail != super::config::PaymentMode::Mock {
                return Err(EconomyError::UnverifiedPayment);
            }
            if let Some(receipt) = &r.receipt {
                loaded.backend.verify_payment(receipt, &r.intent)?;
            }
        }
        *self = loaded;
        Ok(())
    }
    fn save(&self) -> Result<()> {
        JsonRepository::open(&self.directory)?.write("rail", self)
    }
    pub fn records(&self) -> &BTreeMap<OperationId, PaymentRecord> {
        &self.records
    }
}
impl PaymentRail for DurableMockRail {
    fn get_balance(&self, a: &AccountId) -> Result<Amount> {
        self.backend.get_balance(a)
    }
    fn prepare_payment(&mut self, intent: PaymentIntent) -> Result<PreparedPayment> {
        self.reload()?;
        if let Some(record) = self.records.get(&intent.operation_id) {
            if record.intent != intent {
                return Err(EconomyError::Conflict);
            }
            if let Some(p) = &record.prepared {
                return Ok(p.clone());
            }
        }
        let mut next = self.clone();
        let prepared = next.backend.prepare_payment(intent.clone())?;
        let mut record =
            PaymentRecord::new(intent.clone(), super::config::PaymentMode::Mock, now())?;
        record.prepared = Some(prepared.clone());
        next.records.insert(intent.operation_id, record);
        next.save()?;
        *self = next;
        Ok(prepared)
    }
    fn submit_payment(&mut self, p: &PreparedPayment) -> Result<PaymentReceipt> {
        self.reload()?;
        let id = &p.intent.operation_id;
        let record = self
            .records
            .get(id)
            .ok_or(EconomyError::UnverifiedPayment)?;
        if record.prepared.as_ref() != Some(p) {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(r) = &record.receipt {
            return Ok(r.clone());
        }
        let mut next = self.clone();
        next.records
            .get_mut(id)
            .unwrap()
            .submitted(p.clone(), now())?;
        next.save()?;
        let receipt = next.backend.submit_payment(p)?;
        next.backend.verify_payment(&receipt, &p.intent)?;
        next.records
            .get_mut(id)
            .unwrap()
            .confirmed(receipt.clone(), now())?;
        next.save()?;
        *self = next;
        Ok(receipt)
    }
    fn verify_payment(&self, r: &PaymentReceipt, i: &PaymentIntent) -> Result<()> {
        self.backend.verify_payment(r, i)
    }
    fn reconcile_payment(&mut self, i: &PaymentIntent) -> Result<Option<PaymentReceipt>> {
        self.reload()?;
        let Some(r) = self.records.get(&i.operation_id) else {
            return Ok(None);
        };
        if &r.intent != i {
            return Err(EconomyError::Conflict);
        }
        Ok(r.receipt.clone())
    }
}
