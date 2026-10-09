use agent_arena_demo::economy::primitives::{
    AccountId, AgentId, Amount, EconomyError, OperationId,
};
use agent_arena_demo::economy::service_market::{
    DeliveryOutcome, DurableServiceMarket, ServiceMarket,
};
use agent_arena_demo::hashing::sha256_hex;
use std::fs;

fn agent(value: &str) -> AgentId {
    AgentId::new(value).unwrap()
}
fn op(value: &str) -> OperationId {
    OperationId::new(value).unwrap()
}
fn market() -> ServiceMarket {
    ServiceMarket::new(&[agent("a"), agent("b")], Amount::new(100)).unwrap()
}
fn temp_dir() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "service-market-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn verified_delivery_is_paid_once_from_funded_escrow() {
    let mut m = market();
    m.publish(
        op("work"),
        agent("a"),
        Amount::new(25),
        sha256_hex(b"finished"),
    )
    .unwrap();
    assert_eq!(
        m.ledger
            .balance(&AccountId::new("service_buyer").unwrap())
            .unwrap()
            .units(),
        75
    );
    assert_eq!(
        m.submit(op("try1"), &op("work"), &agent("a"), "wrong")
            .unwrap(),
        DeliveryOutcome::Rejected
    );
    assert_eq!(
        m.ledger
            .balance(&AccountId::new("a").unwrap())
            .unwrap()
            .units(),
        0
    );
    assert_eq!(
        m.submit(op("try2"), &op("work"), &agent("a"), "finished")
            .unwrap(),
        DeliveryOutcome::Paid
    );
    assert_eq!(
        m.submit(op("try2"), &op("work"), &agent("a"), "finished")
            .unwrap(),
        DeliveryOutcome::Paid
    );
    assert!(matches!(
        m.submit(op("try2"), &op("work"), &agent("a"), "changed"),
        Err(EconomyError::Conflict)
    ));
    assert!(m
        .submit(op("try3"), &op("work"), &agent("a"), "finished")
        .is_err());
    assert_eq!(
        m.ledger
            .balance(&AccountId::new("a").unwrap())
            .unwrap()
            .units(),
        25
    );
    assert_eq!(m.verified_jobs[&agent("a")], 1);
    m.check_conservation().unwrap();
}

#[test]
fn attempts_and_funding_are_bounded() {
    let mut m = market();
    assert!(matches!(
        m.publish(
            op("overspend"),
            agent("a"),
            Amount::new(101),
            sha256_hex(b"ok")
        ),
        Err(EconomyError::InsufficientFunds)
    ));
    assert!(m
        .publish(
            op("wrong_agent"),
            agent("stranger"),
            Amount::new(1),
            sha256_hex(b"ok")
        )
        .is_err());
    m.publish(op("job"), agent("a"), Amount::new(10), sha256_hex(b"ok"))
        .unwrap();
    assert!(m
        .submit(op("foreign"), &op("job"), &agent("b"), "ok")
        .is_err());
    for i in 0..3 {
        assert_eq!(
            m.submit(op(&format!("miss{i}")), &op("job"), &agent("a"), "bad")
                .unwrap(),
            DeliveryOutcome::Rejected
        );
    }
    assert!(m.submit(op("late"), &op("job"), &agent("a"), "ok").is_err());
    assert_eq!(
        m.ledger
            .balance(&AccountId::new("job_job").unwrap())
            .unwrap()
            .units(),
        10
    );
    m.check_conservation().unwrap();
}

#[test]
fn restart_resumes_balances_and_replay_does_not_write_revision() {
    let directory = temp_dir();
    {
        let mut store = DurableServiceMarket::open(&directory, || Ok(market())).unwrap();
        store
            .apply(|m| m.publish(op("j"), agent("a"), Amount::new(7), sha256_hex(b"answer")))
            .unwrap();
        store
            .apply(|m| m.submit(op("delivery"), &op("j"), &agent("a"), "answer"))
            .unwrap();
    }
    let before = fs::read_dir(&directory).unwrap().count();
    {
        let mut store = DurableServiceMarket::open(&directory, || panic!("must resume")).unwrap();
        assert_eq!(
            store
                .apply(|m| m.submit(op("delivery"), &op("j"), &agent("a"), "answer"))
                .unwrap(),
            DeliveryOutcome::Paid
        );
        assert_eq!(store.market.earned[&agent("a")].units(), 7);
    }
    assert_eq!(fs::read_dir(&directory).unwrap().count(), before);
    fs::remove_dir_all(directory).unwrap();
}
