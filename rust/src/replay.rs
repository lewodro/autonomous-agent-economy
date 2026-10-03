use crate::{engine, model::*};
use std::collections::BTreeMap;
pub fn verify(input: &Replay) -> Result<Replay, String> {
    if ![VERSION, "last-seat-v2", "last-seat-v1"].contains(&input.simulation_version.as_str())
        || input.events.len() > 30000
        || input.final_state.turn > 200
    {
        return Err("Unsupported replay version or size".into());
    }
    let mut rebuilt = engine::start_version(input.config.clone(), &input.simulation_version)?;
    for turn in 1..=input.final_state.turn {
        let mut decisions = BTreeMap::new();
        for event in input.events.iter().filter(|e| {
            e.turn == turn && matches!(e.kind, Kind::AgentActionSelected | Kind::ActionRejected)
        }) {
            let d = event
                .decision
                .clone()
                .ok_or("Decision event missing intent")?;
            if event.kind == Kind::ActionRejected {
                decisions.insert(d.agent_id.clone(), d);
            } else {
                decisions.entry(d.agent_id.clone()).or_insert(d);
            }
        }
        engine::advance(
            &mut rebuilt,
            Some(
                input
                    .events
                    .iter()
                    .filter(|e| e.turn == turn && e.kind == Kind::AgentActionSelected)
                    .map(|e| decisions[&e.decision.as_ref().unwrap().agent_id].clone())
                    .collect(),
            ),
        )?;
    }
    // Decision ordering is meaningful. Use selection order rather than map ordering.
    if &rebuilt != input {
        return Err(
            "Replay does not match deterministic rules, recorded decisions, or its content ID"
                .into(),
        );
    }
    Ok(rebuilt)
}
