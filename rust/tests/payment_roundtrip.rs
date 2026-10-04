use agent_arena_demo::economy::{
    config::PaymentMode, primitives::*, rail::*, records::*, repository::*,
};
fn intent(purpose: PaymentPurpose) -> PaymentIntent {
    PaymentIntent {
        operation_id: OperationId::new("op-roundtrip").unwrap(),
        match_id: RunId::new("eco-roundtrip").unwrap(),
        payer: AccountId::new("payer").unwrap(),
        payee: AccountId::new("payee").unwrap(),
        amount: Amount::new(20_000_000),
        purpose,
    }
}
#[test]
fn receipt_statuses_and_refund_purpose_survive_disk_roundtrip() {
    let directory = std::env::temp_dir().join(format!(
        "receipt-roundtrip-{}",
        agent_arena_demo::wallet::address(&agent_arena_demo::wallet::key().unwrap())
    ));
    let repo = JsonRepository::open(&directory).unwrap();
    for status in [
        ConfirmationStatus::Pending,
        ConfirmationStatus::Confirmed,
        ConfirmationStatus::Rejected,
        ConfirmationStatus::Unknown,
    ] {
        for purpose in [
            PaymentPurpose::Entry,
            PaymentPurpose::Payout,
            PaymentPurpose::Refund,
        ] {
            let receipt = PaymentReceipt {
                receipt_id: OperationId::new("op-roundtrip").unwrap(),
                intent: intent(purpose),
                status,
                external_reference: Some("public-test-reference".into()),
            };
            repo.write("receipt", &receipt).unwrap();
            assert_eq!(
                repo.read::<PaymentReceipt>("receipt").unwrap().unwrap(),
                receipt
            );
        }
    }
    drop(repo);
    let repo = JsonRepository::open(&directory).unwrap();
    assert_eq!(
        repo.read::<PaymentReceipt>("receipt")
            .unwrap()
            .unwrap()
            .intent
            .purpose,
        PaymentPurpose::Refund
    );
    drop(repo);
    std::fs::remove_dir_all(directory).unwrap();
}
#[test]
fn receipt_critical_fields_fail_closed_and_ancillary_fields_remain_compatible() {
    let receipt = serde_json::json!({"receipt_id":"op-roundtrip","intent":intent(PaymentPurpose::Entry),"status":"confirmed","external_reference":null});
    for (field, value) in [
        ("status", serde_json::json!("future-confirmed")),
        ("receipt_id", serde_json::json!("../escape")),
    ] {
        let mut bad = receipt.clone();
        bad[field] = value;
        assert!(serde_json::from_value::<PaymentReceipt>(bad).is_err());
    }
    let mut extended = receipt.clone();
    extended["future_display_hint"] = serde_json::json!(true);
    assert_eq!(
        serde_json::from_value::<PaymentReceipt>(extended).unwrap(),
        serde_json::from_value::<PaymentReceipt>(receipt.clone()).unwrap()
    );
    for value in [
        serde_json::json!(-1),
        serde_json::json!(20),
        serde_json::json!("-1"),
        serde_json::json!("01"),
        serde_json::json!("18446744073709551616"),
    ] {
        let mut bad = receipt.clone();
        bad["intent"]["amount"] = value;
        assert!(serde_json::from_value::<PaymentReceipt>(bad).is_err());
    }
}
#[test]
fn persisted_confirmation_requires_matching_proof_and_failed_records_roundtrip() {
    let i = intent(PaymentPurpose::Entry);
    let mut record = PaymentRecord::new(i.clone(), PaymentMode::Mock, 10).unwrap();
    record
        .submitted(
            PreparedPayment {
                intent: i.clone(),
                authorization: "mock-only".into(),
            },
            11,
        )
        .unwrap();
    record
        .confirmed(
            PaymentReceipt {
                receipt_id: i.operation_id.clone(),
                intent: i,
                status: ConfirmationStatus::Confirmed,
                external_reference: None,
            },
            12,
        )
        .unwrap();
    record.validate().unwrap();
    for change in [
        "missing_receipt",
        "wrong_amount",
        "wrong_status",
        "wrong_currency",
    ] {
        let mut bad = record.clone();
        match change {
            "missing_receipt" => bad.receipt = None,
            "wrong_amount" => bad.receipt.as_mut().unwrap().intent.amount = Amount::new(1),
            "wrong_status" => bad.receipt.as_mut().unwrap().status = ConfirmationStatus::Pending,
            _ => bad.currency = "TOKEN".into(),
        };
        assert!(bad.validate().is_err());
    }
    let mut failed =
        PaymentRecord::new(intent(PaymentPurpose::Refund), PaymentMode::Mock, 10).unwrap();
    failed.status = OperationStatus::Failed;
    failed
        .retry(
            EconomyError::RpcUnavailable("test RPC unavailable".into()),
            11,
        )
        .unwrap();
    failed.validate().unwrap();
    assert_eq!(
        serde_json::from_str::<PaymentRecord>(&serde_json::to_string(&failed).unwrap()).unwrap(),
        failed
    );
}
