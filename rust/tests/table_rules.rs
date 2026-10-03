use agent_arena_demo::{config, engine, model::*, replay};
fn decisions(run: &Replay, action: Action) -> Vec<Decision> {
    run.final_state
        .agents
        .iter()
        .filter(|a| a.alive)
        .map(|a| Decision {
            agent_id: a.id.clone(),
            action,
            target: None,
            reason: "Test decision".into(),
        })
        .collect()
}

#[test]
fn oversized_decisions_are_rejected_without_recording_or_mutating_state() {
    for oversized_target in [false, true] {
        let mut run = engine::start(config::default_config(2, 42)).unwrap();
        let before = run.clone();
        let mut submitted = decisions(&run, Action::Guard);
        if oversized_target {
            submitted[0].target = Some("x".repeat(41));
        } else {
            submitted[0].reason = "x".repeat(601);
        }
        assert!(engine::advance(&mut run, Some(submitted)).is_err());
        assert_eq!(run, before);
    }
}

#[test]
#[ignore = "Full-size replay stress check; run with --release --ignored"]
fn maximum_size_match_is_replayable_within_transport_limits() {
    let mut cfg = config::default_config(20, 42);
    cfg.max_turns = 200;
    for agent in &mut cfg.agents {
        agent.starting_credits = 10_000;
    }
    let mut run = engine::start(cfg).unwrap();
    while !run.final_state.ended {
        engine::advance(&mut run, None).unwrap();
    }
    assert!(run.events.len() > 30_000);
    assert!(serde_json::to_vec(&run).unwrap().len() < MAX_REPLAY_BYTES);
    assert_eq!(replay::verify(&run).unwrap(), run);
}
#[test]
fn seeded_matches_are_byte_reproducible_and_replayable() {
    for n in [2, 4, 8, 20] {
        let mut a = engine::start(config::default_config(n, 42)).unwrap();
        let mut b = a.clone();
        while !a.final_state.ended {
            engine::advance(&mut a, None).unwrap();
            engine::advance(&mut b, None).unwrap();
            assert_eq!(a, b);
        }
        assert_eq!(replay::verify(&a).unwrap(), a);
        assert!(a.final_state.agents.iter().all(|a| a.credits >= 0));
    }
}
#[test]
fn guard_blocks_challenge_independent_of_initiative() {
    for version in ["last-seat-v1", "last-seat-v2", "last-seat-v3", VERSION] {
        for seed in 1..30 {
            let mut r = engine::start_version(config::default_config(2, seed), version).unwrap();
            let mut d = decisions(&r, Action::Guard);
            d[0].action = Action::Challenge;
            d[0].target = Some(d[1].agent_id.clone());
            engine::advance(&mut r, Some(d)).unwrap();
            let modern = matches!(version, "last-seat-v3" | "last-seat-v4" | "last-seat-v5");
            assert_eq!(
                r.final_state.agents[0].credits,
                if matches!(version, "last-seat-v3" | "last-seat-v5") {
                    9
                } else {
                    10
                }
            );
            assert_eq!(
                r.final_state.agents[1].credits,
                if modern { 13 } else { 12 }
            );
            assert_eq!(r.final_state.agents[1].stats.blocks, 1);
        }
    }
}

#[test]
fn published_replay_versions_keep_their_original_challenge_caps() {
    for version in [
        "last-seat-v1",
        "last-seat-v2",
        "last-seat-v3",
        "last-seat-v4",
    ] {
        let mut run = engine::start_version(config::default_config(2, 42), version).unwrap();
        let income = engine::observe(&run).income;
        let mut submitted = decisions(&run, Action::Work);
        submitted[0].action = Action::Challenge;
        submitted[0].target = Some(submitted[1].agent_id.clone());
        engine::advance(&mut run, Some(submitted)).unwrap();
        let cost = if version == "last-seat-v3" { 2 } else { 1 };
        let cap = if version == "last-seat-v4" { 4 } else { 5 };
        assert_eq!(run.final_state.agents[0].credits, 12 - cost + cap - 1);
        assert_eq!(run.final_state.agents[1].credits, 12 + income - cap - 1);
        assert_eq!(replay::verify(&run).unwrap(), run);
    }
}
#[test]
fn mutual_cooperation_rewards_once_and_betrayal_is_recorded() {
    let mut r = engine::start(config::default_config(2, 42)).unwrap();
    let mut d = decisions(&r, Action::Cooperate);
    d[0].target = Some(d[1].agent_id.clone());
    d[1].target = Some(d[0].agent_id.clone());
    engine::advance(&mut r, Some(d)).unwrap();
    assert_eq!(r.final_state.agents[0].credits, 14);
    assert_eq!(r.final_state.agents[1].credits, 14);
    assert_eq!(r.final_state.alliances.len(), 1);
    let mut d = decisions(&r, Action::Work);
    d[0].action = Action::Challenge;
    d[0].target = Some(d[1].agent_id.clone());
    engine::advance(&mut r, Some(d)).unwrap();
    assert!(r
        .events
        .iter()
        .any(|e| e.kind == Kind::AllianceBroken && e.reason.contains("betrayed")));
    assert!(r.final_state.alliances.is_empty());
    replay::verify(&r).unwrap();
}
#[test]
fn invalid_targets_fall_back_and_replay_preserves_rejection() {
    let mut r = engine::start(config::default_config(2, 42)).unwrap();
    let mut d = decisions(&r, Action::Challenge);
    d[0].target = Some(d[0].agent_id.clone());
    d[1].target = Some("missing".into());
    engine::advance(&mut r, Some(d)).unwrap();
    assert_eq!(
        r.events
            .iter()
            .filter(|e| e.kind == Kind::ActionRejected)
            .count(),
        2
    );
    replay::verify(&r).unwrap();
}
#[test]
fn duplicate_decisions_are_atomic() {
    let mut r = engine::start(config::default_config(2, 42)).unwrap();
    let before = r.clone();
    let mut d = decisions(&r, Action::Work);
    d[1] = d[0].clone();
    assert!(engine::advance(&mut r, Some(d)).is_err());
    assert_eq!(r, before);
}
#[test]
fn turn_limit_is_explicit_and_finished_match_cannot_advance() {
    let mut cfg = config::default_config(2, 42);
    cfg.max_turns = 1;
    let mut r = engine::start(cfg).unwrap();
    let d = decisions(&r, Action::Guard);
    engine::advance(&mut r, Some(d)).unwrap();
    assert!(r.final_state.ended);
    assert!(r.winner.is_none());
    assert!(r
        .final_state
        .end_reason
        .as_ref()
        .unwrap()
        .contains("Turn limit"));
    assert!(engine::advance(&mut r, None).is_err());
}
#[test]
fn tampered_credit_event_or_winner_is_rejected() {
    let mut r = engine::start(config::default_config(4, 42)).unwrap();
    engine::advance(&mut r, None).unwrap();
    let mut altered = r.clone();
    altered
        .events
        .iter_mut()
        .find(|e| e.kind == Kind::ResourceChanged)
        .unwrap()
        .after = Some(1000);
    assert!(replay::verify(&altered).is_err());
    r.winner = Some("fake".into());
    assert!(replay::verify(&r).is_err());
}
#[test]
fn configs_reject_unsafe_ids_resources_and_population() {
    let mut c = config::default_config(4, 42);
    c.agents[1].id = c.agents[0].id.clone();
    assert!(engine::start(c).is_err());
    let mut c = config::default_config(2, 42);
    c.agents[0].starting_credits = -1;
    assert!(engine::start(c).is_err());
    assert!(engine::start(config::default_config(1, 42)).is_err());
}
#[test]
fn observation_is_same_for_all_decisions_and_upkeep_increases() {
    let mut r = engine::start(config::default_config(4, 7)).unwrap();
    for _ in 0..5 {
        let before = engine::observe(&r);
        let events = engine::advance(&mut r, None).unwrap();
        assert_eq!(r.final_state.income, before.income);
        assert_eq!(r.final_state.upkeep, before.upkeep);
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == Kind::AgentActionSelected)
                .count(),
            4
        );
    }
    assert_eq!(r.final_state.upkeep, 2);
}

#[test]
fn semantic_contract_is_ordered_and_projects_authoritative_values() {
    let mut run = engine::start(config::default_config(4, 42)).unwrap();
    while !run.final_state.ended {
        let events = engine::advance(&mut run, None).unwrap();
        for e in &events {
            assert!(e.projection.is_some());
        }
        for (i, e) in run.events.iter().enumerate() {
            assert_eq!(e.seq, i);
        }
        let started = events
            .iter()
            .filter(|e| e.kind == Kind::ActionStarted)
            .count();
        assert_eq!(
            started,
            events
                .iter()
                .filter(|e| e.kind == Kind::ActionResolved)
                .count()
        );
        let end = events.last().unwrap();
        assert_eq!(end.kind, Kind::RoundEnded);
        assert_eq!(end.state.as_ref().unwrap(), &run.final_state);
    }
    assert_eq!(
        run.events
            .iter()
            .filter(|e| e.kind == Kind::WinnerDeclared)
            .count(),
        usize::from(run.winner.is_some())
    );
    replay::verify(&run).unwrap();
    let mut legacy = engine::start_version(config::default_config(2, 7), "last-seat-v1").unwrap();
    while !legacy.final_state.ended {
        engine::advance(&mut legacy, None).unwrap();
    }
    assert!(legacy.events.iter().all(|e| e.projection.is_none()));
    replay::verify(&legacy).unwrap();
}
