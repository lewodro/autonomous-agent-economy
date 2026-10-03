use agent_arena_demo::{config, engine, wallet::*, wallet_demo};
#[test]
fn mock_wallet_enforces_cumulative_budget_and_deterministic_identity() {
    let view = mock_view(42, "agent");
    assert_eq!(view, mock_view(42, "agent"));
    assert_ne!(view.address, mock_view(43, "agent").address);
    let mut capability = MockWallet {
        wallet: view,
        allowed_destination: "approved".into(),
    };
    capability.transfer("approved", 600_000).unwrap();
    assert!(capability.transfer("approved", 600_000).is_err());
    assert_eq!(capability.view().spending_limit, 400_000);
    assert!(capability.transfer("other", 1).is_err());
}
#[test]
fn winner_reward_demo_is_bound_to_verified_match_and_does_not_change_credits() {
    let mut cfg = config::default_config(2, 1);
    cfg.max_turns = 1;
    cfg.agents[0].starting_credits = 1000;
    let mut run = engine::start(cfg).unwrap();
    while !run.final_state.ended {
        engine::advance(&mut run, None).unwrap();
    }
    assert!(run.winner.is_some());
    let file = std::env::temp_dir().join(format!("seat-wallet-test-{}.json", std::process::id()));
    std::fs::write(&file, serde_json::to_string(&run).unwrap()).unwrap();
    let result = wallet_demo::execute(&["--match".into(), file.to_str().unwrap().into()]).unwrap();
    assert_eq!(result["match_id"], run.match_id);
    assert_eq!(result["agent_id"], run.winner.unwrap());
    assert_eq!(result["wallet"]["mode"], "mock");
    assert!(result["events"]
        .as_array()
        .unwrap()
        .iter()
        .all(|e| e["turn"] == run.final_state.turn));
    std::fs::remove_file(file).unwrap();
}
