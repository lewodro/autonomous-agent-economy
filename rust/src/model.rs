use serde::{Deserialize, Serialize};

pub const VERSION: &str = "last-seat-v6";
pub const SUPPORTED_VERSIONS: [&str; 6] = [
    "last-seat-v1",
    "last-seat-v2",
    "last-seat-v3",
    "last-seat-v4",
    "last-seat-v5",
    VERSION,
];
pub const MAX_REPLAY_EVENTS: usize = 50_000;
pub const MAX_REPLAY_BYTES: usize = 32_000_000;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub strategy: String,
    pub personality: String,
    #[serde(default)]
    pub prompt: String,
    pub model: String,
    pub provider: String,
    pub starting_credits: i32,
    #[serde(default)]
    pub wallet_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inference: Option<InferenceConfig>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub seed: u32,
    pub max_turns: u32,
    pub agents: Vec<AgentConfig>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Work,
    Challenge,
    Guard,
    Cooperate,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Decision {
    pub agent_id: String,
    pub action: Action,
    #[serde(default)]
    pub target: Option<String>,
    pub reason: String,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Statistics {
    pub actions: u32,
    pub challenges_won: u32,
    pub blocks: u32,
    pub cooperations: u32,
    pub earned: i32,
    pub eliminated_turn: Option<u32>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub credits: i32,
    pub alive: bool,
    pub guarded: bool,
    pub last_action: Option<Action>,
    pub stats: Statistics,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub turn: u32,
    pub rng: u32,
    pub agents: Vec<Agent>,
    pub alliances: Vec<[String; 2]>,
    pub ended: bool,
    pub winner: Option<String>,
    pub end_reason: Option<String>,
    pub income: i32,
    pub upkeep: i32,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum Kind {
    MatchStarted,
    RoundStarted,
    WorldEvent,
    AgentThinking,
    AgentActionSelected,
    ActionStarted,
    ActionResolved,
    WinnerDeclared,
    ActionRejected,
    WorkCompleted,
    ChallengeStarted,
    ChallengeResolved,
    GuardRaised,
    CooperationOffered,
    AllianceCreated,
    AllianceBroken,
    ResourceChanged,
    AgentEliminated,
    RoundEnded,
    MatchEnded,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Projection {
    pub turn: u32,
    pub income: i32,
    pub upkeep: i32,
    pub agents: Vec<Agent>,
    pub alliances: Vec<[String; 2]>,
    pub ended: bool,
    pub winner: Option<String>,
    pub end_reason: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Outcome {
    pub action: Action,
    pub actor_delta: i32,
    pub target_delta: i32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub seq: usize,
    pub turn: u32,
    #[serde(rename = "type")]
    pub kind: Kind,
    pub actor: Option<String>,
    pub target: Option<String>,
    pub amount: Option<i32>,
    pub after: Option<i32>,
    pub reason: String,
    pub decision: Option<Decision>,
    pub state: Option<State>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projection: Option<Projection>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<Outcome>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Replay {
    pub simulation_version: String,
    pub match_id: String,
    pub seed: u32,
    pub config: Config,
    pub starting_state: State,
    pub events: Vec<Event>,
    pub final_state: State,
    pub winner: Option<String>,
    pub statistics: Vec<Statistics>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Observation {
    #[serde(default)]
    pub recent_decisions: Vec<Decision>,
    pub turn: u32,
    pub income: i32,
    pub upkeep: i32,
    pub agents: Vec<Agent>,
    pub alliances: Vec<[String; 2]>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InferenceConfig {
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub max_requests: Option<u32>,
    #[serde(default)]
    pub retries: Option<u32>,
    #[serde(default)]
    pub fallback: Option<String>,
}
