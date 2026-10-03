use agent_arena_demo::{config, engine, model::*, replay, strategy};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{self, BufRead, Write},
};
fn request(value: Value, runs: &mut BTreeMap<String, Replay>) -> Result<Value, String> {
    let command = value["command"].as_str().ok_or("command required")?;
    let key = value["session"].as_str().unwrap_or("local").to_string();
    if command == "defaults" {
        let count = value["count"].as_u64().unwrap_or(4) as usize;
        if !(2..=20).contains(&count) {
            return Err("Use 2–20 agents".into());
        }
        return Ok(serde_json::to_value(config::default_config(count, 42)).unwrap());
    }
    if command == "import" || command == "verify" {
        let input: Replay =
            serde_json::from_value(value["replay"].clone()).map_err(|e| e.to_string())?;
        let verified = replay::verify(&input)?;
        if command == "import" {
            runs.insert(key, verified.clone());
        }
        return Ok(json!({"replay":verified}));
    }
    if command == "start" {
        let cfg: Config =
            serde_json::from_value(value["config"].clone()).map_err(|e| e.to_string())?;
        let run = engine::start(cfg)?;
        runs.insert(key, run.clone());
        return Ok(json!({"replay":run}));
    }
    let run = runs
        .get_mut(&key)
        .ok_or("Session not found; create a match first")?;
    match command {
        "observe" => Ok(
            json!({"observation":engine::observe(run),"config":run.config,"ended":run.final_state.ended}),
        ),
        "get" => Ok(json!({"replay":run})),
        "decide" => {
            let observation = engine::observe(run);
            let decisions: Vec<_> = run
                .final_state
                .agents
                .iter()
                .enumerate()
                .filter(|(_, a)| a.alive)
                .map(|(i, _)| strategy::choose(&run.config, &observation, i))
                .collect();
            Ok(json!({"decisions":decisions}))
        }
        "step" => {
            let decisions = if value["decisions"].is_null() {
                None
            } else {
                Some(
                    serde_json::from_value::<Vec<Decision>>(value["decisions"].clone())
                        .map_err(|e| e.to_string())?,
                )
            };
            let events = engine::advance(run, decisions)?;
            Ok(json!({"events":events,"replay":run}))
        }
        _ => Err("Unknown core command".into()),
    }
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--serve") {
        let cfg = if let Some(path) = args.get(1) {
            serde_json::from_str::<Config>(
                &std::fs::read_to_string(path).expect("Read config file"),
            )
            .expect("Parse config JSON")
        } else {
            config::default_config(4, 42)
        };
        let mut run = engine::start(cfg).expect("Validate config");
        while !run.final_state.ended {
            engine::advance(&mut run, None).unwrap();
        }
        println!("{}", serde_json::to_string_pretty(&run).unwrap());
        return;
    }
    let mut runs = BTreeMap::new();
    for line in io::stdin().lock().lines() {
        let result = line
            .map_err(|e| e.to_string())
            .and_then(|line| serde_json::from_str(&line).map_err(|e| e.to_string()))
            .and_then(|value| request(value, &mut runs));
        let output = match result {
            Ok(result) => json!({"ok":true,"result":result}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        println!("{}", output);
        io::stdout().flush().unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn verification_does_not_retain_a_session() {
        let run = engine::start(config::default_config(2, 42)).unwrap();
        let mut runs = BTreeMap::new();
        request(json!({"command":"verify","replay":run}), &mut runs).unwrap();
        assert!(runs.is_empty());
        request(
            json!({"command":"import","session":"loaded","replay":run}),
            &mut runs,
        )
        .unwrap();
        assert_eq!(runs.len(), 1);
        assert!(runs.contains_key("loaded"));
    }
}
