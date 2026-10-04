//! Recovery validation is separate from the payment journal. Journal facts win over stale caches.
use super::{
    binding::SimulationBinding, coordinator::EconomyCoordinator, durable_rail::DurableMockRail,
    escrow::MatchEscrow, mock_escrow::MockEscrow, mock_rail::MockPaymentRail, primitives::*,
    rail::PaymentRail,
};
use crate::{engine, model::Replay, replay};
impl<R: PaymentRail, E: MatchEscrow> EconomyCoordinator<R, E> {
    pub fn validate_recovery(&self, simulation: &Replay) -> Result<()> {
        replay::verify(simulation).map_err(EconomyError::AdapterFailure)?;
        let initial =
            engine::start_version(simulation.config.clone(), &simulation.simulation_version)
                .map_err(EconomyError::AdapterFailure)?;
        if self.binding != SimulationBinding::from_initial(&initial)?
            || self.economy.simulation_start_id != initial.match_id
        {
            return Err(EconomyError::Conflict);
        }
        let escrow = self.escrow.status()?;
        let participants: std::collections::BTreeSet<_> = simulation
            .config
            .agents
            .iter()
            .map(|a| AgentId::new(&a.id))
            .collect::<Result<_>>()?;
        if self.economy.required_agents.len() != participants.len()
            || self
                .economy
                .required_agents
                .iter()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
                != participants
        {
            return Err(EconomyError::Conflict);
        }
        if escrow.match_id != self.economy.match_id
            || escrow
                .deposits
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
                != self.economy.funded_agents
            || escrow
                .deposits
                .values()
                .any(|a| *a != self.economy.entry_amount)
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        if self
            .events
            .last()
            .is_some_and(|e| e.projection != self.economy)
        {
            return Err(EconomyError::Conflict);
        }
        for (n, e) in self.events.iter().enumerate() {
            if e.schema_version != 1 || e.seq != n as u64 || e.match_id != self.economy.match_id {
                return Err(EconomyError::Conflict);
            }
        }
        if !matches!(
            self.economy.state,
            super::lifecycle::EconomyState::RefundPending
        ) && escrow.pot_amount != self.economy.pot_amount
        {
            return Err(EconomyError::UnverifiedPayment);
        }
        if let Some(settlement) = &self.settlement {
            let winner = self.binding.verify_finished(simulation)?;
            if settlement.winner != winner
                || settlement.match_id != self.economy.match_id
                || settlement.final_history_id != simulation.match_id
                || settlement.amount
                    != self
                        .economy
                        .entry_amount
                        .multiply(participants.len() as u64)?
                || self.result_history.as_ref() != Some(&simulation.match_id)
            {
                return Err(EconomyError::SettlementNotAuthorized);
            }
        }
        Ok(())
    }
}
impl EconomyCoordinator<MockPaymentRail, MockEscrow> {
    pub fn persist_rail(
        self,
        directory: std::path::PathBuf,
    ) -> Result<EconomyCoordinator<DurableMockRail, MockEscrow>> {
        if !self.economy.funded_agents.is_empty() {
            return Err(EconomyError::Conflict);
        }
        Ok(EconomyCoordinator {
            binding: self.binding,
            economy: self.economy,
            rail: DurableMockRail::create(directory, self.rail)?,
            escrow: self.escrow,
            events: self.events,
            settlement: self.settlement,
            result_history: self.result_history,
            failure_stage: self.failure_stage,
        })
    }
}
