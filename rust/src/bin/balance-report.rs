use agent_arena_demo::{config, engine, model::Kind};
use serde_json::json;
use std::collections::BTreeMap;
fn main() {
    let count = std::env::args()
        .nth(1)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(120);
    let version = std::env::args().nth(2).unwrap_or("last-seat-v3".into());
    let mut wins = BTreeMap::<String, u32>::new();
    let mut actions = BTreeMap::<String, u32>::new();
    let (mut turns, mut alliances, mut betrayal, mut draws, mut eliminations, mut eliminated_turns) =
        (0, 0, 0, 0, 0, 0);
    let mut min = u32::MAX;
    let mut max = 0;
    for seed in 1..=count {
        let mut cfg = config::default_config(4, seed);
        cfg.agents.rotate_left((seed % 4) as usize);
        let mut run = engine::start_version(cfg, &version).unwrap();
        while !run.final_state.ended {
            engine::advance(&mut run, None).unwrap();
        }
        turns += run.final_state.turn;
        min = min.min(run.final_state.turn);
        max = max.max(run.final_state.turn);
        if let Some(id) = &run.winner {
            *wins
                .entry(
                    run.config
                        .agents
                        .iter()
                        .find(|a| &a.id == id)
                        .unwrap()
                        .strategy
                        .clone(),
                )
                .or_default() += 1;
        } else {
            draws += 1;
        }
        for e in &run.events {
            match e.kind {
                Kind::AgentActionSelected => {
                    *actions
                        .entry(format!("{:?}", e.decision.as_ref().unwrap().action))
                        .or_default() += 1;
                }
                Kind::AllianceCreated => alliances += 1,
                Kind::AllianceBroken if e.reason.contains("betrayed") => betrayal += 1,
                Kind::AgentEliminated => {
                    eliminations += 1;
                    eliminated_turns += e.turn;
                }
                _ => {}
            }
        }
    }
    println!("{}",serde_json::to_string_pretty(&json!({"version":version,"matches":count,"seeds":format!("1..={count}"),"seats":4,"positions":"rotated by seed mod 4","mean_turns":turns as f64/count as f64,"min_turns":min,"max_turns":max,"wins":wins,"draws":draws,"action_usage":actions,"alliances":alliances,"betrayals":betrayal,"eliminations":eliminations,"mean_elimination_turn":eliminated_turns as f64/eliminations as f64})).unwrap());
}
