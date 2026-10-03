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
