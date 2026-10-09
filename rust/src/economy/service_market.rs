//! Bounded, local-only service exchange. Balances are simulated units, never SOL.
use super::primitives::*;
use super::repository::{JsonRepository, RecoveryRepository};
use super::treasury::TreasuryLedger;
use crate::hashing::sha256_hex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

const MAX_AGENTS: usize = 20;
const MAX_JOBS: usize = 100;
const MAX_ATTEMPTS: u8 = 3;
const BUYER: &str = "service_buyer";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceJob {
    pub id: OperationId,
    pub assignee: AgentId,
    pub reward: Amount,
    pub expected_sha256: String,
    pub attempts: u8,
    pub settled: bool,
    pub receipt_sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryOutcome {
    Rejected,
    Paid,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Delivery {
    pub operation_id: OperationId,
    pub job_id: OperationId,
    pub agent_id: AgentId,
    pub submission_sha256: String,
    pub outcome: DeliveryOutcome,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceMarket {
    pub ledger: TreasuryLedger,
    pub jobs: BTreeMap<OperationId, ServiceJob>,
    pub deliveries: BTreeMap<OperationId, Delivery>,
    pub verified_jobs: BTreeMap<AgentId, u32>,
    pub earned: BTreeMap<AgentId, Amount>,
    pub initial_supply: Amount,
}

impl ServiceMarket {
    pub fn new(agents: &[AgentId], buyer_funds: Amount) -> Result<Self> {
        if agents.is_empty() || agents.len() > MAX_AGENTS || buyer_funds == Amount::ZERO {
            return Err(EconomyError::InvalidInput(
                "1-20 agents and positive mock buyer funds required".into(),
            ));
        }
        let mut ledger = TreasuryLedger::default();
        ledger.open(AccountId::new(BUYER)?, buyer_funds)?;
        let mut earned = BTreeMap::new();
        let mut verified_jobs = BTreeMap::new();
        for agent in agents {
            if agent.as_str() == BUYER || earned.contains_key(agent) {
                return Err(EconomyError::Conflict);
            }
            ledger.open(AccountId::new(agent.as_str())?, Amount::ZERO)?;
            earned.insert(agent.clone(), Amount::ZERO);
            verified_jobs.insert(agent.clone(), 0);
        }
        Ok(Self {
            ledger,
            jobs: BTreeMap::new(),
            deliveries: BTreeMap::new(),
            verified_jobs,
            earned,
            initial_supply: buyer_funds,
        })
    }

    pub fn publish(
        &mut self,
        id: OperationId,
        assignee: AgentId,
        reward: Amount,
        expected_sha256: String,
    ) -> Result<()> {
        if self.jobs.len() >= MAX_JOBS
            || self.jobs.contains_key(&id)
            || !self.earned.contains_key(&assignee)
        {
            return Err(EconomyError::Conflict);
        }
        if reward == Amount::ZERO
            || expected_sha256.len() != 64
            || !expected_sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(EconomyError::InvalidInput(
                "Positive reward and SHA-256 digest required".into(),
            ));
        }
        let escrow = escrow_id(&id)?;
        self.ledger
            .balance(&AccountId::new(BUYER)?)?
            .subtract(reward)?;
        self.ledger.open(escrow.clone(), Amount::ZERO)?;
        self.ledger
            .transfer(&AccountId::new(BUYER)?, &escrow, reward)?;
        self.jobs.insert(
            id.clone(),
            ServiceJob {
                id,
                assignee,
                reward,
                expected_sha256: expected_sha256.to_ascii_lowercase(),
                attempts: 0,
                settled: false,
                receipt_sha256: None,
            },
        );
        self.check_conservation()
    }

    pub fn submit(
        &mut self,
        operation_id: OperationId,
        job_id: &OperationId,
        agent_id: &AgentId,
        output: &str,
    ) -> Result<DeliveryOutcome> {
        if output.len() > 4096 {
            return Err(EconomyError::InvalidInput(
                "Delivery exceeds 4096 bytes".into(),
            ));
        }
        let digest = sha256_hex(output.as_bytes());
        if let Some(prior) = self.deliveries.get(&operation_id) {
            if &prior.job_id == job_id
                && &prior.agent_id == agent_id
                && prior.submission_sha256 == digest
            {
                return Ok(prior.outcome.clone());
            }
            return Err(EconomyError::Conflict);
        }
        let job = self
            .jobs
            .get(job_id)
            .ok_or_else(|| EconomyError::InvalidInput("Unknown job".into()))?;
        if &job.assignee != agent_id || job.settled || job.attempts >= MAX_ATTEMPTS {
            return Err(EconomyError::InvalidTransition(
                "Job unavailable for this agent".into(),
            ));
        }
        let paid = digest == job.expected_sha256;
        let reward = job.reward;
        if paid {
            let earned = self
                .earned
                .get(agent_id)
                .ok_or(EconomyError::Conflict)?
                .add(reward)?;
            let count = self
                .verified_jobs
                .get(agent_id)
                .ok_or(EconomyError::Conflict)?
                .checked_add(1)
                .ok_or(EconomyError::Overflow)?;
            self.ledger.transfer(
                &escrow_id(job_id)?,
                &AccountId::new(agent_id.as_str())?,
                reward,
            )?;
            self.earned.insert(agent_id.clone(), earned);
            self.verified_jobs.insert(agent_id.clone(), count);
        }
        let job = self.jobs.get_mut(job_id).ok_or(EconomyError::Conflict)?;
        job.attempts += 1;
        if paid {
            job.settled = true;
            job.receipt_sha256 = Some(digest.clone());
        }
        let outcome = if paid {
            DeliveryOutcome::Paid
        } else {
            DeliveryOutcome::Rejected
        };
        self.deliveries.insert(
            operation_id.clone(),
            Delivery {
                operation_id,
                job_id: job_id.clone(),
                agent_id: agent_id.clone(),
                submission_sha256: digest,
                outcome: outcome.clone(),
            },
        );
        self.check_conservation()?;
        Ok(outcome)
    }

    pub fn check_conservation(&self) -> Result<()> {
        if self.ledger.total()? != self.initial_supply {
            return Err(EconomyError::InvalidTransition(
                "Mock funds conservation failed".into(),
            ));
        }
        Ok(())
    }
}

fn escrow_id(id: &OperationId) -> Result<AccountId> {
    AccountId::new(format!("job_{}", id.as_str()))
}

/// Saves each accepted transition before exposing it to the caller.
pub struct DurableServiceMarket {
    repo: JsonRepository,
    pub market: ServiceMarket,
}
impl DurableServiceMarket {
    pub fn open(
        directory: impl AsRef<Path>,
        initial: impl FnOnce() -> Result<ServiceMarket>,
    ) -> Result<Self> {
        let repo = JsonRepository::open(directory)?;
        let market = match repo.read("service_market")? {
            Some(saved) => saved,
            None => {
                let market = initial()?;
                repo.write("service_market", &market)?;
                market
            }
        };
        market.check_conservation()?;
        Ok(Self { repo, market })
    }
    pub fn apply<T>(&mut self, action: impl FnOnce(&mut ServiceMarket) -> Result<T>) -> Result<T> {
        let mut candidate = self.market.clone();
        let result = action(&mut candidate)?;
        candidate.check_conservation()?;
        if serde_json::to_value(&candidate)
            .map_err(|e| EconomyError::StorageFailure(e.to_string()))?
            != serde_json::to_value(&self.market)
                .map_err(|e| EconomyError::StorageFailure(e.to_string()))?
        {
            self.repo.write("service_market", &candidate)?;
        }
        self.market = candidate;
        Ok(result)
    }
}
