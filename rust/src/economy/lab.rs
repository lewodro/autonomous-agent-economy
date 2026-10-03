//! In-memory, mock-only developer lab. The browser never supplies a winner or receipt.
use super::{
    coordinator::EconomyCoordinator, mock_escrow::MockEscrow, mock_rail::MockPaymentRail,
    primitives::*, refund::RefundReason, scenario::EconomyScenario,
};
use crate::{engine, model::Replay};
use serde_json::{json, Value};
pub struct EconomyLab {
    simulation: Replay,
    economy: EconomyCoordinator<MockPaymentRail, MockEscrow>,
}
impl EconomyLab {
    pub fn new(scenario: &EconomyScenario) -> Result<Self> {
        let simulation = scenario.initial()?;
        let mut economy =
            EconomyCoordinator::mock(&simulation, &scenario.economy, &scenario.instance)?;
        economy.open_funding()?;
        Ok(Self {
            simulation,
            economy,
        })
    }
    pub fn command(&mut self, action: &str, agent: Option<&str>) -> Result<Value> {
        match action {
            "get" => {}
            "fund" => self.economy.fund(&AgentId::new(
                agent.ok_or_else(|| EconomyError::InvalidInput("agent required".into()))?,
            )?)?,
            "lock" => self.economy.lock()?,
            "finish" => {
                if self.economy.view().state != super::lifecycle::EconomyState::Running {
                    self.economy.start()?;
                }
                while !self.simulation.final_state.ended {
                    engine::advance(&mut self.simulation, None)
                        .map_err(EconomyError::AdapterFailure)?;
                }
            }
            "settle" => {
                self.economy.settle(&self.simulation)?;
            }
            "refund" => self
                .economy
                .refund(RefundReason::CancelledBeforeStart, None)?,
            _ => return Err(EconomyError::InvalidInput("Unknown lab action".into())),
        }
        let balances = self
            .economy
            .view()
            .required_agents
            .iter()
            .map(|a| Ok((a.clone(), self.economy.balance(a)?)))
            .collect::<Result<std::collections::BTreeMap<_, _>>>()?;
        Ok(
            json!({"economy":self.economy.view(),"events":self.economy.events(),"balances":balances,"simulation":{"turn":self.simulation.final_state.turn,"ended":self.simulation.final_state.ended,"winner":self.simulation.winner}}),
        )
    }
}
