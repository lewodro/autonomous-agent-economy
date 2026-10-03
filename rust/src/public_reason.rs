//! Brief spectator explanations, not private reasoning traces or provider responses.
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicStateFact {
    pub agent_id: String,
    pub credits: i32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicDecisionReason {
    pub summary: String,
    pub relevant_state: Vec<PublicStateFact>,
}
impl PublicDecisionReason {
    pub fn from_decision(
        decision: &crate::model::Decision,
        observation: &crate::model::Observation,
    ) -> Self {
        let relevant_state = observation
            .agents
            .iter()
            .filter(|a| {
                a.id == decision.agent_id || decision.target.as_deref() == Some(a.id.as_str())
            })
            .map(|a| PublicStateFact {
                agent_id: a.id.clone(),
                credits: a.credits,
            })
            .collect();
        Self {
            summary: decision.reason.chars().take(300).collect(),
            relevant_state,
        }
    }
}
