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
