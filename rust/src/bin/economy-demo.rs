use agent_arena_demo::economy::{
    demo, devnet::*, primitives::*, rail::PaymentRail, scenario::EconomyScenario,
};
fn execute(args: &[String]) -> Result<serde_json::Value> {
    if args.iter().any(|a| a == "--mainnet") {
        return Err(EconomyError::MainnetNotImplemented);
    }
    if args.first().map(String::as_str) == Some("--devnet-balance") {
        if args.len() != 2 {
            return Err(EconomyError::InvalidInput(
                "Use --devnet-balance <public-key>".into(),
            ));
        }
        let key = SolanaPublicKey::parse(&args[1])?;
        let account = AccountId::new("probe")?;
        let rail = SolanaDevnetRail::new(
            DevnetRailConfig::default(),
            [(account.clone(), key.clone())].into(),
        )?;
        return Ok(
            serde_json::json!({"mode":"devnet","read_only":true,"address":key.address(),"balance":rail.get_balance(&account)?}),
        );
    }
    if args.len() > 1 {
        return Err(EconomyError::InvalidInput(
            "Use economy-demo [scenario.json]".into(),
        ));
    }
    let text = if let Some(file) = args.first() {
        std::fs::read_to_string(file).map_err(|e| EconomyError::InvalidInput(e.to_string()))?
    } else {
        include_str!("../../../examples/economy/mock-0.02.json").into()
    };
    let scenario: EconomyScenario =
        serde_json::from_str(&text).map_err(|e| EconomyError::InvalidInput(e.to_string()))?;
    serde_json::to_value(demo::run(&scenario)?)
        .map_err(|e| EconomyError::InvalidInput(e.to_string()))
}
fn main() {
    match execute(&std::env::args().skip(1).collect::<Vec<_>>()) {
        Ok(value) => println!("{}", serde_json::to_string_pretty(&value).unwrap()),
        Err(error) => {
            println!("{}", serde_json::json!({"error":error}));
            std::process::exit(1);
        }
    }
}
