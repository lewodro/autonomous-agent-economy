use agent_arena_demo::economy::{
    config::EconomyConfig, coordinator::EconomyCoordinator, durable_rail::DurableMockRail,
    mock_escrow::MockEscrow, primitives::*, refund::RefundReason,
};
use agent_arena_demo::{config, engine};

#[test]
fn stale_coordinator_recovers_confirmed_refunds_without_recrediting() {
    let scenario: EconomyConfig = serde_json::from_value(serde_json::json!({"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"})).unwrap();
    let run = engine::start(config::default_config(4, 42)).unwrap();
    let path = std::env::temp_dir().join(format!("refund-recovery-{}", std::process::id()));
    let mut economy =
        EconomyCoordinator::mock(&run, &scenario, &OperationId::new("refund-crash").unwrap())
            .unwrap()
            .persist_rail(path.clone())
            .unwrap();
    economy.open_funding().unwrap();
    for id in ["agent-1", "agent-2"] {
        economy.fund(&AgentId::new(id).unwrap()).unwrap();
    }
    let stale = serde_json::to_vec(&economy).unwrap();
    economy.refund(RefundReason::FundingFailed, None).unwrap();
    let expected = serde_json::to_value(economy.view()).unwrap();
    drop(economy);
    let mut restored: EconomyCoordinator<DurableMockRail, MockEscrow> =
        serde_json::from_slice(&stale).unwrap();
    restored.refund(RefundReason::FundingFailed, None).unwrap();
    assert_eq!(serde_json::to_value(restored.view()).unwrap(), expected);
    let events = restored.events().len();
    restored.refund(RefundReason::FundingFailed, None).unwrap();
    assert_eq!(restored.events().len(), events);
    for n in 1..=4 {
        assert_eq!(
            restored
                .balance(&AgentId::new(format!("agent-{n}")).unwrap())
                .unwrap(),
            Amount::new(1_000_000_000)
        );
    }
    assert!(restored.fund(&AgentId::new("agent-3").unwrap()).is_err());
    assert!(restored.start().is_err());
    std::fs::remove_dir_all(path).unwrap();
}
