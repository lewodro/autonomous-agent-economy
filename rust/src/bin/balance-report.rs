use agent_arena_demo::{config, engine, model::Kind};
use serde_json::json;
use std::collections::BTreeMap;
fn number(index: usize, default: u32) -> u32 {
    match std::env::args().nth(index) {
        None => default,
        Some(value) => value.parse().unwrap_or_else(|_| {
            eprintln!("Argument {index} must be an unsigned integer");
            std::process::exit(1);
        }),
    }
}
fn main() {
    let count = number(1, 120);
    let version = std::env::args()
        .nth(2)
        .unwrap_or(agent_arena_demo::model::VERSION.into());
    let start = number(3, 1);
    let seats = number(4, 4) as usize;
    if !(1..=10000).contains(&count)
        || start == 0
        || start.checked_add(count - 1).is_none()
        || !(2..=20).contains(&seats)
    {
        eprintln!("Use 1–10000 matches, a valid positive seed range, and 2–20 seats");
        std::process::exit(1);
    }
    let last = start.checked_add(count - 1).unwrap();
    let mut wins = BTreeMap::<String, u32>::new();
    let mut actions = BTreeMap::<String, u32>::new();
    let (mut turns, mut alliances, mut betrayal, mut draws, mut eliminations, mut eliminated_turns) =
        (0, 0, 0, 0, 0, 0);
    let mut min = u32::MAX;
    let mut max = 0;
    for seed in start..=last {
        let mut cfg = config::default_config(seats, seed);
        cfg.agents.rotate_left(seed as usize % seats);
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
    println!("{}",serde_json::to_string_pretty(&json!({"version":version,"matches":count,"seeds":format!("{start}..={last}"),"seats":seats,"positions":format!("rotated by seed mod {seats}"),"mean_turns":turns as f64/count as f64,"min_turns":min,"max_turns":max,"wins":wins,"draws":draws,"action_usage":actions,"alliances":alliances,"betrayals":betrayal,"eliminations":eliminations,"mean_elimination_turn":if eliminations==0 {0.0}else{eliminated_turns as f64/eliminations as f64}})).unwrap());
}
