use agent_arena_demo::economy::{demo, events::EconomyEvent, scenario::EconomyScenario};
#[test]
fn semantic_event_schema_matches_the_reviewed_settlement_fixture() {
    let scenario: EconomyScenario =
        serde_json::from_str(include_str!("../../examples/economy/mock-0.02.json")).unwrap();
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../../test/fixtures/economy/settlement-v1.json"
    ))
    .unwrap();
    assert_eq!(
        serde_json::to_value(demo::run(&scenario).unwrap().events).unwrap(),
        expected
    );
    let decoded: Vec<EconomyEvent> = serde_json::from_value(expected.clone()).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), expected);
}
#[test]
fn refund_and_game_outcome_contracts_match_reviewed_fixtures() {
    use agent_arena_demo::economy::{
        config::EconomyConfig,
        coordinator::EconomyCoordinator,
        primitives::{AgentId, OperationId},
        refund::RefundReason,
    };
    let cfg:EconomyConfig=serde_json::from_value(serde_json::json!({"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"})).unwrap();
    let initial =
        agent_arena_demo::engine::start(agent_arena_demo::config::default_config(2, 42)).unwrap();
    let mut economy =
        EconomyCoordinator::mock(&initial, &cfg, &OperationId::new("fixture-refund").unwrap())
            .unwrap();
    economy.open_funding().unwrap();
    economy.fund(&AgentId::new("agent-1").unwrap()).unwrap();
    economy
        .refund(RefundReason::CancelledBeforeStart, None)
        .unwrap();
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("../../test/fixtures/economy/refund-v1.json")).unwrap();
    assert_eq!(serde_json::to_value(economy.events()).unwrap(), expected);
    let mut replay =
        agent_arena_demo::engine::start(agent_arena_demo::config::default_config(4, 42)).unwrap();
    while !replay.final_state.ended {
        agent_arena_demo::engine::advance(&mut replay, None).unwrap();
    }
    let selected: Vec<_> = replay
        .events
        .into_iter()
        .filter(|e| {
            matches!(
                e.kind,
                agent_arena_demo::model::Kind::MatchStarted
                    | agent_arena_demo::model::Kind::WinnerDeclared
            )
        })
        .collect();
    let golden: serde_json::Value = serde_json::from_str(include_str!(
        "../../test/fixtures/economy/game-outcome-v6.json"
    ))
    .unwrap();
    assert_eq!(serde_json::to_value(selected).unwrap(), golden);
}
