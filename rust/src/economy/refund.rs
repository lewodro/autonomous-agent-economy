use super::{
    coordinator::EconomyCoordinator, escrow::MatchEscrow, events::*, lifecycle::EconomyState,
    primitives::*, rail::PaymentRail,
};
use crate::model::Replay;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefundReason {
    FundingFailed,
    CancelledBeforeStart,
    InvalidConfiguration,
    ServerFailureBeforeLock,
    NoWinnerFinished,
}
impl RefundReason {
    pub fn allowed(self, state: EconomyState, verified_draw: bool) -> bool {
        use EconomyState::*;
        match self {
            Self::CancelledBeforeStart => matches!(state, Unfunded | Funding | Funded | Locked),
            Self::FundingFailed | Self::InvalidConfiguration | Self::ServerFailureBeforeLock => {
                matches!(state, Unfunded | Funding | Funded)
            }
            Self::NoWinnerFinished => state == Running && verified_draw,
        }
    }
}
impl<R: PaymentRail, E: MatchEscrow> EconomyCoordinator<R, E> {
    pub fn fail_before_lock(&mut self, error: EconomyError) -> Result<()> {
        if !matches!(
            self.economy.state,
            EconomyState::Unfunded | EconomyState::Funding | EconomyState::Funded
        ) {
            return Err(EconomyError::InvalidTransition(
                "Only pre-lock failures are refundable".into(),
            ));
        }
        self.failure_stage = Some(self.economy.state);
        self.economy.state = self.economy.state.transition(EconomyState::Failed)?;
        self.emit(EconomyEventKind::EconomyFailed { error });
        Ok(())
    }
    pub fn refund(&mut self, reason: RefundReason, finished: Option<&Replay>) -> Result<()> {
        if self.economy.state == EconomyState::Refunded {
            return Ok(());
        }
        if self.economy.state != EconomyState::RefundPending {
            let verified_draw = if reason == RefundReason::NoWinnerFinished {
                match finished {
                    Some(run) => self.binding.verify_completed(run)?.is_none(),
                    None => false,
                }
            } else {
                false
            };
            let phase = self.failure_stage.unwrap_or(self.economy.state);
            if !reason.allowed(phase, verified_draw) || self.result_history.is_some() {
                return Err(EconomyError::InvalidTransition(
                    "Refund is not authorized for this phase/reason".into(),
                ));
            }
            self.economy.state = self.economy.state.transition(EconomyState::RefundPending)?;
            self.emit(EconomyEventKind::RefundStarted {
                reason: format!("{reason:?}"),
            });
        }
        let receipts = self.escrow.refund(&mut self.rail)?;
        let amount = receipts
            .iter()
            .try_fold(Amount::ZERO, |sum, r| sum.add(r.intent.amount))?;
        self.economy.state = self.economy.state.transition(EconomyState::Refunded)?;
        self.economy.pot_amount = Amount::ZERO;
        self.economy.settlement_status = SettlementStatus::Refunded;
        self.emit(EconomyEventKind::RefundCompleted { amount });
        self.emit(EconomyEventKind::PotUpdated {
            amount: Amount::ZERO,
        });
        Ok(())
    }
}
