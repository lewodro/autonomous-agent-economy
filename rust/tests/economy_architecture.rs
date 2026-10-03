use agent_arena_demo::economy::primitives::*;
#[test]
fn amounts_preserve_precision_and_reject_overflow_or_overspend() {
    let maximum = Amount::new(u64::MAX);
    assert!(maximum.add(Amount::new(1)).is_err());
    assert!(maximum.multiply(2).is_err());
    assert!(Amount::new(1).subtract(Amount::new(2)).is_err());
    let json = serde_json::to_string(&maximum).unwrap();
    assert_eq!(json, "\"18446744073709551615\"");
    assert_eq!(serde_json::from_str::<Amount>(&json).unwrap(), maximum);
    assert!(serde_json::from_str::<Amount>("1").is_err());
    assert!(serde_json::from_str::<Amount>("\"01\"").is_err());
}
#[test]
fn identifiers_cannot_be_paths_or_empty_values() {
    assert!(RunId::new("../../escape").is_err());
    assert!(AgentId::new("").is_err());
    assert_eq!(
        OperationId::new("entry-agent-1").unwrap().as_str(),
        "entry-agent-1"
    );
}
use agent_arena_demo::economy::lifecycle::EconomyState;
#[test]
fn lifecycle_validates_every_pair_and_terminal_states_cannot_restart() {
    use EconomyState::*;
    let states = [
        Unfunded,
        Funding,
        Funded,
        Locked,
        Running,
        SettlementPending,
        Settled,
        RefundPending,
        Refunded,
        Failed,
    ];
    let happy = [
        Unfunded,
        Funding,
        Funded,
        Locked,
        Running,
        SettlementPending,
        Settled,
    ];
    for pair in happy.windows(2) {
        assert_eq!(pair[0].transition(pair[1]).unwrap(), pair[1]);
    }
    assert!(Funding.transition(RefundPending).is_ok());
    assert!(RefundPending.transition(Refunded).is_ok());
    assert!(Failed.transition(RefundPending).is_ok());
    for state in states {
        assert!(state.transition(state).is_err());
        assert!(Settled.transition(state).is_err());
        assert!(Refunded.transition(state).is_err());
    }
    assert!(Unfunded.transition(Running).is_err());
    assert!(Running.transition(RefundPending).is_ok());
    assert!(Funded.transition(Settled).is_err());
}
use agent_arena_demo::economy::config::*;
fn economy_config(entry: &str) -> EconomyConfig {
    EconomyConfig {
        enabled: true,
        mode: PaymentMode::Mock,
        entry_amount_sol: entry.into(),
        starting_balance_sol: "1.0".into(),
        maximum_entry_sol: "0.05".into(),
        minimum_reserve_sol: "0.005".into(),
    }
}
#[test]
fn configuration_uses_exact_amounts_enforces_reserves_and_rejects_mainnet() {
    for (text, units) in [
        ("0", 0),
        ("0.02", 20_000_000),
        ("0.03", 30_000_000),
        ("0.05", 50_000_000),
        ("1.000000001", 1_000_000_001),
    ] {
        assert_eq!(parse_sol(text).unwrap().units(), units);
    }
    for text in ["-1", "NaN", "0.0000000001", "1e3", "01.2", ".02", "1."] {
        assert!(parse_sol(text).is_err());
    }
    assert!(economy_config("0.02").validate().is_ok());
    assert!(economy_config("0.06").validate().is_err());
    let mut cfg = economy_config("0.05");
    cfg.starting_balance_sol = "0.05".into();
    assert!(cfg.validate().is_err());
    cfg.mode = PaymentMode::Mainnet;
    assert_eq!(
        cfg.validate().unwrap_err(),
        EconomyError::MainnetNotImplemented
    );
    assert!(serde_json::from_str::<EconomyConfig>(r#"{"enabled":true,"mode":"mock","entry_amount_sol":0.02,"starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0"}"#).is_err());
}
use agent_arena_demo::economy::events::*;
#[test]
fn economy_events_serialize_public_projections_and_precise_base_units() {
    let run = RunId::new("eco-test").unwrap();
    let projection = MatchEconomy {
        match_id: run.clone(),
        simulation_start_id: "seat-test".into(),
        payment_mode: PaymentMode::Mock,
        entry_amount: Amount::new(20_000_000),
        required_agents: vec![AgentId::new("agent-1").unwrap()],
        funded_agents: Default::default(),
        pot_amount: Amount::ZERO,
        state: EconomyState::Funding,
        settlement_status: SettlementStatus::NotStarted,
    };
    let event = EconomyEvent {
        schema_version: 1,
        seq: 0,
        match_id: run,
        kind: EconomyEventKind::FundingOpened,
        projection,
    };
    let json = serde_json::to_value(&event).unwrap();
    assert_eq!(json["type"], "FundingOpened");
    assert_eq!(json["projection"]["entry_amount"], "20000000");
    assert_eq!(serde_json::from_value::<EconomyEvent>(json).unwrap(), event);
}
use agent_arena_demo::economy::treasury::*;
#[test]
fn treasury_transfers_are_atomic_and_conserve_funds() {
    let mut ledger = TreasuryLedger::default();
    let a = AccountId::new("agent-a").unwrap();
    let b = AccountId::new("agent-b").unwrap();
    ledger.open(a.clone(), Amount::new(100)).unwrap();
    ledger.open(b.clone(), Amount::new(20)).unwrap();
    assert!(ledger.open(a.clone(), Amount::new(999)).is_err());
    assert!(ledger.transfer(&a, &b, Amount::new(101)).is_err());
    assert_eq!(ledger.balance(&a).unwrap(), Amount::new(100));
    assert!(ledger
        .transfer(&a, &AccountId::new("missing").unwrap(), Amount::new(1))
        .is_err());
    assert_eq!(ledger.total().unwrap(), Amount::new(120));
    ledger.transfer(&a, &b, Amount::new(30)).unwrap();
    assert_eq!(
        ledger
            .agent(&AgentId::new("agent-a").unwrap())
            .unwrap()
            .balance,
        Amount::new(70)
    );
    assert_eq!(ledger.total().unwrap(), Amount::new(120));
}
use agent_arena_demo::economy::rail::*;
fn entry_intent() -> PaymentIntent {
    PaymentIntent {
        operation_id: OperationId::new("entry-a").unwrap(),
        match_id: RunId::new("eco-one").unwrap(),
        payer: AccountId::new("agent-a").unwrap(),
        payee: AccountId::new("escrow-one").unwrap(),
        amount: Amount::new(20_000_000),
        purpose: PaymentPurpose::Entry,
    }
}
#[test]
fn rail_messages_round_trip_without_signing_keys_or_chain_dependencies() {
    let intent = entry_intent();
    let receipt = PaymentReceipt {
        receipt_id: intent.operation_id.clone(),
        intent: intent.clone(),
        status: ConfirmationStatus::Confirmed,
        external_reference: None,
    };
    assert_eq!(
        serde_json::from_value::<PaymentReceipt>(serde_json::to_value(&receipt).unwrap()).unwrap(),
        receipt
    );
    assert_eq!(receipt.intent.match_id, intent.match_id);
}
use agent_arena_demo::economy::mock_rail::MockPaymentRail;
fn mock_rail() -> MockPaymentRail {
    let mut ledger = TreasuryLedger::default();
    ledger
        .open(
            AccountId::new("agent-a").unwrap(),
            Amount::new(1_000_000_000),
        )
        .unwrap();
    ledger
        .open(AccountId::new("escrow-one").unwrap(), Amount::ZERO)
        .unwrap();
    MockPaymentRail::new(ledger, Amount::new(5_000_000))
}
#[test]
fn mock_rail_verifies_recorded_receipts_and_retries_never_double_debit() {
    let mut rail = mock_rail();
    let intent = entry_intent();
    let prepared = rail.prepare_payment(intent.clone()).unwrap();
    let first = rail.submit_payment(&prepared).unwrap();
    let second = rail.submit_payment(&prepared).unwrap();
    assert_eq!(first, second);
    assert_eq!(
        rail.get_balance(&intent.payer).unwrap(),
        Amount::new(980_000_000)
    );
    assert_eq!(rail.receipt_count(), 1);
    assert_eq!(rail.total().unwrap(), Amount::new(1_000_000_000));
    rail.verify_payment(&first, &intent).unwrap();
    let mut conflict = intent.clone();
    conflict.amount = Amount::new(1);
    assert!(rail.prepare_payment(conflict).is_err());
    let mut forged = first;
    forged.intent.match_id = RunId::new("another-match").unwrap();
    assert!(rail.verify_payment(&forged, &forged.intent).is_err());
    let mut tampered = prepared;
    tampered.authorization = "invented".into();
    assert!(rail.submit_payment(&tampered).is_err());
}
#[test]
fn concurrent_preparations_recheck_reserves_at_submission() {
    let mut rail = mock_rail();
    let mut first = entry_intent();
    first.amount = Amount::new(600_000_000);
    let a = rail.prepare_payment(first.clone()).unwrap();
    first.operation_id = OperationId::new("entry-b").unwrap();
    let b = rail.prepare_payment(first).unwrap();
    rail.submit_payment(&a).unwrap();
    assert!(rail.submit_payment(&b).is_err());
    assert_eq!(rail.total().unwrap(), Amount::new(1_000_000_000));
}
use agent_arena_demo::economy::escrow::*;
#[test]
fn escrow_status_is_public_and_chain_independent() {
    let view = EscrowView {
        match_id: RunId::new("eco-one").unwrap(),
        account: AccountId::new("escrow-one").unwrap(),
        state: EscrowState::Open,
        deposits: Default::default(),
        pot_amount: Amount::ZERO,
    };
    assert_eq!(
        serde_json::from_value::<EscrowView>(serde_json::to_value(&view).unwrap()).unwrap(),
        view
    );
}
use agent_arena_demo::economy::mock_escrow::MockEscrow;
fn funded_escrow() -> (MockPaymentRail, MockEscrow) {
    let run = RunId::new("eco-one").unwrap();
    let account = AccountId::new("escrow-one").unwrap();
    let mut ledger = TreasuryLedger::default();
    ledger.open(account.clone(), Amount::ZERO).unwrap();
    let participants = ["agent-a", "agent-b"]
        .into_iter()
        .map(|id| {
            let account = AccountId::new(id).unwrap();
            ledger
                .open(account.clone(), Amount::new(1_000_000_000))
                .unwrap();
            (AgentId::new(id).unwrap(), account)
        })
        .collect();
    let mut rail = MockPaymentRail::new(ledger, Amount::ZERO);
    let mut escrow = MockEscrow::open(
        run.clone(),
        participants,
        Amount::new(20_000_000),
        account.clone(),
    )
    .unwrap();
    assert!(escrow.lock(&rail).is_err());
    for agent in ["agent-a", "agent-b"] {
        let payer = AccountId::new(agent).unwrap();
        let intent = PaymentIntent {
            operation_id: operation_id(&run, PaymentPurpose::Entry, &payer, &account).unwrap(),
            match_id: run.clone(),
            payer,
            payee: account.clone(),
            amount: Amount::new(20_000_000),
            purpose: PaymentPurpose::Entry,
        };
        let prepared = rail.prepare_payment(intent).unwrap();
        let receipt = rail.submit_payment(&prepared).unwrap();
        escrow.deposit(&rail, &receipt).unwrap();
        escrow.deposit(&rail, &receipt).unwrap();
    }
    escrow.lock(&rail).unwrap();
    (rail, escrow)
}
#[test]
fn escrow_locks_exact_pot_and_settlement_or_refund_is_idempotent() {
    let (mut rail, mut escrow) = funded_escrow();
    assert_eq!(escrow.status().unwrap().pot_amount, Amount::new(40_000_000));
    assert!(escrow
        .settle(&mut rail, &AgentId::new("outsider").unwrap())
        .is_err());
    let winner = AgentId::new("agent-b").unwrap();
    let receipt = escrow.settle(&mut rail, &winner).unwrap();
    assert_eq!(escrow.settle(&mut rail, &winner).unwrap(), receipt);
    assert_eq!(
        rail.get_balance(&AccountId::new("agent-b").unwrap())
            .unwrap(),
        Amount::new(1_020_000_000)
    );
    assert!(escrow.refund(&mut rail).is_err());
    let (mut rail, mut escrow) = funded_escrow();
    let refunded = escrow.refund(&mut rail).unwrap();
    assert_eq!(escrow.refund(&mut rail).unwrap(), refunded);
    assert_eq!(
        rail.get_balance(&AccountId::new("agent-a").unwrap())
            .unwrap(),
        Amount::new(1_000_000_000)
    );
    assert!(escrow.settle(&mut rail, &winner).is_err());
}
use agent_arena_demo::economy::binding::SimulationBinding;
use agent_arena_demo::{config as game_config, engine};
#[test]
fn stable_economy_id_binds_version_configuration_and_instance() {
    let initial = engine::start(game_config::default_config(2, 9)).unwrap();
    let binding = SimulationBinding::from_initial(&initial).unwrap();
    let instance = OperationId::new("demo-1").unwrap();
    let id = binding.run_id(&instance).unwrap();
    assert_eq!(binding.run_id(&instance).unwrap(), id);
    assert_ne!(
        binding
            .run_id(&OperationId::new("demo-2").unwrap())
            .unwrap(),
        id
    );
    let mut finished = initial;
    while !finished.final_state.ended {
        engine::advance(&mut finished, None).unwrap();
    }
    assert_ne!(finished.match_id, binding.initial_history_id);
    assert!(binding.verify_finished(&finished).is_ok());
    let mut forged = finished.clone();
    forged.winner = Some("outsider".into());
    assert!(binding.verify_finished(&forged).is_err());
    assert!(SimulationBinding::from_initial(&finished).is_err());
    let other = SimulationBinding::from_initial(
        &engine::start(game_config::default_config(2, 10)).unwrap(),
    )
    .unwrap();
    assert!(other.verify_finished(&finished).is_err());
}
use agent_arena_demo::economy::coordinator::EconomyCoordinator;
fn funded_coordinator(
    count: usize,
    entry: &str,
) -> (
    agent_arena_demo::model::Replay,
    EconomyCoordinator<MockPaymentRail, MockEscrow>,
) {
    let initial = engine::start(game_config::default_config(count, 9)).unwrap();
    let mut economy = EconomyCoordinator::mock(
        &initial,
        &economy_config(entry),
        &OperationId::new("integration-1").unwrap(),
    )
    .unwrap();
    economy.open_funding().unwrap();
    for agent in initial
        .config
        .agents
        .iter()
        .map(|a| AgentId::new(&a.id).unwrap())
    {
        economy.fund(&agent).unwrap();
        economy.fund(&agent).unwrap();
    }
    (initial, economy)
}
#[test]
fn coordinator_funds_requested_populations_and_exact_pots_before_lock() {
    for (count, entry, units) in [
        (2, "0.05", 50_000_000),
        (4, "0.02", 20_000_000),
        (4, "0.05", 50_000_000),
        (8, "0.02", 20_000_000),
    ] {
        let (initial, mut economy) = funded_coordinator(count, entry);
        assert_eq!(economy.view().state, EconomyState::Funded);
        assert_eq!(economy.view().pot_amount, Amount::new(count as u64 * units));
        for agent in initial.config.agents {
            assert_eq!(
                economy.balance(&AgentId::new(agent.id).unwrap()).unwrap(),
                Amount::new(1_000_000_000 - units)
            );
        }
        economy.lock().unwrap();
        economy.start().unwrap();
        assert_eq!(economy.view().state, EconomyState::Running);
        for (seq, event) in economy.events().iter().enumerate() {
            assert_eq!(event.seq, seq as u64);
            assert_eq!(event.match_id, economy.view().match_id);
        }
    }
}
#[test]
fn settlement_requires_finished_verified_match_and_pays_only_once() {
    let (mut run, mut economy) = funded_coordinator(2, "0.05");
    economy.lock().unwrap();
    economy.start().unwrap();
    assert!(economy.settle(&run).is_err());
    while !run.final_state.ended {
        engine::advance(&mut run, None).unwrap();
    }
    let winner = AgentId::new(run.winner.clone().unwrap()).unwrap();
    let before = economy.balance(&winner).unwrap();
    let mut forged = run.clone();
    forged.final_state.ended = false;
    assert!(economy.settle(&forged).is_err());
    let result = economy.settle(&run).unwrap();
    let events = economy.events().len();
    assert_eq!(economy.settle(&run).unwrap(), result);
    assert_eq!(economy.events().len(), events);
    assert_eq!(result.amount, Amount::new(100_000_000));
    assert_eq!(
        economy.balance(&winner).unwrap(),
        before.add(result.amount).unwrap()
    );
    assert_eq!(economy.view().state, EconomyState::Settled);
    assert_eq!(economy.view().pot_amount, Amount::ZERO);
}
#[test]
fn settlement_cannot_use_another_run_configuration_or_an_unfunded_match() {
    let initial = engine::start(game_config::default_config(2, 9)).unwrap();
    let mut economy = EconomyCoordinator::mock(
        &initial,
        &economy_config("0.02"),
        &OperationId::new("unfunded").unwrap(),
    )
    .unwrap();
    let mut run = initial;
    while !run.final_state.ended {
        engine::advance(&mut run, None).unwrap();
    }
    assert!(economy.settle(&run).is_err());
    let (_, mut another) = funded_coordinator(4, "0.02");
    another.lock().unwrap();
    another.start().unwrap();
    assert!(another.settle(&run).is_err());
}
use agent_arena_demo::economy::refund::RefundReason;
#[test]
fn partial_funding_failure_refunds_only_verified_entries_without_double_credit() {
    let initial = engine::start(game_config::default_config(4, 9)).unwrap();
    let mut economy = EconomyCoordinator::mock(
        &initial,
        &economy_config("0.02"),
        &OperationId::new("partial").unwrap(),
    )
    .unwrap();
    economy.open_funding().unwrap();
    let first = AgentId::new("agent-1").unwrap();
    economy.fund(&first).unwrap();
    economy
        .fail_before_lock(EconomyError::AdapterFailure("Funding timed out".into()))
        .unwrap();
    economy.refund(RefundReason::FundingFailed, None).unwrap();
    let events = economy.events().len();
    economy.refund(RefundReason::FundingFailed, None).unwrap();
    assert_eq!(events, economy.events().len());
    for agent in economy.view().required_agents {
        assert_eq!(economy.balance(&agent).unwrap(), Amount::new(1_000_000_000));
    }
    assert_eq!(economy.view().state, EconomyState::Refunded);
}
#[test]
fn refund_policy_blocks_running_or_settlement_cancellation() {
    let (_, mut economy) = funded_coordinator(2, "0.02");
    economy.lock().unwrap();
    economy.start().unwrap();
    assert!(economy
        .refund(RefundReason::CancelledBeforeStart, None)
        .is_err());
    assert!(economy.fail_before_lock(EconomyError::Conflict).is_err());
    assert!(economy
        .refund(RefundReason::NoWinnerFinished, None)
        .is_err());
    let (_, mut economy) = funded_coordinator(2, "0.02");
    economy.lock().unwrap();
    economy
        .refund(RefundReason::CancelledBeforeStart, None)
        .unwrap();
    assert_eq!(economy.view().state, EconomyState::Refunded);
}
use agent_arena_demo::economy::signing::*;
#[test]
fn wallet_identity_contains_only_validated_public_fields() {
    let identity = WalletIdentity {
        agent_id: AgentId::new("agent-a").unwrap(),
        address: PublicAddress::new("mock:public-a").unwrap(),
    };
    let json = serde_json::to_value(&identity).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 2);
    assert!(PublicAddress::new("-----BEGIN PRIVATE KEY-----").is_err());
    assert!(PublicAddress::new("").is_err());
    assert_eq!(
        serde_json::from_value::<WalletIdentity>(json).unwrap(),
        identity
    );
}
use agent_arena_demo::economy::mock_signer::MockSigner;
#[test]
fn mock_signatures_are_deterministic_tamper_resistant_and_domain_separated() {
    let signer = MockSigner::new(AgentId::new("agent-a").unwrap(), 42).unwrap();
    let another = MockSigner::new(AgentId::new("agent-a").unwrap(), 42).unwrap();
    let message = signer.sign_message(b"entry intent").unwrap();
    assert_eq!(message, another.sign_message(b"entry intent").unwrap());
    signer
        .verify(SigningDomain::PublicMessage, b"entry intent", &message)
        .unwrap();
    assert!(signer
        .verify(SigningDomain::PublicMessage, b"changed intent", &message)
        .is_err());
    assert!(signer
        .verify(SigningDomain::MockTransaction, b"entry intent", &message)
        .is_err());
    let transaction = signer.sign_transaction(b"entry intent").unwrap();
    assert_ne!(transaction.signature, message.signature);
    assert_eq!(transaction.domain, SigningDomain::MockTransaction);
    assert!(signer.sign_message(&vec![0; 16_385]).is_err());
    let other = MockSigner::new(AgentId::new("agent-b").unwrap(), 42).unwrap();
    assert!(other
        .verify(SigningDomain::PublicMessage, b"entry intent", &message)
        .is_err());
}
use agent_arena_demo::economy::devnet::*;
#[test]
fn devnet_foundation_rejects_mainnet_bad_keys_rpc_data_and_payment_submission() {
    let mut cfg = DevnetRailConfig::default();
    cfg.mode = PaymentMode::Mainnet;
    assert_eq!(
        cfg.validate().unwrap_err(),
        EconomyError::MainnetNotImplemented
    );
    cfg = DevnetRailConfig::default();
    cfg.rpc_url = "https://api.mainnet-beta.solana.com".into();
    assert!(cfg.validate().is_err());
    assert!(SolanaPublicKey::parse("not-a-key").is_err());
    let key = SolanaPublicKey::parse(&bs58::encode([7; 32]).into_string()).unwrap();
    assert_eq!(SolanaPublicKey::parse(&key.address()).unwrap(), key);
    for value in [
        serde_json::json!({"value":1}),
        serde_json::json!({"context":{"slot":1},"value":-1}),
        serde_json::json!({"context":{"slot":1},"value":"1"}),
    ] {
        assert!(decode_balance(value).is_err());
    }
    assert_eq!(
        decode_balance(serde_json::json!({"context":{"slot":1},"value":123})).unwrap(),
        Amount::new(123)
    );
    let mut rail = SolanaDevnetRail::new(
        DevnetRailConfig::default(),
        [(AccountId::new("agent-a").unwrap(), key)].into(),
    )
    .unwrap();
    assert!(matches!(
        rail.prepare_payment(entry_intent()),
        Err(EconomyError::NotImplemented(_))
    ));
}
use agent_arena_demo::economy::scenario::EconomyScenario;
#[test]
fn sample_economy_scenarios_validate_without_paid_inference_or_wallet_secrets() {
    for text in [
        include_str!("../../examples/economy/free.json"),
        include_str!("../../examples/economy/mock-0.02.json"),
        include_str!("../../examples/economy/mock-0.05.json"),
    ] {
        let scenario: EconomyScenario = serde_json::from_str(text).unwrap();
        let initial = scenario.initial().unwrap();
        assert_eq!(initial.config.agents.len(), 4);
        assert!(initial.config.agents.iter().all(|a| a.provider == "mock"));
    }
    let mut scenario: EconomyScenario =
        serde_json::from_str(include_str!("../../examples/economy/mock-0.02.json")).unwrap();
    scenario.agents = 21;
    assert!(scenario.initial().is_err());
    scenario.agents = 4;
    scenario.economy.mode = PaymentMode::Mainnet;
    assert!(scenario.initial().is_err());
}
#[test]
fn one_command_mock_demo_funds_four_agents_and_pays_agent_c_exactly_once() {
    let scenario: EconomyScenario =
        serde_json::from_str(include_str!("../../examples/economy/mock-0.02.json")).unwrap();
    let report = agent_arena_demo::economy::demo::run(&scenario).unwrap();
    assert_eq!(report.funded_pot, Amount::new(80_000_000));
    assert_eq!(
        report.settlement.as_ref().unwrap().winner.as_str(),
        "agent-3"
    );
    for (id, balance) in report.balances {
        assert_eq!(
            balance,
            Amount::new(if id.as_str() == "agent-3" {
                1_060_000_000
            } else {
                980_000_000
            })
        );
    }
    assert_eq!(
        report
            .events
            .iter()
            .filter(|e| matches!(e.kind, EconomyEventKind::SettlementCompleted { .. }))
            .count(),
        1
    );
    let free: EconomyScenario =
        serde_json::from_str(include_str!("../../examples/economy/free.json")).unwrap();
    let free = agent_arena_demo::economy::demo::run(&free).unwrap();
    assert_eq!(free.funded_pot, Amount::ZERO);
    assert!(free.balances.values().all(|v| *v == Amount::ZERO));
}

#[test]
fn developer_lab_cannot_supply_winner_or_settle_before_finishing() {
    use agent_arena_demo::economy::{lab::EconomyLab, scenario::EconomyScenario};
    let scenario: EconomyScenario =
        serde_json::from_str(include_str!("../../examples/economy/mock-0.02.json")).unwrap();
    let mut lab = EconomyLab::new(&scenario).unwrap();
    assert!(lab.command("settle", None).is_err());
    for n in 1..=4 {
        lab.command("fund", Some(&format!("agent-{n}"))).unwrap();
    }
    lab.command("lock", None).unwrap();
    lab.command("finish", None).unwrap();
    let first = lab.command("settle", None).unwrap();
    let second = lab.command("settle", None).unwrap();
    assert_eq!(first, second);
    assert_eq!(first["economy"]["state"], "settled");
    assert!(lab.command("set-winner", Some("agent-1")).is_err());
}

#[test]
fn spectator_reason_contains_only_selected_public_state_and_summary() {
    use agent_arena_demo::{
        config, engine,
        model::{Action, Decision},
        public_reason::PublicDecisionReason,
    };
    let run = engine::start(config::default_config(4, 42)).unwrap();
    let choice = Decision {
        agent_id: "agent-1".into(),
        target: Some("agent-2".into()),
        action: Action::Challenge,
        reason: "Challenge a vulnerable rival.".into(),
    };
    let reason = PublicDecisionReason::from_decision(&choice, &engine::observe(&run));
    assert_eq!(reason.relevant_state.len(), 2);
    let json = serde_json::to_value(reason).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 2);
    assert!(serde_json::from_value::<PublicDecisionReason>(
        serde_json::json!({"summary":"Public","relevant_state":[],"thinking":"private"})
    )
    .is_err());
}

#[test]
fn uncertain_payout_reconciles_same_operation_without_refund_or_second_payment() {
    struct LostResponse {
        rail: MockPaymentRail,
        lost: bool,
    }
    impl PaymentRail for LostResponse {
        fn get_balance(&self, a: &AccountId) -> Result<Amount> {
            self.rail.get_balance(a)
        }
        fn prepare_payment(&mut self, i: PaymentIntent) -> Result<PreparedPayment> {
            self.rail.prepare_payment(i)
        }
        fn submit_payment(&mut self, p: &PreparedPayment) -> Result<PaymentReceipt> {
            let receipt = self.rail.submit_payment(p)?;
            if !self.lost && p.intent.purpose == PaymentPurpose::Payout {
                self.lost = true;
                return Err(EconomyError::AdapterFailure(
                    "response lost after transfer".into(),
                ));
            }
            Ok(receipt)
        }
        fn verify_payment(&self, r: &PaymentReceipt, i: &PaymentIntent) -> Result<()> {
            self.rail.verify_payment(r, i)
        }
    }
    let (rail, mut escrow) = funded_escrow();
    let mut rail = LostResponse { rail, lost: false };
    let winner = AgentId::new("agent-b").unwrap();
    assert!(escrow.settle(&mut rail, &winner).is_err());
    assert!(escrow.refund(&mut rail).is_err());
    assert!(escrow
        .settle(&mut rail, &AgentId::new("agent-a").unwrap())
        .is_err());
    let receipt = escrow.settle(&mut rail, &winner).unwrap();
    assert_eq!(escrow.settle(&mut rail, &winner).unwrap(), receipt);
    assert_eq!(rail.rail.receipt_count(), 3);
    assert_eq!(
        rail.get_balance(&AccountId::new("agent-b").unwrap())
            .unwrap(),
        Amount::new(1_020_000_000)
    );
}

#[test]
fn verified_finished_draw_refunds_and_cannot_declare_a_payout() {
    let mut cfg = game_config::default_config(2, 42);
    cfg.max_turns = 1;
    let mut run = engine::start(cfg).unwrap();
    let mut economy = EconomyCoordinator::mock(
        &run,
        &economy_config("0.02"),
        &OperationId::new("draw").unwrap(),
    )
    .unwrap();
    economy.open_funding().unwrap();
    for agent in economy.view().required_agents {
        economy.fund(&agent).unwrap();
    }
    economy.lock().unwrap();
    economy.start().unwrap();
    let decisions = run
        .config
        .agents
        .iter()
        .map(|a| agent_arena_demo::model::Decision {
            agent_id: a.id.clone(),
            action: agent_arena_demo::model::Action::Work,
            target: None,
            reason: "Earn safely.".into(),
        })
        .collect();
    engine::advance(&mut run, Some(decisions)).unwrap();
    assert!(run.final_state.ended);
    assert!(run.winner.is_none());
    assert!(economy.settle(&run).is_err());
    economy
        .refund(RefundReason::NoWinnerFinished, Some(&run))
        .unwrap();
    assert_eq!(economy.view().state, EconomyState::Refunded);
    for a in economy.view().required_agents {
        assert_eq!(economy.balance(&a).unwrap(), Amount::new(1_000_000_000));
    }
}
