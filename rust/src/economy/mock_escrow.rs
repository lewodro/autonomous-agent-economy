use super::{escrow::*, primitives::*, rail::*};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MockEscrow {
    run: RunId,
    participants: BTreeMap<AgentId, AccountId>,
    entry: Amount,
    account: AccountId,
    state: EscrowState,
    deposits: BTreeMap<AgentId, PaymentReceipt>,
    payout: Option<PaymentReceipt>,
    pending_payout: Option<PaymentIntent>,
    refunds: BTreeMap<AgentId, PaymentReceipt>,
}
impl MockEscrow {
    fn pot(&self) -> Result<Amount> {
        if matches!(self.state, EscrowState::Settled | EscrowState::Refunded) {
            return Ok(Amount::ZERO);
        }
        self.deposits
            .iter()
            .filter(|(id, _)| !self.refunds.contains_key(*id))
            .try_fold(Amount::ZERO, |sum, (_, r)| sum.add(r.intent.amount))
    }
    fn intent(
        &self,
        purpose: PaymentPurpose,
        payer: AccountId,
        payee: AccountId,
        amount: Amount,
    ) -> Result<PaymentIntent> {
        Ok(PaymentIntent {
            operation_id: operation_id(&self.run, purpose, &payer, &payee)?,
            match_id: self.run.clone(),
            payer,
            payee,
            amount,
            purpose,
        })
    }
}
impl MatchEscrow for MockEscrow {
    fn open(
        run: RunId,
        participants: BTreeMap<AgentId, AccountId>,
        entry: Amount,
        account: AccountId,
    ) -> Result<Self> {
        let unique: BTreeSet<_> = participants.values().collect();
        if !(2..=20).contains(&participants.len())
            || unique.len() != participants.len()
            || unique.contains(&account)
        {
            return Err(EconomyError::InvalidInput(
                "Escrow needs 2–20 distinct participant accounts".into(),
            ));
        }
        entry.multiply(participants.len() as u64)?;
        Ok(Self {
            run,
            participants,
            entry,
            account,
            state: EscrowState::Open,
            deposits: BTreeMap::new(),
            payout: None,
            pending_payout: None,
            refunds: BTreeMap::new(),
        })
    }
    fn verify_deposit(&self, rail: &dyn PaymentRail, receipt: &PaymentReceipt) -> Result<AgentId> {
        let agent = self
            .participants
            .iter()
            .find(|(_, account)| **account == receipt.intent.payer)
            .map(|(id, _)| id.clone())
            .ok_or(EconomyError::UnverifiedPayment)?;
        let expected = self.intent(
            PaymentPurpose::Entry,
            receipt.intent.payer.clone(),
            self.account.clone(),
            self.entry,
        )?;
        rail.verify_payment(receipt, &expected)?;
        Ok(agent)
    }
    fn deposit(&mut self, rail: &dyn PaymentRail, receipt: &PaymentReceipt) -> Result<()> {
        let agent = self.verify_deposit(rail, receipt)?;
        if let Some(prior) = self.deposits.get(&agent) {
            return if prior == receipt {
                Ok(())
            } else {
                Err(EconomyError::Conflict)
            };
        }
        if self.state != EscrowState::Open {
            return Err(EconomyError::InvalidTransition(
                "Deposit requires open escrow".into(),
            ));
        }
        self.pot()?.add(receipt.intent.amount)?;
        self.deposits.insert(agent, receipt.clone());
        Ok(())
    }
    fn lock(&mut self, rail: &dyn PaymentRail) -> Result<()> {
        if self.state == EscrowState::Locked {
            return Ok(());
        }
        if self.state != EscrowState::Open || self.deposits.len() != self.participants.len() {
            return Err(EconomyError::InvalidTransition(
                "All verified entries required before lock".into(),
            ));
        }
        let expected = self.entry.multiply(self.participants.len() as u64)?;
        if self.pot()? != expected || rail.get_balance(&self.account)? != expected {
            return Err(EconomyError::UnverifiedPayment);
        }
        self.state = EscrowState::Locked;
        Ok(())
    }
    fn settle(&mut self, rail: &mut dyn PaymentRail, winner: &AgentId) -> Result<PaymentReceipt> {
        let recipient = self
            .participants
            .get(winner)
            .ok_or(EconomyError::SettlementNotAuthorized)?
            .clone();
        if let Some(prior) = &self.payout {
            return if prior.intent.payee == recipient {
                Ok(prior.clone())
            } else {
                Err(EconomyError::Conflict)
            };
        }
        if self.state != EscrowState::Locked {
            return Err(EconomyError::InvalidTransition(
                "Settlement requires locked escrow".into(),
            ));
        }
        let pot = self.entry.multiply(self.participants.len() as u64)?;
        let intent = self.intent(PaymentPurpose::Payout, self.account.clone(), recipient, pot)?;
        if let Some(pending) = &self.pending_payout {
            if pending != &intent {
                return Err(EconomyError::Conflict);
            }
        } else {
            if self.pot()? != pot || rail.get_balance(&self.account)? != pot {
                return Err(EconomyError::UnverifiedPayment);
            }
            // Record the authorized operation before submission. An unknown outcome
            // must reconcile this same intent, never choose a new payee or refund.
            self.pending_payout = Some(intent.clone());
        }
        let receipt = rail.settle(intent.clone())?;
        rail.verify_payment(&receipt, &intent)?;
        self.payout = Some(receipt.clone());
        self.state = EscrowState::Settled;
        Ok(receipt)
    }
    fn refund(&mut self, rail: &mut dyn PaymentRail) -> Result<Vec<PaymentReceipt>> {
        if self.state == EscrowState::Refunded {
            return Ok(self.refunds.values().cloned().collect());
        }
        if self.pending_payout.is_some() {
            return Err(EconomyError::InvalidTransition(
                "Uncertain payout must reconcile before refund".into(),
            ));
        }
        if !matches!(
            self.state,
            EscrowState::Open | EscrowState::Locked | EscrowState::RefundPending
        ) {
            return Err(EconomyError::InvalidTransition(
                "Settled escrow cannot refund".into(),
            ));
        }
        self.state = EscrowState::RefundPending;
        for (agent, deposit) in &self.deposits {
            if self.refunds.contains_key(agent) {
                continue;
            }
            let intent = self.intent(
                PaymentPurpose::Refund,
                self.account.clone(),
                deposit.intent.payer.clone(),
                deposit.intent.amount,
            )?;
            let receipt = rail.refund(intent.clone())?;
            rail.verify_payment(&receipt, &intent)?;
            self.refunds.insert(agent.clone(), receipt);
        }
        if rail.get_balance(&self.account)? != Amount::ZERO {
            return Err(EconomyError::UnverifiedPayment);
        }
        self.state = EscrowState::Refunded;
        Ok(self.refunds.values().cloned().collect())
    }
    fn status(&self) -> Result<EscrowView> {
        Ok(EscrowView {
            match_id: self.run.clone(),
            account: self.account.clone(),
            state: self.state,
            deposits: self
                .deposits
                .iter()
                .map(|(id, r)| (id.clone(), r.intent.amount))
                .collect(),
            pot_amount: self.pot()?,
        })
    }
}
