//! Validate the existing JSON schemas without starting a match or accessing wallets.
use agent_arena_demo::{
    config,
    economy::{host_config::FundedMatchConfig, scenario::EconomyScenario},
    model::Config,
};
fn validate(kind: &str, text: &str) -> Result<(), String> {
    match kind {
        "simulation" => {
            config::validate(&serde_json::from_str::<Config>(text).map_err(|e| e.to_string())?)
        }
        "funded" => serde_json::from_str::<FundedMatchConfig>(text)
            .map_err(|e| e.to_string())?
            .validate()
            .map_err(|e| e.to_string()),
        "scenario" => serde_json::from_str::<EconomyScenario>(text)
            .map_err(|e| e.to_string())?
            .initial()
            .map(|_| ())
            .map_err(|e| e.to_string()),
        _ => Err("Use config-check <simulation|funded|scenario> <file.json>".into()),
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let result = if args.len() == 2 {
        std::fs::read_to_string(&args[1])
            .map_err(|e| e.to_string())
            .and_then(|text| validate(&args[0], &text))
    } else {
        Err("Use config-check <simulation|funded|scenario> <file.json>".into())
    };
    match result {
        Ok(()) => println!("{}", serde_json::json!({"ok":true,"schema":args[0]})),
        Err(detail) => {
            eprintln!(
                "{}",
                serde_json::json!({"ok":false,"code":"invalid_config","detail":detail})
            );
            std::process::exit(1);
        }
    }
}
