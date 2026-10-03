use super::{
    binding::*, config::*, escrow::*, events::*, lifecycle::*, mock_escrow::MockEscrow,
    mock_rail::MockPaymentRail, primitives::*, rail::*, treasury::TreasuryLedger,
};
use crate::model::Replay;
use std::collections::{BTreeMap, BTreeSet};
pub struct EconomyCoordinator<R: PaymentRail, E: MatchEscrow> {
    pub(super) binding: SimulationBinding,
    pub(super) economy: MatchEconomy,
    pub(super) rail: R,
    pub(super) escrow: E,
    pub(super) events: Vec<EconomyEvent>,
    pub(super) settlement: Option<SettlementResult>,
    pub(super) result_history: Option<String>,
}
impl<R: PaymentRail, E: MatchEscrow> EconomyCoordinator<R, E> {
    pub fn new(
        initial: &Replay,
        config: &ValidatedConfig,
        instance: &OperationId,
        rail: R,
    ) -> Result<Self> {
        config.mode.validate()?;
        let binding = SimulationBinding::from_initial(initial)?;
        let run = binding.run_id(instance)?;
        let account = AccountId::new(format!("escrow-{}", run.as_str()))?;
        if rail.get_balance(&account)? != Amount::ZERO {
            return Err(EconomyError::Conflict);
        }
        let participants: BTreeMap<_, _> = initial
            .config
            .agents
            .iter()
            .map(|a| Ok((AgentId::new(&a.id)?, AccountId::new(&a.id)?)))
            .collect::<Result<_>>()?;
        let escrow = E::open(run.clone(), participants.clone(), config.entry, account)?;
        let economy = MatchEconomy {
            match_id: run,
            simulation_start_id: binding.initial_history_id.clone(),
            payment_mode: config.mode,
            entry_amount: config.entry,
            required_agents: participants.keys().cloned().collect(),
            funded_agents: BTreeSet::new(),
            pot_amount: Amount::ZERO,
            state: EconomyState::Unfunded,
            settlement_status: SettlementStatus::NotStarted,
        };
        Ok(Self {
            binding,
            economy,
            rail,
            escrow,
            events: vec![],
            settlement: None,
            result_history: None,
        })
    }
    pub fn view(&self) -> MatchEconomy {
        self.economy.clone()
    }
    pub fn events(&self) -> &[EconomyEvent] {
        &self.events
    }
    pub fn balance(&self, agent: &AgentId) -> Result<Amount> {
        if !self.economy.required_agents.contains(agent) {
            return Err(EconomyError::InvalidInput("Unknown participant".into()));
        }
        self.rail.get_balance(&AccountId::new(agent.as_str())?)
    }
    pub(super) fn emit(&mut self, kind: EconomyEventKind) {
        self.events.push(EconomyEvent {
            schema_version: 1,
            seq: self.events.len() as u64,
            match_id: self.economy.match_id.clone(),
            kind,
            projection: self.view(),
        });
    }
    pub fn open_funding(&mut self) -> Result<()> {
        if self.economy.state == EconomyState::Funding {
            return Ok(());
        }
        self.economy.state = self.economy.state.transition(EconomyState::Funding)?;
        self.emit(EconomyEventKind::FundingOpened);
        Ok(())
    }
    pub fn fund(&mut self, agent: &AgentId) -> Result<()> {
        if !self.economy.required_agents.contains(agent) {
            return Err(EconomyError::InvalidInput("Unknown participant".into()));
        }
        if self.economy.funded_agents.contains(agent) {
            return Ok(());
        }
        if self.economy.state != EconomyState::Funding {
            return Err(EconomyError::InvalidTransition(
                "Funding must be open".into(),
            ));
        }
        self.emit(EconomyEventKind::EntryRequested {
            agent_id: agent.clone(),
            amount: self.economy.entry_amount,
        });
        let payer = AccountId::new(agent.as_str())?;
        let payee = self.escrow.status()?.account;
        let intent = PaymentIntent {
            operation_id: operation_id(
                &self.economy.match_id,
                PaymentPurpose::Entry,
                &payer,
                &payee,
            )?,
            match_id: self.economy.match_id.clone(),
            payer,
            payee,
            amount: self.economy.entry_amount,
            purpose: PaymentPurpose::Entry,
        };
        let attempt: Result<PaymentReceipt> = (|| {
            let prepared = self.rail.prepare_payment(intent)?;
            let receipt = self.rail.submit_payment(&prepared)?;
            self.escrow.deposit(&self.rail, &receipt)?;
            Ok(receipt)
        })();
        let receipt = match attempt {
            Ok(receipt) => receipt,
            Err(error) => {
                self.emit(EconomyEventKind::EntryRejected {
                    agent_id: agent.clone(),
                    error: error.clone(),
                });
                return Err(error);
            }
        };
        self.economy.funded_agents.insert(agent.clone());
        self.economy.pot_amount = self.escrow.status()?.pot_amount;
        self.emit(EconomyEventKind::EntryReceived {
            agent_id: agent.clone(),
            amount: receipt.intent.amount,
            receipt_id: receipt.receipt_id,
        });
        self.emit(EconomyEventKind::PotUpdated {
            amount: self.economy.pot_amount,
        });
        if self.economy.funded_agents.len() == self.economy.required_agents.len() {
            self.economy.state = self.economy.state.transition(EconomyState::Funded)?;
            self.emit(EconomyEventKind::FundingCompleted);
        }
        Ok(())
    }
    pub fn lock(&mut self) -> Result<()> {
        if self.economy.state == EconomyState::Locked {
            return Ok(());
        }
        let next = self.economy.state.transition(EconomyState::Locked)?;
        self.escrow.lock(&self.rail)?;
        self.economy.state = next;
        self.emit(EconomyEventKind::FundsLocked);
        Ok(())
    }
    pub fn start(&mut self) -> Result<()> {
        if self.economy.state == EconomyState::Running {
            return Ok(());
        }
        self.economy.state = self.economy.state.transition(EconomyState::Running)?;
        self.emit(EconomyEventKind::EconomyRunning);
        Ok(())
    }
}
impl EconomyCoordinator<MockPaymentRail, MockEscrow> {
    pub fn mock(initial: &Replay, config: &EconomyConfig, instance: &OperationId) -> Result<Self> {
        let config = config.validate()?;
        if config.mode != PaymentMode::Mock {
            return Err(EconomyError::NotImplemented(
                "Funded test-network match rail is not implemented".into(),
            ));
        }
        let binding = SimulationBinding::from_initial(initial)?;
        let run = binding.run_id(instance)?;
        let mut ledger = TreasuryLedger::default();
        ledger.open(
            AccountId::new(format!("escrow-{}", run.as_str()))?,
            Amount::ZERO,
        )?;
        for agent in &initial.config.agents {
            ledger.open(AccountId::new(&agent.id)?, config.starting_balance)?;
        }
        let reserve = if config.enabled {
            config.minimum_reserve
        } else {
            Amount::ZERO
        };
        Self::new(
            initial,
            &config,
            instance,
            MockPaymentRail::new(ledger, reserve),
        )
    }
}
