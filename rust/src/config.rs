use crate::model::*;
use std::collections::HashSet;
pub fn default_config(count: usize, seed: u32) -> Config {
    let roles = [
        (
            "Ember",
            "aggressive",
            "Take from wealthy rivals. Protect my last credit.",
            "01-founder",
        ),
        (
            "Moss",
            "conservative",
            "Keep earning. Guard when a rival threatens me.",
            "05-defender",
        ),
        (
            "Pip",
            "opportunist",
            "Find a soft target. Accept a profitable alliance.",
            "11-explorer",
        ),
        (
            "Luna",
            "cooperative",
            "Build mutual trust. Remember who betrayed me.",
            "19-adaptive",
        ),
    ];
    Config {
        seed,
        max_turns: 40,
        agents: (0..count)
            .map(|i| {
                let (name, strategy, personality, sprite) = roles[i % 4];
                AgentConfig {
                    id: format!("agent-{}", i + 1),
                    name: if i < 4 {
                        name.into()
                    } else {
                        format!("{name} {}", i / 4 + 1)
                    },
                    strategy: strategy.into(),
                    personality: personality.into(),
                    prompt: personality.into(),
                    sprite: format!("assets/sprites-agent/{sprite}.png"),
                    model: format!("mock/{strategy}"),
                    provider: "mock".into(),
                    starting_credits: 12,
                    wallet_enabled: false,
                }
            })
            .collect(),
    }
}
pub fn validate(config: &Config) -> Result<(), String> {
    if config.seed == 0
        || config.max_turns == 0
        || config.max_turns > 200
        || !(2..=20).contains(&config.agents.len())
    {
        return Err("Use seed > 0, 1–200 turns, and 2–20 agents".into());
    }
    let mut ids = HashSet::new();
    for a in &config.agents {
        if a.id.is_empty()
            || a.id.len() > 40
            || !a
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || !ids.insert(&a.id)
        {
            return Err("Agent IDs must be unique simple identifiers".into());
        }
        if a.name.trim().is_empty()
            || a.name.chars().count() > 28
            || a.personality.len() > 500
            || a.prompt.len() > 4000
            || a.model.len() > 120
        {
            return Err("Agent name/prompt/model exceeds supported limits".into());
        }
        if !(1..=10000).contains(&a.starting_credits) {
            return Err("Starting credits must be 1–10,000".into());
        }
        if !["aggressive", "conservative", "opportunist", "cooperative"]
            .contains(&a.strategy.as_str())
            || !["mock", "http", "recorded"].contains(&a.provider.as_str())
        {
            return Err("Unknown strategy or provider".into());
        }
        if !a.sprite.starts_with("assets/sprites-agent/")
            || !a.sprite.ends_with(".png")
            || a.sprite.contains("..")
            || !a
                .sprite
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/-_.".contains(&b))
        {
            return Err("Sprite must be a local agent PNG".into());
        }
        // Replay configs are public input, never credentials or signing instructions.
        let prompt = a.prompt.to_lowercase();
        if ["-----begin private key", "seed phrase:", "api_key="]
            .iter()
            .any(|s| prompt.contains(s))
        {
            return Err("Remove credentials from the public agent config".into());
        }
    }
    Ok(())
}
