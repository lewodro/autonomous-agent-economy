use agent_arena_demo::economy::{
    devnet::decode_balance,
    local_rail::verify_transaction,
    local_transaction::{SignedLocalTransfer, MEMO_PROGRAM},
    primitives::*,
};
use serde_json::{json, Value};
#[test]
fn incomplete_chain_evidence_cannot_confirm_payments_or_refunds() {
    let transfer = SignedLocalTransfer {
        reference: "sig".into(),
        wire: "wire".into(),
        sender: "from".into(),
        recipient: "to".into(),
        fee_payer: "sponsor".into(),
        amount: Amount::new(20),
        operation_id: OperationId::new("refund-op").unwrap(),
    };
    let tx = json!({"slot":1,"meta":{"err":null,"innerInstructions":[]},"transaction":{"signatures":["sig"],"message":{"accountKeys":[{"pubkey":"sponsor","signer":true},{"pubkey":"from","signer":true}],"instructions":[{"programId":"11111111111111111111111111111111","parsed":{"type":"transfer","info":{"source":"from","destination":"to","lamports":20}}},{"programId":MEMO_PROGRAM,"parsed":"refund-op"}]}}});
    verify_transaction(&tx, &transfer).unwrap();
    for (pointer, value) in [
        ("/slot", json!(-1)),
        ("/transaction/signatures", json!([])),
        ("/transaction/signatures", Value::Null),
        ("/transaction/message/accountKeys/1/signer", json!(false)),
        (
            "/transaction/message/instructions/0/parsed/info/destination",
            json!("other"),
        ),
        (
            "/transaction/message/instructions/0/parsed/info/lamports",
            json!(21),
        ),
        ("/meta/innerInstructions", json!({"unexpected":"shape"})),
    ] {
        let mut malformed = tx.clone();
        *malformed.pointer_mut(pointer).unwrap() = value;
        assert!(
            verify_transaction(&malformed, &transfer).is_err(),
            "accepted {pointer}"
        );
    }
    for value in [
        Value::Null,
        json!({}),
        json!({"context":{"slot":1},"value":-1}),
        json!({"context":{"slot":1},"value":"20"}),
        json!({"value":20}),
    ] {
        assert!(decode_balance(value).is_err());
    }
    assert_eq!(
        decode_balance(json!({"context":{"slot":1},"value":20})).unwrap(),
        Amount::new(20)
    );
}
