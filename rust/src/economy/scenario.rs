use super::{config::EconomyConfig, primitives::*};
use crate::{config, engine, model::Replay};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EconomyScenario {
    pub agents: usize,
    pub seed: u32,
    pub max_turns: u32,
    pub instance: OperationId,
    pub economy: EconomyConfig,
}
impl EconomyScenario {
    pub fn initial(&self) -> Result<Replay> {
        if !(2..=20).contains(&self.agents) {
            return Err(EconomyError::InvalidInput("Use 2–20 agents".into()));
        }
        let policy = self.economy.validate()?;
        policy.entry.multiply(self.agents as u64)?;
        policy.starting_balance.multiply(self.agents as u64)?;
        let mut cfg = config::default_config(self.agents, self.seed);
        cfg.max_turns = self.max_turns;
        engine::start(cfg).map_err(EconomyError::InvalidInput)
    }
}
