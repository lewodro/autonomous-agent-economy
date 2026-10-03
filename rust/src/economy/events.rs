use super::{config::PaymentMode, lifecycle::EconomyState, primitives::*};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettlementStatus {
    NotStarted,
    Pending,
    Completed,
    Refunded,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MatchEconomy {
    pub match_id: RunId,
    pub simulation_start_id: String,
    pub payment_mode: PaymentMode,
    pub entry_amount: Amount,
    pub required_agents: Vec<AgentId>,
    pub funded_agents: BTreeSet<AgentId>,
    pub pot_amount: Amount,
    pub state: EconomyState,
    pub settlement_status: SettlementStatus,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EconomyEventKind {
    FundingOpened,
    EntryRequested {
        agent_id: AgentId,
        amount: Amount,
    },
    EntryReceived {
        agent_id: AgentId,
        amount: Amount,
        receipt_id: OperationId,
    },
    EntryRejected {
        agent_id: AgentId,
        error: EconomyError,
    },
    PotUpdated {
        amount: Amount,
    },
    FundingCompleted,
    FundsLocked,
    EconomyRunning,
    SettlementStarted {
        winner: AgentId,
    },
    SettlementCompleted {
        winner: AgentId,
        amount: Amount,
        receipt_id: OperationId,
    },
    RefundStarted {
        reason: String,
    },
    RefundCompleted {
        amount: Amount,
    },
    EconomyFailed {
        error: EconomyError,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EconomyEvent {
    pub schema_version: u32,
    pub seq: u64,
    pub match_id: RunId,
    #[serde(flatten)]
    pub kind: EconomyEventKind,
    pub projection: MatchEconomy,
}
