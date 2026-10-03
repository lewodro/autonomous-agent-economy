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
    assert!(Running.transition(RefundPending).is_err());
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
