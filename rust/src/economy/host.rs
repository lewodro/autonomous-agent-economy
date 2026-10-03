//! Durable authoritative host. All funded admission/settlement uses this service, including labs.
use super::{
    attestation::*, backend_escrow::TrustedBackendEscrow, backend_rail::BackendRail,
    coordinator::EconomyCoordinator, durable_rail::now, escrow::MatchEscrow,
    host_config::FundedMatchConfig, lifecycle::EconomyState, local_signer::LocalDevSigner,
    primitives::*, rail::*, records::*, refund::RefundReason, repository::*,
};
use crate::{
    engine,
    model::{Decision, Replay},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct HostSnapshot {
    pub(super) format: u32,
    pub(super) session: OperationId,
    pub(super) config: FundedMatchConfig,
    pub(super) simulation: Replay,
    pub(super) economy: EconomyCoordinator<BackendRail, TrustedBackendEscrow>,
    pub(super) funding_deadline: u64,
    pub(super) attestation: Option<CompletionAttestation>,
    pub(super) settlement: Option<SettlementRecord>,
    pub(super) cancellation: Option<RefundReason>,
}
pub struct FundedHost {
    pub(super) root: PathBuf,
    pub(super) repository: JsonRepository,
    pub(super) snapshot: HostSnapshot,
}
impl FundedHost {
    pub fn load(root: &Path, session: &str) -> Result<Self> {
        let id = OperationId::new(session)?;
        let repository = JsonRepository::open(root.join("sessions").join(id.as_str()))?;
        let snapshot: HostSnapshot = repository
            .read("host")?
            .ok_or_else(|| EconomyError::InvalidInput("Funded session not found".into()))?;
        if snapshot.format != 1 || snapshot.session != id {
            return Err(EconomyError::Conflict);
        }
        snapshot.config.validate()?;
        snapshot.economy.validate_recovery(&snapshot.simulation)?;
        let mut host = Self {
            root: root.into(),
            repository,
            snapshot,
        };
        if let Some(a) = &host.snapshot.attestation {
            host.authority()?.verify(
                &host.snapshot.economy.view().match_id,
                &host.snapshot.simulation,
                a,
            )?;
        }
        host.snapshot.economy.rail.reload()?;
        Ok(host)
    }
    pub fn list(root: &Path) -> Result<Vec<String>> {
        let directory = root.join("sessions");
        let entries = match std::fs::read_dir(directory) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(EconomyError::AdapterFailure(e.to_string())),
        };
        let mut sessions = vec![];
        for entry in entries {
            let e = entry.map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
            if e.file_type()
                .map_err(|e| EconomyError::AdapterFailure(e.to_string()))?
                .is_dir()
            {
                let s = e.file_name().to_string_lossy().to_string();
                OperationId::new(&s)?;
                let h = Self::load(root, &s)?;
                sessions.push(h.snapshot.session.as_str().into());
            }
        }
        sessions.sort();
        Ok(sessions)
    }
    pub(super) fn save(&self) -> Result<()> {
        self.repository.write("host", &self.snapshot)
    }
    fn authority(&self) -> Result<HostAuthority> {
        Ok(LocalDevSigner::load_or_create(
            &self.root.join("host-authority.wallet.bin"),
            AgentId::new("host-authority")?,
        )?
        .authority())
    }
    pub fn replay(&self) -> &Replay {
        &self.snapshot.simulation
    }
    pub fn view(&self) -> Value {
        let economy = self.snapshot.economy.view();
        let mut rpc_ready = true;
        let mut wallets = vec![];
        let addresses = self.snapshot.economy.rail.addresses();
        let ids = economy
            .required_agents
            .iter()
            .map(|id| AccountId::new(id.as_str()).unwrap())
            .chain(std::iter::once(
                self.snapshot.economy.escrow.status().unwrap().account,
            ));
        for id in ids {
            let result = self.snapshot.economy.rail.get_balance(&id);
            if result.is_err() {
                rpc_ready = false;
            }
            wallets.push(json!({"account":id,"address":addresses.get(&id),"balance":result.ok()}));
        }
        let operations:Vec<_>=self.snapshot.economy.rail.records().values().map(|r|json!({"id":r.intent.operation_id,"purpose":r.intent.purpose,"payer":r.intent.payer,"payee":r.intent.payee,"amount":r.intent.amount,"status":r.status,"created_at":r.created_at,"updated_at":r.updated_at,"retry_count":r.retry_count,"next_retry_at":r.next_retry_at,"reference":r.receipt.as_ref().and_then(|r|r.external_reference.clone()).or_else(||r.prepared.as_ref().and_then(|p|serde_json::from_str::<super::local_transaction::SignedLocalTransfer>(&p.authorization).ok().map(|s|s.reference))),"error":r.last_error})).collect();
        json!({"session":self.snapshot.session,"economy":economy,"events":self.snapshot.economy.events(),"wallets":wallets,"operations":operations,"settlement":self.snapshot.settlement,"attestation":self.snapshot.attestation,"funding_deadline":self.snapshot.funding_deadline,"expected_pot":economy.entry_amount.multiply(economy.required_agents.len() as u64).unwrap(),"health":{"payment_mode":economy.payment_mode,"rpc_ready":rpc_ready,"storage_ready":true,"pending_settlements":usize::from(economy.state==EconomyState::SettlementPending),"pending_refunds":usize::from(economy.state==EconomyState::RefundPending)}})
    }
    fn admit(&mut self) -> Result<()> {
        if self.snapshot.economy.view().state == EconomyState::Funded {
            self.snapshot.economy.lock()?;
            self.snapshot.economy.start()?;
            self.save()?;
        }
        Ok(())
    }
    pub fn prepare_entry(&mut self, agent: &str) -> Result<Value> {
        if self.snapshot.economy.view().state != EconomyState::Funding
            || now() >= self.snapshot.funding_deadline
        {
            return Err(EconomyError::FundingClosed);
        }
        let a = AgentId::new(agent)?;
        if !self.snapshot.economy.view().required_agents.contains(&a) {
            return Err(EconomyError::WrongRecipient);
        }
        let view = self.snapshot.economy.view();
        let payer = AccountId::new(agent)?;
        let payee = self.snapshot.economy.escrow.status()?.account;
        let intent = PaymentIntent {
            operation_id: operation_id(&view.match_id, PaymentPurpose::Entry, &payer, &payee)?,
            match_id: view.match_id,
            payer,
            payee,
            amount: view.entry_amount,
            purpose: PaymentPurpose::Entry,
        };
        self.snapshot.economy.rail.prepare_payment(intent)?;
        self.save()?;
        Ok(self.view())
    }
    pub fn fund(&mut self, agent: &str) -> Result<Value> {
        if now() >= self.snapshot.funding_deadline
            && self.snapshot.economy.view().state == EconomyState::Funding
        {
            self.cancel(RefundReason::FundingFailed)?;
            return Err(EconomyError::FundingClosed);
        }
        self.save()?;
        let result = self.snapshot.economy.fund(&AgentId::new(agent)?);
        self.save()?;
        result?;
        self.admit()?;
        Ok(self.view())
    }
    pub fn step(&mut self, expected: u32, decisions: Option<Vec<Decision>>) -> Result<Value> {
        self.admit()?;
        if self.snapshot.economy.view().state != EconomyState::Running {
            return Err(EconomyError::InvalidTransition(
                "Funded match not admitted".into(),
            ));
        }
        if self.snapshot.simulation.final_state.turn != expected {
            return Err(EconomyError::Conflict);
        }
        let events = engine::advance(&mut self.snapshot.simulation, decisions)
            .map_err(EconomyError::InvalidInput)?;
        self.save()?;
        if self.snapshot.simulation.final_state.ended {
            self.finalize()?;
        }
        Ok(json!({"events":events,"replay":self.snapshot.simulation,"economy":self.view()}))
    }
    fn attest(&mut self) -> Result<()> {
        if self.snapshot.attestation.is_none() {
            self.snapshot.attestation = Some(self.authority()?.attest(
                self.snapshot.economy.view().match_id,
                &self.snapshot.simulation,
                now(),
            )?);
            self.save()?;
        }
        Ok(())
    }
    pub fn finalize(&mut self) -> Result<Value> {
        self.attest()?;
        let authority = self.authority()?;
        let a = self
            .snapshot
            .attestation
            .as_ref()
            .ok_or(EconomyError::InvalidAttestation)?;
        authority.verify(
            &self.snapshot.economy.view().match_id,
            &self.snapshot.simulation,
            a,
        )?;
        if let Some(winner) = self.snapshot.simulation.winner.clone() {
            if self.snapshot.settlement.is_none() {
                let view = self.snapshot.economy.view();
                let payee = AccountId::new(&winner)?;
                let payer = self.snapshot.economy.escrow.status()?.account;
                self.snapshot.settlement = Some(SettlementRecord {
                    settlement_id: operation_id(
                        &view.match_id,
                        PaymentPurpose::Payout,
                        &payer,
                        &payee,
                    )?,
                    match_id: view.match_id,
                    winner_id: AgentId::new(&winner)?,
                    pot_amount: view.pot_amount,
                    fee_amount: Amount::ZERO,
                    payout_amount: view.pot_amount,
                    payment_rail: view.payment_mode,
                    transaction_reference: None,
                    status: OperationStatus::Pending,
                    created_at: now(),
                    confirmed_at: None,
                });
                self.save()?;
            }
            let result =
                self.snapshot
                    .economy
                    .settle_attested(&self.snapshot.simulation, a, &authority);
            self.save()?;
            let settled = result?;
            let record = self.snapshot.settlement.as_mut().unwrap();
            record.status = OperationStatus::Confirmed;
            record.confirmed_at.get_or_insert(now());
            record.transaction_reference = self
                .snapshot
                .economy
                .rail
                .records()
                .get(&settled.receipt_id)
                .and_then(|r| r.receipt.as_ref())
                .and_then(|r| r.external_reference.clone());
            self.save()?;
        } else {
            self.cancel(RefundReason::NoWinnerFinished)?;
        }
        Ok(self.view())
    }
    pub fn cancel(&mut self, reason: RefundReason) -> Result<Value> {
        // Reconcile unknown entries before closing funding; never refund around an ambiguous deposit.
        self.reconcile_known()?;
        if self.snapshot.economy.rail.records().values().any(|r| {
            r.intent.purpose == PaymentPurpose::Entry && r.status == OperationStatus::Submitted
        }) {
            return Err(EconomyError::RpcUnavailable(
                "Resolve pending entry before cancellation".into(),
            ));
        }
        if self.snapshot.cancellation.is_some_and(|r| r != reason) {
            return Err(EconomyError::Conflict);
        }
        self.snapshot.cancellation = Some(reason);
        self.save()?;
        let result = self
            .snapshot
            .economy
            .refund(reason, Some(&self.snapshot.simulation));
        self.save()?;
        result?;
        Ok(self.view())
    }
    fn reconcile_known(&mut self) -> Result<()> {
        self.snapshot.economy.rail.reconcile()?;
        let records: Vec<_> = self
            .snapshot
            .economy
            .rail
            .records()
            .values()
            .cloned()
            .collect();
        for r in &records {
            if r.status == OperationStatus::Confirmed
                && r.intent.purpose == PaymentPurpose::Entry
                && self.snapshot.economy.view().state == EconomyState::Funding
            {
                self.snapshot
                    .economy
                    .fund(&AgentId::new(r.intent.payer.as_str())?)?;
            }
        }
        self.save()?;
        Ok(())
    }
    /// Verification only: never creates or broadcasts new payments, payouts or refunds.
    pub fn reconcile(&mut self) -> Result<Value> {
        self.reconcile_known()?;
        let records: Vec<_> = self
            .snapshot
            .economy
            .rail
            .records()
            .values()
            .cloned()
            .collect();
        if records.iter().any(|r| {
            r.status == OperationStatus::Confirmed && r.intent.purpose == PaymentPurpose::Payout
        }) && self.snapshot.attestation.is_some()
        {
            self.finalize()?;
        }
        if let Some(reason) = self.snapshot.cancellation {
            let funded = self.snapshot.economy.view().funded_agents.len();
            let refunds = records
                .iter()
                .filter(|r| {
                    r.status == OperationStatus::Confirmed
                        && r.intent.purpose == PaymentPurpose::Refund
                })
                .count();
            if funded == refunds
                && matches!(
                    self.snapshot.economy.view().state,
                    EconomyState::Funding | EconomyState::Funded | EconomyState::RefundPending
                )
            {
                self.snapshot
                    .economy
                    .refund(reason, Some(&self.snapshot.simulation))?;
                self.save()?;
            }
        }
        self.admit()?;
        Ok(self.view())
    }
    pub fn expire(&mut self) -> Result<Value> {
        if now() >= self.snapshot.funding_deadline
            && self.snapshot.economy.view().state == EconomyState::Funding
        {
            self.cancel(RefundReason::FundingFailed)
        } else {
            Ok(self.view())
        }
    }
}
