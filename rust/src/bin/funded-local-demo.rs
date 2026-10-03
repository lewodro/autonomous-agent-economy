use agent_arena_demo::{
    config,
    economy::{
        config::{EconomyConfig, PaymentMode},
        fees::FeePolicy,
        host::FundedHost,
        host_api,
        host_config::FundedMatchConfig,
        primitives::*,
    },
};
use serde_json::json;
fn execute() -> Result<serde_json::Value> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let root = host_api::root();
    if args.first().map(String::as_str) == Some("--reconcile") {
        if args.len() > 2 {
            return Err(EconomyError::InvalidInput(
                "Use --reconcile [session]".into(),
            ));
        }
        let sessions = if let Some(id) = args.get(1) {
            vec![id.clone()]
        } else {
            FundedHost::list(&root)?
        };
        let mut reports = vec![];
        for session in sessions {
            let mut h = FundedHost::load(&root, &session)?;
            reports.push(h.reconcile()?);
        }
        return Ok(json!({"operation":"verification_only","matches":reports}));
    }
    let mut mode = PaymentMode::Local;
    let mut entry = "0.02".to_string();
    let mut seats = 4;
    let mut index = 0;
    while index < args.len() {
        let value = args
            .get(index + 1)
            .ok_or_else(|| EconomyError::InvalidInput("Flag value required".into()))?;
        match args[index].as_str() {
            "--mode" => {
                mode = match value.as_str() {
                    "mock" => PaymentMode::Mock,
                    "local" => PaymentMode::Local,
                    "mainnet" => return Err(EconomyError::MainnetNotImplemented),
                    _ => {
                        return Err(EconomyError::NotImplemented(
                            "Only mock/local supported".into(),
                        ))
                    }
                };
            }
            "--entry" => entry = value.clone(),
            "--agents" => {
                seats = value
                    .parse()
                    .map_err(|_| EconomyError::InvalidInput("Invalid seats".into()))?;
                if !(2..=20).contains(&seats) {
                    return Err(EconomyError::InvalidInput("Use 2–20 funded agents".into()));
                }
            }
            _ => return Err(EconomyError::InvalidInput("Unknown flag".into())),
        };
        index += 2;
    }
    let mut id = [0u8; 16];
    getrandom::fill(&mut id).map_err(|e| EconomyError::AdapterFailure(e.to_string()))?;
    id[6] = (id[6] & 15) | 64;
    id[8] = (id[8] & 63) | 128;
    let hex = id.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let session = format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    let config = FundedMatchConfig {
        simulation: config::default_config(seats, 42),
        economy: EconomyConfig {
            enabled: true,
            mode,
            entry_amount_sol: entry,
            starting_balance_sol: "1".into(),
            maximum_entry_sol: "0.05".into(),
            minimum_reserve_sol: "0.005".into(),
        },
        fees: FeePolicy::default(),
        funding_timeout_seconds: 600,
    };
    let mut h = FundedHost::create(&root, &session, config)?;
    for n in 1..=seats {
        h.fund(&format!("agent-{n}"))?;
    }
    let funding = h.view();
    while !h.replay().final_state.ended {
        h.step(h.replay().final_state.turn, None)?;
    }
    let before = h.view();
    let again = h.finalize()?;
    if before["settlement"] != again["settlement"] || before["wallets"] != again["wallets"] {
        return Err(EconomyError::Conflict);
    }
    drop(h);
    let h = FundedHost::load(&root, &session)?;
    let restored = h.view();
    if restored["settlement"] != before["settlement"] {
        return Err(EconomyError::Conflict);
    }
    Ok(
        json!({"session":session,"funding":funding["economy"],"result":restored,"restart_verified":true,"duplicate_payout_prevented":true,"watch_path":format!("/?watch={session}")}),
    )
}
fn main() {
    match execute() {
        Ok(v) => println!("{}", serde_json::to_string_pretty(&v).unwrap()),
        Err(e) => {
            println!("{}", json!({"error":e}));
            std::process::exit(1);
        }
    }
}
