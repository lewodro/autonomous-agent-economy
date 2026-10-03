use crate::model::*;
pub fn choose(config: &Config, observation: &Observation, index: usize) -> Decision {
    let profile = &config.agents[index];
    let me = &observation.agents[index];
    let rivals: Vec<_> = observation
        .agents
        .iter()
        .filter(|a| a.alive && a.id != me.id)
        .collect();
    let richest = rivals.iter().max_by_key(|a| (a.credits, &a.id)).unwrap();
    let mut result = Decision {
        agent_id: me.id.clone(),
        action: Action::Work,
        target: None,
        reason: format!(
            "Work pays {} before {} upkeep.",
            observation.income, observation.upkeep
        ),
    };
    if me.credits <= 1 {
        return result;
    }
    match profile.strategy.as_str() {
        "aggressive" => {
            if me.credits < observation.upkeep + 2 || me.credits > richest.credits {
                return result;
            }
            let target = rivals
                .iter()
                .filter(|a| a.last_action != Some(Action::Guard))
                .max_by_key(|a| (a.credits, &a.id));
            if let Some(target) = target {
                result.action = Action::Challenge;
                result.target = Some(target.id.clone());
                result.reason = format!(
                    "{} has {} credits and did not guard last round.",
                    target.id, target.credits
                );
            }
        }
        "conservative" => {
            let threats = rivals
                .iter()
                .any(|a| a.last_action == Some(Action::Challenge));
            if threats
                && (me.credits >= richest.credits
                    || observation.recent_decisions.iter().any(|d| {
                        d.action == Action::Challenge && d.target.as_ref() == Some(&me.id)
                    }))
                && observation.turn % 3 != 0
            {
                result.action = Action::Guard;
                result.reason = "I am a wealthy target; guard blocks every challenge.".into();
            }
        }
        "opportunist" => {
            let friend = rivals
                .iter()
                .find(|a| a.last_action == Some(Action::Cooperate) && a.credits > 1);
            if let Some(friend) = friend {
                if observation.upkeep >= 3
                    && friend.credits >= 4
                    && friend.credits + 2 <= me.credits
                {
                    result.action = Action::Challenge;
                    result.target = Some(friend.id.clone());
                    result.reason =
                        "My ally is vulnerable as upkeep rises; take a risky betrayal.".into();
                    return result;
                }
                result.action = Action::Cooperate;
                result.target = Some(friend.id.clone());
                result.reason =
                    "A rival offered cooperation last round; try a mutual bonus.".into();
            } else if richest.last_action == Some(Action::Work) && richest.credits >= 4 {
                result.action = Action::Challenge;
                result.target = Some(richest.id.clone());
                result.reason = "A working rival is exposed to a five-credit challenge.".into();
            }
        }
        "cooperative" => {
            if observation
                .recent_decisions
                .iter()
                .any(|d| d.action == Action::Challenge && d.target.as_ref() == Some(&me.id))
            {
                result.action = Action::Guard;
                result.reason = "A challenge targeted me; defend before trying trust again.".into();
                return result;
            }
            let friend = rivals
                .iter()
                .filter(|a| a.last_action != Some(Action::Challenge))
                .max_by_key(|a| (a.last_action == Some(Action::Cooperate), a.credits, &a.id));
            if let Some(friend) = friend {
                // Learn from public actions, not the opponent's private strategy configuration.
                if friend.last_action == Some(Action::Cooperate)
                    || observation.turn <= 2
                    || (config
                        .seed
                        .wrapping_add(observation.turn)
                        .wrapping_add(index as u32))
                        % 3
                        == 0
                {
                    result.action = Action::Cooperate;
                    result.target = Some(friend.id.clone());
                    result.reason =
                        "Try a mutual three-credit bonus with a non-attacking rival.".into();
                }
            }
        }
        _ => {}
    }
    result
}
