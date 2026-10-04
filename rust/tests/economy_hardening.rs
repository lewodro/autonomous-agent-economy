use agent_arena_demo::{
    config,
    economy::{
        config::EconomyConfig, coordinator::EconomyCoordinator, events::EconomyEventKind,
        primitives::*, refund::RefundReason,
    },
    engine,
};

fn scenario(entry: &str) -> EconomyConfig {
    serde_json::from_value(serde_json::json!({"enabled":entry!="0","mode":"mock","entry_amount_sol":entry,"starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"})).unwrap()
}

fn total(
    economy: &EconomyCoordinator<
        agent_arena_demo::economy::mock_rail::MockPaymentRail,
        agent_arena_demo::economy::mock_escrow::MockEscrow,
    >,
) -> Amount {
    economy
        .view()
        .required_agents
        .iter()
        .fold(economy.view().pot_amount, |sum, id| {
            sum.add(economy.balance(id).unwrap()).unwrap()
        })
}

#[test]
fn deposit_conservation_and_terminal_exclusion_across_populations() {
    for count in [2, 4, 8, 20] {
        for seed in [9, 42] {
            let mut run = engine::start(config::default_config(count, seed)).unwrap();
            let mut economy = EconomyCoordinator::mock(
                &run,
                &scenario("0.02"),
                &OperationId::new(format!("invariant-{count}-{seed}")).unwrap(),
            )
            .unwrap();
            let capital = total(&economy);
            assert!(economy.start().is_err());
            economy.open_funding().unwrap();
            let players = economy.view().required_agents;
            for (index, player) in players.iter().enumerate() {
                economy.fund(player).unwrap();
                let before = serde_json::to_value(&economy).unwrap();
                economy.fund(player).unwrap();
                assert_eq!(serde_json::to_value(&economy).unwrap(), before);
                let deposits = economy
                    .events()
                    .iter()
                    .filter_map(|event| match event.kind {
                        EconomyEventKind::EntryReceived { amount, .. } => Some(amount.units()),
                        _ => None,
                    })
                    .sum::<u64>();
                assert_eq!(economy.view().pot_amount.units(), deposits);
                assert_eq!(deposits, 20_000_000 * (index as u64 + 1));
                assert_eq!(total(&economy), capital);
                if index + 1 < count {
                    assert!(economy.lock().is_err());
                }
            }
            let pot = economy.view().pot_amount;
            economy.lock().unwrap();
            economy.start().unwrap();
            assert!(economy.open_funding().is_err());
            while !run.final_state.ended {
                engine::advance(&mut run, None).unwrap();
            }
            if let Some(winner) = &run.winner {
                assert!(players.iter().any(|id| id.as_str() == winner));
                let result = economy.settle(&run).unwrap();
                assert!(result.amount <= pot);
                assert_eq!(result.amount, pot);
                let before = serde_json::to_value(&economy).unwrap();
                assert_eq!(economy.settle(&run).unwrap(), result);
                assert_eq!(serde_json::to_value(&economy).unwrap(), before);
                assert!(economy
                    .refund(RefundReason::CancelledBeforeStart, None)
                    .is_err());
                assert_eq!(
                    economy
                        .events()
                        .iter()
                        .filter(|e| matches!(e.kind, EconomyEventKind::SettlementCompleted { .. }))
                        .count(),
                    1
                );
            } else {
                economy
                    .refund(RefundReason::NoWinnerFinished, Some(&run))
                    .unwrap();
                assert!(economy.settle(&run).is_err());
            }
            assert_eq!(total(&economy), capital);
            assert_eq!(economy.view().pot_amount, Amount::ZERO);
        }
    }
}

#[test]
fn free_scenario_never_creates_payable_intents_or_changes_balances() {
    let mut run = engine::start(config::default_config(4, 42)).unwrap();
    let mut economy = EconomyCoordinator::mock(
        &run,
        &scenario("0"),
        &OperationId::new("free-invariant").unwrap(),
    )
    .unwrap();
    economy.open_funding().unwrap();
    for id in economy.view().required_agents {
        economy.fund(&id).unwrap();
    }
    economy.lock().unwrap();
    economy.start().unwrap();
    while !run.final_state.ended {
        engine::advance(&mut run, None).unwrap();
    }
    if run.winner.is_some() {
        economy.settle(&run).unwrap();
    } else {
        economy
            .refund(RefundReason::NoWinnerFinished, Some(&run))
            .unwrap();
    }
    // The existing mock sidecar records zero-value admission artifacts; none are payable.
    for event in economy.events() {
        if let EconomyEventKind::EntryRequested { amount, .. }
        | EconomyEventKind::EntryReceived { amount, .. }
        | EconomyEventKind::SettlementCompleted { amount, .. } = event.kind
        {
            assert_eq!(amount, Amount::ZERO);
        }
    }
    for id in economy.view().required_agents {
        assert_eq!(economy.balance(&id).unwrap().units(), 1_000_000_000);
    }
}
