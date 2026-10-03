use agent_arena_demo::economy::{config::PaymentMode, primitives::*, rail::*, records::*};
fn intent() -> PaymentIntent {
    PaymentIntent {
        operation_id: OperationId::new("op-test").unwrap(),
        match_id: RunId::new("eco-test").unwrap(),
        payer: AccountId::new("a").unwrap(),
        payee: AccountId::new("escrow").unwrap(),
        amount: Amount::new(20_000_000),
        purpose: PaymentPurpose::Entry,
    }
}
#[test]
fn durable_records_bind_exact_intent_and_confirmation_is_idempotent() {
    let i = intent();
    let p = PreparedPayment {
        intent: i.clone(),
        authorization: "signed-public-wire".into(),
    };
    let r = PaymentReceipt {
        receipt_id: i.operation_id.clone(),
        intent: i.clone(),
        status: ConfirmationStatus::Confirmed,
        external_reference: Some("tx".into()),
    };
    let mut record = PaymentRecord::new(i, PaymentMode::Mock, 10).unwrap();
    assert!(record.confirmed(r.clone(), 11).is_err());
    record.submitted(p, 11).unwrap();
    record
        .retry(EconomyError::AdapterFailure("RPC down".into()), 12)
        .unwrap();
    assert_eq!(record.next_retry_at, 14);
    record.confirmed(r.clone(), 13).unwrap();
    let saved = record.clone();
    record.confirmed(r.clone(), 14).unwrap();
    assert_eq!(record, saved);
    let mut bad = r;
    bad.intent.amount = Amount::new(1);
    assert!(record.confirmed(bad, 15).is_err());
    let json = serde_json::to_string(&record).unwrap();
    assert_eq!(
        serde_json::from_str::<PaymentRecord>(&json).unwrap(),
        record
    );
}

fn directory(label: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!(
        "seat-{label}-{}-{}",
        std::process::id(),
        agent_arena_demo::wallet::address(&agent_arena_demo::wallet::key().unwrap())
    ));
    p
}
#[test]
fn journal_is_atomic_append_only_locked_and_rejects_corruption() {
    use agent_arena_demo::economy::repository::*;
    let path = directory("journal");
    let repo = JsonRepository::open(&path).unwrap();
    assert!(JsonRepository::open(&path).is_err());
    repo.write("record", &serde_json::json!({"value":1}))
        .unwrap();
    repo.write("record", &serde_json::json!({"value":2}))
        .unwrap();
    assert_eq!(
        repo.read::<serde_json::Value>("record").unwrap().unwrap()["value"],
        2
    );
    assert!(repo.write("../escape", &0).is_err());
    drop(repo);
    let repo = JsonRepository::open(&path).unwrap();
    assert_eq!(
        repo.read::<serde_json::Value>("record").unwrap().unwrap()["value"],
        2
    );
    std::fs::write(path.join("record--000000000001.json"), b"{}").unwrap();
    assert!(repo.read::<serde_json::Value>("record").is_err());
    drop(repo);
    std::fs::remove_dir_all(path).unwrap();
}
#[test]
fn durable_mock_debit_receipt_and_duplicate_confirmation_survive_reload() {
    use agent_arena_demo::economy::{
        durable_rail::DurableMockRail, mock_rail::MockPaymentRail, treasury::TreasuryLedger,
    };
    let path = directory("rail");
    let mut ledger = TreasuryLedger::default();
    ledger
        .open(AccountId::new("a").unwrap(), Amount::new(1_000_000_000))
        .unwrap();
    ledger
        .open(AccountId::new("escrow").unwrap(), Amount::ZERO)
        .unwrap();
    let mut rail =
        DurableMockRail::create(path.clone(), MockPaymentRail::new(ledger, Amount::ZERO)).unwrap();
    let payment = rail.prepare_payment(intent()).unwrap();
    let before = serde_json::to_vec(&rail).unwrap();
    let receipt = rail.submit_payment(&payment).unwrap();
    let mut restored: DurableMockRail = serde_json::from_slice(&before).unwrap();
    restored.reload().unwrap();
    assert_eq!(restored.submit_payment(&payment).unwrap(), receipt);
    assert_eq!(
        restored.get_balance(&AccountId::new("a").unwrap()).unwrap(),
        Amount::new(980_000_000)
    );
    assert_eq!(restored.records().len(), 1);
    drop(restored);
    std::fs::remove_dir_all(path).unwrap();
}
#[test]
fn partially_funded_coordinator_reloads_without_recreating_money() {
    use agent_arena_demo::economy::{
        config::EconomyConfig, coordinator::EconomyCoordinator, durable_rail::DurableMockRail,
        mock_escrow::MockEscrow,
    };
    use agent_arena_demo::{config, engine};
    let scenario:EconomyConfig=serde_json::from_value(serde_json::json!({"enabled":true,"mode":"mock","entry_amount_sol":"0.02","starting_balance_sol":"1","maximum_entry_sol":"0.05","minimum_reserve_sol":"0.005"})).unwrap();
    let run = engine::start(config::default_config(4, 42)).unwrap();
    let path = directory("partial");
    let mut economy =
        EconomyCoordinator::mock(&run, &scenario, &OperationId::new("partial").unwrap())
            .unwrap()
            .persist_rail(path.clone())
            .unwrap();
    economy.open_funding().unwrap();
    for id in ["agent-1", "agent-2"] {
        economy.fund(&AgentId::new(id).unwrap()).unwrap();
    }
    let bytes = serde_json::to_vec(&economy).unwrap();
    drop(economy);
    let mut restored: EconomyCoordinator<DurableMockRail, MockEscrow> =
        serde_json::from_slice(&bytes).unwrap();
    restored.validate_recovery(&run).unwrap();
    for id in ["agent-3", "agent-4"] {
        restored.fund(&AgentId::new(id).unwrap()).unwrap();
    }
    assert_eq!(restored.view().pot_amount, Amount::new(80_000_000));
    restored.lock().unwrap();
    restored.start().unwrap();
    let mut bad: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    bad["economy"]["pot_amount"] = serde_json::json!("1");
    let bad: EconomyCoordinator<DurableMockRail, MockEscrow> = serde_json::from_value(bad).unwrap();
    assert!(bad.validate_recovery(&run).is_err());
    std::fs::remove_dir_all(path).unwrap();
}
#[test]
fn trusted_completion_rejects_changed_claims_or_another_authority() {
    use agent_arena_demo::economy::attestation::*;
    use agent_arena_demo::{config, engine, wallet};
    let mut run = engine::start(config::default_config(2, 42)).unwrap();
    while !run.final_state.ended {
        engine::advance(&mut run, None).unwrap();
    }
    let authority = HostAuthority::new(wallet::key().unwrap());
    let id = RunId::new("eco-attest").unwrap();
    let a = authority.attest(id.clone(), &run, 10).unwrap();
    authority.verify(&id, &run, &a).unwrap();
    for field in [
        "match_id",
        "winner_id",
        "event_log_hash",
        "final_state_hash",
        "engine_version",
    ] {
        let mut v = serde_json::to_value(&a).unwrap();
        v["claims"][field] = serde_json::json!("modified");
        let bad: CompletionAttestation = serde_json::from_value(v).unwrap();
        assert_eq!(
            authority.verify(&id, &run, &bad).unwrap_err(),
            EconomyError::InvalidAttestation
        );
    }
    assert!(HostAuthority::new(wallet::key().unwrap())
        .verify(&id, &run, &a)
        .is_err());
    let mut bad = a;
    bad.signature = "bad".into();
    assert!(authority.verify(&id, &run, &bad).is_err());
}
#[test]
fn local_signer_persists_identity_and_never_serializes_secrets() {
    use agent_arena_demo::economy::{local_signer::LocalDevSigner, signing::*};
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let path = directory("key");
    let keypath = path.join("agent.wallet.bin");
    let a = LocalDevSigner::load_or_create(&keypath, AgentId::new("a").unwrap()).unwrap();
    let identity = a.identity();
    drop(a);
    let a = LocalDevSigner::load_or_create(&keypath, AgentId::new("a").unwrap()).unwrap();
    assert_eq!(a.identity(), identity);
    let signed = a.sign_transaction(b"native-message").unwrap();
    let pubkey: [u8; 32] = bs58::decode(identity.address.as_str())
        .into_vec()
        .unwrap()
        .try_into()
        .unwrap();
    let signature =
        Signature::from_slice(&bs58::decode(&signed.signature).into_vec().unwrap()).unwrap();
    assert!(VerifyingKey::from_bytes(&pubkey)
        .unwrap()
        .verify(b"native-message", &signature)
        .is_ok());
    assert!(VerifyingKey::from_bytes(&pubkey)
        .unwrap()
        .verify(b"tampered", &signature)
        .is_err());
    std::fs::remove_dir_all(path).unwrap();
}
