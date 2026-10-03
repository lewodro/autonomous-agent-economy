use crate::{config, model::*, strategy};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
fn random(rng: &mut u32) -> u32 {
    let mut x = *rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *rng = x;
    x
}
fn emit(run: &mut Replay, kind: Kind, actor: Option<&str>, target: Option<&str>, reason: String) {
    run.events.push(Event {
        seq: run.events.len(),
        turn: run.final_state.turn,
        kind,
        actor: actor.map(str::to_owned),
        target: target.map(str::to_owned),
        amount: None,
        after: None,
        reason,
        decision: None,
        state: None,
        outcome: None,
        projection: if run.simulation_version != "last-seat-v1" {
            Some(Projection {
                turn: run.final_state.turn,
                income: run.final_state.income,
                upkeep: run.final_state.upkeep,
                agents: run
                    .final_state
                    .agents
                    .iter()
                    .filter(|a| {
                        kind == Kind::RoundStarted
                            || Some(a.id.as_str()) == actor
                            || Some(a.id.as_str()) == target
                    })
                    .cloned()
                    .collect(),
                alliances: run.final_state.alliances.clone(),
                ended: run.final_state.ended,
                winner: run.final_state.winner.clone(),
                end_reason: run.final_state.end_reason.clone(),
            })
        } else {
            None
        },
    });
}
fn name(run: &Replay, id: &str) -> String {
    run.config
        .agents
        .iter()
        .find(|a| a.id == id)
        .map(|a| a.name.clone())
        .unwrap_or_else(|| id.into())
}
fn change(run: &mut Replay, id: &str, delta: i32, reason: String) {
    let a = run
        .final_state
        .agents
        .iter_mut()
        .find(|a| a.id == id)
        .unwrap();
    let before = a.credits;
    a.credits = (a.credits + delta).max(0);
    let actual = a.credits - before;
    if actual > 0 {
        a.stats.earned += actual;
    }
    let after = a.credits;
    emit(run, Kind::ResourceChanged, Some(id), None, reason);
    let event = run.events.last_mut().unwrap();
    event.amount = Some(actual);
    event.after = Some(after);
}
fn update_id(run: &mut Replay) -> Result<(), String> {
    let bytes = serde_json::to_vec(&(&run.simulation_version, &run.config, &run.events)).unwrap();
    // Leave room for starting/final state, statistics, JSON field names and wrappers.
    if bytes.len() > MAX_REPLAY_BYTES - 64_000 || run.events.len() > MAX_REPLAY_EVENTS {
        return Err("Replay history exceeds supported size".into());
    }
    run.match_id = format!("seat-{:x}", Sha256::digest(bytes));
    run.statistics = run
        .final_state
        .agents
        .iter()
        .map(|a| a.stats.clone())
        .collect();
    run.winner = run.final_state.winner.clone();
    Ok(())
}
pub fn start(config: Config) -> Result<Replay, String> {
    start_version(config, VERSION)
}
pub fn start_version(config: Config, version: &str) -> Result<Replay, String> {
    if ![
        VERSION,
        "last-seat-v4",
        "last-seat-v3",
        "last-seat-v2",
        "last-seat-v1",
    ]
    .contains(&version)
    {
        return Err("Unsupported engine version".into());
    }
    config::validate(&config)?;
    let state = State {
        turn: 0,
        rng: config.seed,
        agents: config
            .agents
            .iter()
            .map(|a| Agent {
                id: a.id.clone(),
                credits: a.starting_credits,
                alive: true,
                guarded: false,
                last_action: None,
                stats: Statistics::default(),
            })
            .collect(),
        alliances: vec![],
        ended: false,
        winner: None,
        end_reason: None,
        income: 3,
        upkeep: 1,
    };
    let mut run = Replay {
        simulation_version: version.into(),
        match_id: String::new(),
        seed: config.seed,
        config,
        starting_state: state.clone(),
        events: vec![],
        final_state: state,
        winner: None,
        statistics: vec![],
    };
    emit(
        &mut run,
        Kind::MatchStarted,
        None,
        None,
        "Everyone has a seat. Credits keep you in the game.".into(),
    );
    update_id(&mut run)?;
    Ok(run)
}
pub fn observe(run: &Replay) -> Observation {
    let mut rng = run.final_state.rng;
    Observation {
        recent_decisions: run
            .events
            .iter()
            .filter(|e| e.turn == run.final_state.turn && e.kind == Kind::AgentActionSelected)
            .filter_map(|e| e.decision.clone())
            .collect(),
        turn: run.final_state.turn + 1,
        income: 2 + (random(&mut rng) % 3) as i32,
        upkeep: 1 + (run.final_state.turn / 4) as i32,
        agents: run.final_state.agents.clone(),
        alliances: run.final_state.alliances.clone(),
    }
}
pub fn advance(run: &mut Replay, decisions: Option<Vec<Decision>>) -> Result<Vec<Event>, String> {
    if run.final_state.ended {
        return Err("Match already ended".into());
    }
    if decisions.is_none() && run.config.agents.iter().any(|a| a.provider != "mock") {
        return Err("Non-mock agents require recorded adapter decisions".into());
    }
    let mut candidate = run.clone();
    let offset = candidate.events.len();
    advance_inner(&mut candidate, decisions)?;
    update_id(&mut candidate)?;
    let events = candidate.events[offset..].to_vec();
    *run = candidate;
    Ok(events)
}
fn advance_inner(run: &mut Replay, submitted: Option<Vec<Decision>>) -> Result<(), String> {
    let observation = observe(run);
    // Published rule versions are immutable; new defaults must not reinterpret archives.
    let (challenge_cost, guard_income, work_cap, other_cap, modern) =
        match run.simulation_version.as_str() {
            "last-seat-v1" | "last-seat-v2" => (1, 1, 5, 4, false),
            "last-seat-v3" => (2, 2, 5, 4, true),
            "last-seat-v4" => (1, 2, 4, 3, true),
            "last-seat-v5" => (2, 2, 4, 3, true),
            _ => return Err("Unsupported engine version".into()),
        };
    let living: Vec<usize> = run
        .final_state
        .agents
        .iter()
        .enumerate()
        .filter(|(_, a)| a.alive)
        .map(|(i, _)| i)
        .collect();
    let decisions = submitted.unwrap_or_else(|| {
        living
            .iter()
            .map(|i| strategy::choose(&run.config, &observation, *i))
            .collect()
    });
    if decisions.len() != living.len() {
        return Err("Exactly one decision per living agent is required".into());
    }
    let mut seen = BTreeSet::new();
    for d in &decisions {
        if d.reason.len() > 600 || d.target.as_ref().is_some_and(|id| id.len() > 40) {
            return Err("Decision reason or target exceeds supported size".into());
        }
        if !seen.insert(d.agent_id.clone())
            || !observation
                .agents
                .iter()
                .any(|a| a.alive && a.id == d.agent_id)
        {
            return Err("Duplicate or inactive decision author".into());
        }
    }
    run.final_state.turn += 1;
    run.final_state.income = 2 + (random(&mut run.final_state.rng) % 3) as i32;
    run.final_state.upkeep = observation.upkeep;
    if run.simulation_version != "last-seat-v1" {
        for a in &mut run.final_state.agents {
            a.guarded = false;
        }
    }
    emit(
        run,
        Kind::RoundStarted,
        None,
        None,
        format!(
            "Turn {}. All choices use the same observation.",
            run.final_state.turn
        ),
    );
    emit(
        run,
        Kind::WorldEvent,
        None,
        None,
        format!(
            "Market pays {} for work. Upkeep is {} this turn.",
            observation.income, observation.upkeep
        ),
    );
    if run.simulation_version != "last-seat-v1" {
        for i in &living {
            let id = run.final_state.agents[*i].id.clone();
            emit(
                run,
                Kind::AgentThinking,
                Some(&id),
                None,
                format!("{} considers the table.", name(run, &id)),
            );
        }
    }
    let mut choices = BTreeMap::new();
    for mut d in decisions {
        let me = observation
            .agents
            .iter()
            .find(|a| a.id == d.agent_id)
            .unwrap();
        let targeted = matches!(d.action, Action::Challenge | Action::Cooperate);
        let valid = !d.reason.is_empty()
            && d.reason.len() <= 600
            && ((!targeted && d.target.is_none())
                || (targeted
                    && me.credits
                        >= if d.action == Action::Challenge {
                            challenge_cost
                        } else {
                            1
                        }
                    && d.target.as_ref().is_some_and(|id| {
                        id != &d.agent_id
                            && observation.agents.iter().any(|a| a.alive && &a.id == id)
                    })));
        if !valid {
            emit(
                run,
                Kind::ActionRejected,
                Some(&d.agent_id),
                d.target.as_deref(),
                "Invalid action requirements; deterministic fallback to guard.".into(),
            );
            run.events.last_mut().unwrap().decision = Some(d.clone());
            d.action = Action::Guard;
            d.target = None;
            d.reason = "Rejected intent; guard without spending.".into();
        }
        if run.simulation_version != "last-seat-v1" {
            run.final_state
                .agents
                .iter_mut()
                .find(|a| a.id == d.agent_id)
                .unwrap()
                .last_action = Some(d.action);
        }
        emit(
            run,
            Kind::AgentActionSelected,
            Some(&d.agent_id),
            d.target.as_deref(),
            d.reason.clone(),
        );
        run.events.last_mut().unwrap().decision = Some(d.clone());
        choices.insert(d.agent_id.clone(), d);
    }
    // Guard is simultaneous and cannot be defeated by acting earlier in initiative.
    for i in &living {
        let a = &mut run.final_state.agents[*i];
        a.guarded = choices[&a.id].action == Action::Guard;
        a.last_action = Some(choices[&a.id].action);
        a.stats.actions += 1;
    }
    let old = std::mem::take(&mut run.final_state.alliances);
    for pair in old {
        let mutual = pair.iter().all(|id| {
            choices.get(id).is_some_and(|d| {
                d.action == Action::Cooperate
                    && d.target.as_ref() == Some(&pair[if id == &pair[0] { 1 } else { 0 }])
            })
        });
        if mutual {
            run.final_state.alliances.push(pair);
        } else {
            let betrayer = pair.iter().find(|id| {
                choices.get(*id).is_some_and(|d| {
                    d.action == Action::Challenge
                        && d.target.as_ref() == Some(&pair[if *id == &pair[0] { 1 } else { 0 }])
                })
            });
            let reason = if let Some(id) = betrayer {
                format!("{} betrayed an alliance with a challenge.", name(run, id))
            } else {
                "Alliance ended when the partners chose different actions.".into()
            };
            emit(
                run,
                Kind::AllianceBroken,
                Some(&pair[0]),
                Some(&pair[1]),
                reason,
            );
        }
    }
    let mut order = living.clone();
    for i in (1..order.len()).rev() {
        let j = random(&mut run.final_state.rng) as usize % (i + 1);
        order.swap(i, j);
    }
    let mut rewarded = BTreeSet::new();
    for i in order {
        let id = run.final_state.agents[i].id.clone();
        let d = &choices[&id];
        let before = run.final_state.agents[i].credits;
        let target_before = d
            .target
            .as_ref()
            .and_then(|id| run.final_state.agents.iter().find(|a| &a.id == id))
            .map(|a| a.credits)
            .unwrap_or(0);
        if run.simulation_version != "last-seat-v1" {
            emit(
                run,
                Kind::ActionStarted,
                Some(&id),
                d.target.as_deref(),
                format!("{} acts: {:?}.", name(run, &id), d.action),
            );
            run.events.last_mut().unwrap().decision = Some(d.clone());
        }
        match d.action {
            Action::Work => {
                emit(
                    run,
                    Kind::WorkCompleted,
                    Some(&id),
                    None,
                    format!(
                        "{} worked for {} credits.",
                        name(run, &id),
                        observation.income
                    ),
                );
                change(run, &id, observation.income, "Market work income".into());
            }
            Action::Guard => {
                emit(
                    run,
                    Kind::GuardRaised,
                    Some(&id),
                    None,
                    if modern {
                        format!(
                            "{} guarded and earned {} safe credits.",
                            name(run, &id),
                            guard_income
                        )
                    } else {
                        format!("{} guarded and earned one safe credit.", name(run, &id))
                    },
                );
                change(run, &id, guard_income, "Guard duty income".into());
            }
            Action::Challenge => {
                let target = d.target.as_ref().unwrap();
                if run.final_state.agents[i].credits < challenge_cost {
                    emit(
                        run,
                        Kind::ChallengeResolved,
                        Some(&id),
                        Some(target),
                        format!(
                            "{} could not afford the challenge after earlier transfers.",
                            name(run, &id)
                        ),
                    );
                    resolved(run, d, before, target_before);
                    continue;
                }
                emit(
                    run,
                    Kind::ChallengeStarted,
                    Some(&id),
                    Some(target),
                    format!("{} challenged {}.", name(run, &id), name(run, target)),
                );
                change(run, &id, -challenge_cost, "Challenge entry cost".into());
                let j = run
                    .final_state
                    .agents
                    .iter()
                    .position(|a| &a.id == target)
                    .unwrap();
                if run.final_state.agents[j].guarded {
                    run.final_state.agents[j].stats.blocks += 1;
                    emit(
                        run,
                        Kind::ChallengeResolved,
                        Some(&id),
                        Some(target),
                        format!(
                            "{} blocked {} with a guard.",
                            name(run, target),
                            name(run, &id)
                        ),
                    );
                } else {
                    let cap = if choices[target].action == Action::Work {
                        work_cap
                    } else {
                        other_cap
                    };
                    let taken = cap.min(run.final_state.agents[j].credits);
                    run.final_state.agents[i].stats.challenges_won += u32::from(taken > 0);
                    change(
                        run,
                        target,
                        -taken,
                        format!("Challenged by {}", name(run, &id)),
                    );
                    change(
                        run,
                        &id,
                        taken,
                        format!("Challenge payout from {}", name(run, target)),
                    );
                    emit(
                        run,
                        Kind::ChallengeResolved,
                        Some(&id),
                        Some(target),
                        format!(
                            "{} took {} credits from {}{}.",
                            name(run, &id),
                            taken,
                            name(run, target),
                            if choices[target].action == Action::Work {
                                " while they worked"
                            } else {
                                ""
                            }
                        ),
                    );
                    run.events.last_mut().unwrap().amount = Some(taken);
                }
            }
            Action::Cooperate => {
                let target = d.target.as_ref().unwrap();
                let mut pair = [id.clone(), target.clone()];
                pair.sort();
                let mutual = choices[target].action == Action::Cooperate
                    && choices[target].target.as_ref() == Some(&id);
                if mutual {
                    if rewarded.insert(pair.clone()) {
                        if !run.final_state.alliances.contains(&pair) {
                            run.final_state.alliances.push(pair.clone());
                            emit(
                                run,
                                Kind::AllianceCreated,
                                Some(&id),
                                Some(target),
                                format!(
                                    "{} and {} chose each other. Both earn three credits.",
                                    name(run, &id),
                                    name(run, target)
                                ),
                            );
                        } else {
                            emit(
                                run,
                                Kind::CooperationOffered,
                                Some(&id),
                                Some(target),
                                format!(
                                    "{} and {} renewed their alliance.",
                                    name(run, &id),
                                    name(run, target)
                                ),
                            );
                        }
                        change(run, &id, 3, "Mutual cooperation bonus".into());
                        change(run, target, 3, "Mutual cooperation bonus".into());
                        for who in [&id, target] {
                            run.final_state
                                .agents
                                .iter_mut()
                                .find(|a| &a.id == who)
                                .unwrap()
                                .stats
                                .cooperations += 1;
                        }
                    }
                } else if run.final_state.agents[i].credits >= 1 {
                    emit(
                        run,
                        Kind::CooperationOffered,
                        Some(&id),
                        Some(target),
                        format!(
                            "{} offered {} one credit, but the offer was not mutual.",
                            name(run, &id),
                            name(run, target)
                        ),
                    );
                    change(run, &id, -1, "Unmatched cooperation offer".into());
                    change(run, target, 1, format!("Gift from {}", name(run, &id)));
                } else {
                    emit(
                        run,
                        Kind::CooperationOffered,
                        Some(&id),
                        Some(target),
                        "Offer could not be funded after earlier transfers.".into(),
                    );
                }
            }
        }
        resolved(run, d, before, target_before);
    }
    for i in living {
        let id = run.final_state.agents[i].id.clone();
        let before = run.final_state.agents[i].credits;
        change(
            run,
            &id,
            -observation.upkeep,
            format!("Turn {} upkeep", run.final_state.turn),
        );
        if run.final_state.agents[i].credits == 0 {
            run.final_state.agents[i].alive = false;
            run.final_state.agents[i].guarded = false;
            run.final_state.agents[i].stats.eliminated_turn = Some(run.final_state.turn);
            emit(
                run,
                Kind::AgentEliminated,
                Some(&id),
                None,
                format!(
                    "{} is out: {} credits before {} upkeep. Their seat is empty.",
                    name(run, &id),
                    before,
                    observation.upkeep
                ),
            );
        }
    }
    let alive: BTreeSet<_> = run
        .final_state
        .agents
        .iter()
        .filter(|a| a.alive)
        .map(|a| a.id.clone())
        .collect();
    run.final_state
        .alliances
        .retain(|pair| pair.iter().all(|id| alive.contains(id)));
    if alive.len() <= 1 || run.final_state.turn >= run.config.max_turns {
        run.final_state.ended = true;
        let (winner, why) = if alive.len() == 1 {
            (alive.first().cloned(), "Last seat standing".into())
        } else if alive.is_empty() {
            (None, "Nobody survived the upkeep".into())
        } else {
            let high = run
                .final_state
                .agents
                .iter()
                .filter(|a| a.alive)
                .map(|a| a.credits)
                .max()
                .unwrap();
            let leaders: Vec<_> = run
                .final_state
                .agents
                .iter()
                .filter(|a| a.alive && a.credits == high)
                .collect();
            (
                if leaders.len() == 1 {
                    Some(leaders[0].id.clone())
                } else {
                    None
                },
                format!(
                    "Turn limit: {} richest surviving agent{}",
                    leaders.len(),
                    if leaders.len() == 1 { "" } else { "s tied" }
                ),
            )
        };
        run.final_state.winner = winner.clone();
        run.final_state.end_reason = Some(why.clone());
        if run.simulation_version != "last-seat-v1" && winner.is_some() {
            emit(
                run,
                Kind::WinnerDeclared,
                winner.as_deref(),
                None,
                format!("{} wins the table.", name(run, winner.as_ref().unwrap())),
            );
        }
        emit(run, Kind::MatchEnded, winner.as_deref(), None, why);
    }
    emit(
        run,
        Kind::RoundEnded,
        None,
        None,
        format!("Turn {} resolved.", run.final_state.turn),
    );
    run.events.last_mut().unwrap().state = Some(run.final_state.clone());
    Ok(())
}

fn resolved(run: &mut Replay, d: &Decision, before: i32, target_before: i32) {
    if run.simulation_version == "last-seat-v1" {
        return;
    }
    let actor_delta = run
        .final_state
        .agents
        .iter()
        .find(|a| a.id == d.agent_id)
        .unwrap()
        .credits
        - before;
    let target_delta = d
        .target
        .as_ref()
        .and_then(|id| run.final_state.agents.iter().find(|a| &a.id == id))
        .map(|a| a.credits - target_before)
        .unwrap_or(0);
    emit(
        run,
        Kind::ActionResolved,
        Some(&d.agent_id),
        d.target.as_deref(),
        format!("{} completed {:?}.", name(run, &d.agent_id), d.action),
    );
    run.events.last_mut().unwrap().outcome = Some(Outcome {
        action: d.action,
        actor_delta,
        target_delta,
    });
}
