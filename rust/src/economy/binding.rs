use super::primitives::*;
use crate::{model::Replay, replay};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimulationBinding {
    pub initial_history_id: String,
    pub simulation_version: String,
    pub configuration_digest: String,
}
impl SimulationBinding {
    pub fn from_initial(initial: &Replay) -> Result<Self> {
        replay::verify(initial).map_err(|e| EconomyError::InvalidInput(e))?;
        if initial.final_state.turn != 0 || initial.final_state.ended {
            return Err(EconomyError::InvalidInput(
                "Economy must bind before the first turn".into(),
            ));
        }
        let bytes = serde_json::to_vec(&initial.config)
            .map_err(|e| EconomyError::InvalidInput(e.to_string()))?;
        Ok(Self {
            initial_history_id: initial.match_id.clone(),
            simulation_version: initial.simulation_version.clone(),
            configuration_digest: format!("{:x}", Sha256::digest(bytes)),
        })
    }
    pub fn run_id(&self, instance: &OperationId) -> Result<RunId> {
        let bytes = serde_json::to_vec(&(self, instance))
            .map_err(|e| EconomyError::InvalidInput(e.to_string()))?;
        RunId::new(format!(
            "eco-{:x}",
            Sha256::digest([b"last-seat/economy-run/v1:".as_slice(), &bytes].concat())
        ))
    }
    pub fn verify_completed(&self, finished: &Replay) -> Result<Option<AgentId>> {
        let checked =
            replay::verify(finished).map_err(|_| EconomyError::SettlementNotAuthorized)?;
        let initial =
            crate::engine::start_version(checked.config.clone(), &checked.simulation_version)
                .map_err(|_| EconomyError::SettlementNotAuthorized)?;
        if Self::from_initial(&initial)? != *self || !checked.final_state.ended {
            return Err(EconomyError::SettlementNotAuthorized);
        }
        let winner = checked
            .winner
            .ok_or(EconomyError::SettlementNotAuthorized)?;
        if !checked.config.agents.iter().any(|a| a.id == winner) {
            return Err(EconomyError::SettlementNotAuthorized);
        }
        Ok(Some(AgentId::new(winner)?))
    }
    pub fn verify_finished(&self, finished: &Replay) -> Result<AgentId> {
        self.verify_completed(finished)?
            .ok_or(EconomyError::SettlementNotAuthorized)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettlementResult {
    pub match_id: RunId,
    pub final_history_id: String,
    pub winner: AgentId,
    pub amount: Amount,
    pub receipt_id: OperationId,
}
