use agent_arena_demo::{
    config,
    economy::{host::FundedHost, host_config::FundedMatchConfig, repository::*},
};
#[test]
fn settled_host_recovery_rejects_semantic_corruption_and_missing_attestation() {
    let root = std::env::temp_dir().join(format!(
        "settlement-recovery-{}",
        agent_arena_demo::wallet::address(&agent_arena_demo::wallet::key().unwrap())
    ));
    let config:FundedMatchConfig=serde_json::from_value(serde_json::json!({"simulation":config::default_config(2,42),"economy":{"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"}})).unwrap();
    let mut host = FundedHost::create(&root, "recovery", config).unwrap();
    host.fund("agent-1").unwrap();
    host.fund("agent-2").unwrap();
    while !host.replay().final_state.ended {
        host.step(host.replay().final_state.turn, None).unwrap();
    }
    assert_eq!(host.view()["economy"]["state"], "settled");
    drop(host);
    let directory = root.join("sessions/recovery");
    let repo = JsonRepository::open(&directory).unwrap();
    let original = repo.read::<serde_json::Value>("host").unwrap().unwrap();
    drop(repo);
    for field in [
        "attestation",
        "winner",
        "pot",
        "payout",
        "participants",
        "config",
    ] {
        let mut bad = original.clone();
        match field {
            "attestation" => bad["attestation"] = serde_json::Value::Null,
            "winner" => bad["settlement"]["winner_id"] = serde_json::json!("outsider"),
            "pot" => bad["settlement"]["pot_amount"] = serde_json::json!("1"),
            "payout" => bad["settlement"]["payout_amount"] = serde_json::json!("999999999"),
            "participants" => {
                bad["economy"]["economy"]["required_agents"] =
                    serde_json::json!(["outsider", "agent-2"])
            }
            _ => bad["config"]["simulation"]["seed"] = serde_json::json!(43),
        }
        let repo = JsonRepository::open(&directory).unwrap();
        repo.write("host", &bad).unwrap();
        drop(repo);
        assert!(
            FundedHost::load(&root, "recovery").is_err(),
            "accepted {field} corruption"
        );
    }
    let repo = JsonRepository::open(&directory).unwrap();
    repo.write("host", &original).unwrap();
    drop(repo);
    let mut host = FundedHost::load(&root, "recovery").unwrap();
    let before = host.view();
    assert_eq!(host.finalize().unwrap(), before);
    drop(host);
    std::fs::remove_dir_all(root).unwrap();
}
