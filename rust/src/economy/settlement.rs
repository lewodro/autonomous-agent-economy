use super::{
    binding::SettlementResult, coordinator::EconomyCoordinator, escrow::MatchEscrow, events::*,
    lifecycle::EconomyState, primitives::*, rail::PaymentRail,
};
use crate::model::Replay;
impl<R: PaymentRail, E: MatchEscrow> EconomyCoordinator<R, E> {
    /// Caller must supply the authoritative runtime's completed history, not a proposed winner.
    pub fn settle(&mut self, finished: &Replay) -> Result<SettlementResult> {
        let winner = self.binding.verify_finished(finished)?;
        if !self.economy.funded_agents.contains(&winner) {
            return Err(EconomyError::SettlementNotAuthorized);
        }
        if let Some(prior) = &self.settlement {
            return if prior.final_history_id == finished.match_id && prior.winner == winner {
                Ok(prior.clone())
            } else {
                Err(EconomyError::Conflict)
            };
        }
        if !matches!(
            self.economy.state,
            EconomyState::Running | EconomyState::SettlementPending
        ) {
            return Err(EconomyError::InvalidTransition(
                "Settlement requires a running finished match".into(),
            ));
        }
        if self
            .result_history
            .as_ref()
            .is_some_and(|id| id != &finished.match_id)
        {
            return Err(EconomyError::Conflict);
        }
        let expected = self
            .economy
            .entry_amount
            .multiply(self.economy.required_agents.len() as u64)?;
        if self.economy.pot_amount != expected || self.escrow.status()?.pot_amount != expected {
            return Err(EconomyError::UnverifiedPayment);
        }
        if self.economy.state == EconomyState::Running {
            self.economy.state = self
                .economy
                .state
                .transition(EconomyState::SettlementPending)?;
            self.economy.settlement_status = SettlementStatus::Pending;
            self.result_history = Some(finished.match_id.clone());
            self.emit(EconomyEventKind::SettlementStarted {
                winner: winner.clone(),
            });
        }
        let receipt = match self.escrow.settle(&mut self.rail, &winner) {
            Ok(receipt) => receipt,
            Err(error) => {
                self.emit(EconomyEventKind::EconomyFailed {
                    error: error.clone(),
                });
                return Err(error);
            }
        };
        let result = SettlementResult {
            match_id: self.economy.match_id.clone(),
            final_history_id: finished.match_id.clone(),
            winner: winner.clone(),
            amount: receipt.intent.amount,
            receipt_id: receipt.receipt_id.clone(),
        };
        self.economy.state = self.economy.state.transition(EconomyState::Settled)?;
        self.economy.pot_amount = self.escrow.status()?.pot_amount;
        self.economy.settlement_status = SettlementStatus::Completed;
        self.settlement = Some(result.clone());
        self.emit(EconomyEventKind::SettlementCompleted {
            winner,
            amount: result.amount,
            receipt_id: result.receipt_id.clone(),
        });
        self.emit(EconomyEventKind::PotUpdated {
            amount: self.economy.pot_amount,
        });
        Ok(result)
    }
}
