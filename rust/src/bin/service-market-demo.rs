use agent_arena_demo::economy::primitives::{AgentId, Amount, OperationId};
use agent_arena_demo::economy::service_market::DurableServiceMarket;
use agent_arena_demo::economy::service_market::ServiceMarket;
use agent_arena_demo::hashing::sha256_hex;
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::args()
        .nth(1)
        .ok_or("Usage: service-market-demo <storage-directory>")?;
    let worker = AgentId::new("agent_alpha")?;
    let peer = AgentId::new("agent_beta")?;
    let job = OperationId::new("research_summary_001")?;
    let delivery = OperationId::new("research_delivery_001")?;
    let mut store = DurableServiceMarket::open(&directory, || {
        ServiceMarket::new(&[worker.clone(), peer], Amount::new(100))
    })?;
    if !store.market.jobs.contains_key(&job) {
        store.apply(|market| {
            market.publish(
                job.clone(),
                worker.clone(),
                Amount::new(12),
                sha256_hex(b"verified research summary"),
            )
        })?;
    }
    store.apply(|market| market.submit(delivery, &job, &worker, "verified research summary"))?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "mode": "SIMULATED",
            "real_revenue": false,
            "storage_directory": directory,
            "job_id": job,
            "verified_jobs": store.market.verified_jobs,
            "mock_units_earned": store.market.earned,
            "buyer_remaining_mock_units": store.market.ledger.balance(&agent_arena_demo::economy::primitives::AccountId::new("service_buyer")?)?,
        }))?
    );
    Ok(())
}
