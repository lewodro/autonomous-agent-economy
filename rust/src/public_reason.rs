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
            summary: match decision.action {
                crate::model::Action::Work => "Worked to earn credits.".into(),
                crate::model::Action::Guard => "Guarded to protect against a challenge.".into(),
                crate::model::Action::Challenge => format!(
                    "Challenged {}.",
                    decision.target.as_deref().unwrap_or("another agent")
                ),
                crate::model::Action::Cooperate => format!(
                    "Offered cooperation to {}.",
                    decision.target.as_deref().unwrap_or("another agent")
                ),
            },
            relevant_state,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PublicDecisionReason;
    use crate::model::{Action, Agent, Decision, Observation, Statistics};

    #[test]
    fn public_summary_uses_the_action_not_provider_free_text() {
        let decision = Decision {
            agent_id: "a".into(),
            action: Action::Challenge,
            target: Some("b".into()),
            reason: "private reasoning must stay private".into(),
        };
        let observation = Observation {
            recent_decisions: vec![],
            turn: 1,
            income: 2,
            upkeep: 1,
            agents: vec![
                Agent {
                    id: "a".into(),
                    credits: 12,
                    alive: true,
                    guarded: false,
                    last_action: None,
                    stats: Statistics::default(),
                },
                Agent {
                    id: "b".into(),
                    credits: 4,
                    alive: true,
                    guarded: false,
                    last_action: None,
                    stats: Statistics::default(),
                },
            ],
            alliances: vec![],
        };
        let public = PublicDecisionReason::from_decision(&decision, &observation);
        assert_eq!(public.summary, "Challenged b.");
        assert!(!public.summary.contains("private reasoning"));
        assert_eq!(public.relevant_state.len(), 2);
    }
}
