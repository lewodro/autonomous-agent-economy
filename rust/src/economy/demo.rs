use super::{
    binding::SettlementResult, coordinator::EconomyCoordinator, events::*, mock_signer::MockSigner,
    primitives::*, refund::RefundReason, scenario::EconomyScenario, signing::*,
};
use crate::engine;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SimulationSummary {
    pub initial_history_id: String,
    pub final_history_id: String,
    pub version: String,
    pub seed: u32,
    pub turns: u32,
    pub winner: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EconomyDemo {
    pub schema_version: u32,
    pub simulation: SimulationSummary,
    pub economy: MatchEconomy,
    pub funded_pot: Amount,
    pub events: Vec<EconomyEvent>,
    pub balances: BTreeMap<AgentId, Amount>,
    pub settlement: Option<SettlementResult>,
    pub wallet_identity: WalletIdentity,
    pub signed_message: SignedArtifact,
}
pub fn run(scenario: &EconomyScenario) -> Result<EconomyDemo> {
    let mut simulation = scenario.initial()?;
    let initial_history_id = simulation.match_id.clone();
    let mut economy = EconomyCoordinator::mock(&simulation, &scenario.economy, &scenario.instance)?;
    economy.open_funding()?;
    for agent in economy.view().required_agents {
        economy.fund(&agent)?;
    }
    let funded_pot = economy.view().pot_amount;
    economy.lock()?;
    economy.start()?;
    while !simulation.final_state.ended {
        engine::advance(&mut simulation, None).map_err(EconomyError::AdapterFailure)?;
    }
    let settlement = if simulation.winner.is_some() {
        let result = economy.settle(&simulation)?;
        let repeated = economy.settle(&simulation)?;
        if repeated != result {
            return Err(EconomyError::Conflict);
        }
        Some(result)
    } else {
        economy.refund(RefundReason::NoWinnerFinished, Some(&simulation))?;
        None
    };
    let balances = economy
        .view()
        .required_agents
        .iter()
        .map(|id| Ok((id.clone(), economy.balance(id)?)))
        .collect::<Result<_>>()?;
    let signer = MockSigner::new(economy.view().required_agents[0].clone(), scenario.seed)?;
    let signed_message = signer.sign_message(economy.view().match_id.as_str().as_bytes())?;
    signer.verify(
        SigningDomain::PublicMessage,
        economy.view().match_id.as_str().as_bytes(),
        &signed_message,
    )?;
    Ok(EconomyDemo {
        schema_version: 1,
        simulation: SimulationSummary {
            initial_history_id,
            final_history_id: simulation.match_id,
            version: simulation.simulation_version,
            seed: simulation.seed,
            turns: simulation.final_state.turn,
            winner: simulation.winner,
        },
        economy: economy.view(),
        funded_pot,
        events: economy.events().to_vec(),
        balances,
        settlement,
        wallet_identity: signer.identity(),
        signed_message,
    })
}
