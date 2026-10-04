//! Runtime rail selection stays outside simulation rules.
use super::{
    durable_rail::DurableMockRail, local_rail::LocalPaymentRail, primitives::*, rail::*,
    records::PaymentRecord,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "backend", content = "data", rename_all = "snake_case")]
pub enum BackendRail {
    Mock(DurableMockRail),
    Local(LocalPaymentRail),
}
impl BackendRail {
    pub fn mode(&self) -> super::config::PaymentMode {
        match self {
            Self::Mock(_) => super::config::PaymentMode::Mock,
            Self::Local(_) => super::config::PaymentMode::Local,
        }
    }
    pub fn reload(&mut self) -> Result<()> {
        match self {
            Self::Mock(r) => r.reload(),
            Self::Local(r) => r.reload(),
        }
    }
    pub fn records(&self) -> &BTreeMap<OperationId, PaymentRecord> {
        match self {
            Self::Mock(r) => r.records(),
            Self::Local(r) => r.records(),
        }
    }
    pub fn addresses(&self) -> BTreeMap<AccountId, String> {
        match self {
            Self::Mock(_) => BTreeMap::new(),
            Self::Local(r) => r.accounts().clone(),
        }
    }
    pub fn reconcile(&mut self) -> Result<()> {
        self.reload()?;
        let intents: Vec<_> = self.records().values().map(|r| r.intent.clone()).collect();
        for i in intents {
            self.reconcile_payment(&i)?;
        }
        Ok(())
    }
}
impl PaymentRail for BackendRail {
    fn get_balance(&self, a: &AccountId) -> Result<Amount> {
        match self {
            Self::Mock(r) => r.get_balance(a),
            Self::Local(r) => r.get_balance(a),
        }
    }
    fn prepare_payment(&mut self, i: PaymentIntent) -> Result<PreparedPayment> {
        match self {
            Self::Mock(r) => r.prepare_payment(i),
            Self::Local(r) => r.prepare_payment(i),
        }
    }
    fn submit_payment(&mut self, p: &PreparedPayment) -> Result<PaymentReceipt> {
        match self {
            Self::Mock(r) => r.submit_payment(p),
            Self::Local(r) => r.submit_payment(p),
        }
    }
    fn verify_payment(&self, r: &PaymentReceipt, i: &PaymentIntent) -> Result<()> {
        match self {
            Self::Mock(rail) => rail.verify_payment(r, i),
            Self::Local(rail) => rail.verify_payment(r, i),
        }
    }
    fn reconcile_payment(&mut self, i: &PaymentIntent) -> Result<Option<PaymentReceipt>> {
        match self {
            Self::Mock(r) => r.reconcile_payment(i),
            Self::Local(r) => r.reconcile_payment(i),
        }
    }
}
