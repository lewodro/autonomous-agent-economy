//! Authoritative, deterministic melee survival mode for the public Arena.
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const MAP_WIDTH: u16 = 960;
pub const MAP_HEIGHT: u16 = 640;
const TILE: u16 = 32;
const MOVE_PER_TICK: u16 = 16;
const ATTACK_RANGE: u32 = 34;
const ATTACK_COOLDOWN: u8 = 4;
const EVENT_LIMIT: usize = 512;
const MAX_AGENTS: usize = 20;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub sprite: String,
    pub strategy: String,
    pub wins: u32,
    pub losses: u32,
    pub research_hint: Option<ResearchHint>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchHint {
    pub avoid_surrounded: bool,
    pub summary: String,
    pub source_match: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub seed: u32,
    pub match_number: u32,
    pub max_rounds: u32,
    pub agents: Vec<AgentConfig>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Alive,
    Eliminated,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MovementIntent {
    Chase,
    Retreat,
    Reposition,
    Idle,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngagementStatus {
    Chasing,
    Fighting,
    Retreating,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObstacleKind {
    Wall,
    Barrier,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Obstacle {
    pub id: String,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub kind: ObstacleKind,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Metrics {
    pub damage_dealt: u32,
    pub damage_taken: u32,
    pub attacks_landed: u32,
    pub target_changes: u32,
    pub retreat_count: u32,
    pub time_alive: u32,
    pub eliminations: u32,
    pub times_cornered: u32,
    pub escapes: u32,
    pub final_placement: Option<u8>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentState {
    pub id: String,
    pub x: u16,
    pub y: u16,
    pub hp: u16,
    pub max_hp: u16,
    pub status: AgentStatus,
    pub target_id: Option<String>,
    pub direction: String,
    pub movement_intent: MovementIntent,
    pub recent_action: String,
    pub research: Option<String>,
    pub wins: u32,
    pub losses: u32,
    pub cooldown: u8,
    pub cornered: bool,
    pub metrics: Metrics,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Engagement {
    pub id: String,
    pub attacker_id: String,
    pub target_id: String,
    pub status: EngagementStatus,
    pub recent_damage: Option<u16>,
    pub recent_actions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum EventType {
    SurvivalMatchStarted,
    SurvivalMatchCompleted,
    AgentSpawned,
    TargetSelected,
    TargetChanged,
    ChaseStarted,
    AttackStarted,
    AttackLanded,
    DamageTaken,
    RetreatStarted,
    AgentCornered,
    AgentEscaped,
    AgentEliminated,
    WinnerDeclared,
    ResearchUpdated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub round: u32,
    pub summary: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchStatus {
    Preparing,
    Live,
    Finished,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Simulation {
    pub schema_version: u8,
    pub match_id: String,
    pub seed: u32,
    pub match_number: u32,
    pub status: MatchStatus,
    pub sequence: u64,
    pub round: u32,
    pub rng: u32,
    pub config: Config,
    pub obstacles: Vec<Obstacle>,
    pub agents: Vec<AgentState>,
    pub engagements: Vec<Engagement>,
    pub leader_id: Option<String>,
    pub events: VecDeque<Event>,
    pub history_committed: bool,
    pub last_updated_at: String,
}

pub fn arena_obstacles() -> Vec<Obstacle> {
    vec![
        Obstacle {
            id: "north-west-cover".into(),
            x: 208,
            y: 176,
            width: 64,
            height: 24,
            kind: ObstacleKind::Barrier,
        },
        Obstacle {
            id: "north-east-cover".into(),
            x: 688,
            y: 176,
            width: 64,
            height: 24,
            kind: ObstacleKind::Barrier,
        },
        Obstacle {
            id: "south-west-cover".into(),
            x: 208,
            y: 440,
            width: 64,
            height: 24,
            kind: ObstacleKind::Barrier,
        },
        Obstacle {
            id: "south-east-cover".into(),
            x: 688,
            y: 440,
            width: 64,
            height: 24,
            kind: ObstacleKind::Barrier,
        },
        Obstacle {
            id: "west-pillar".into(),
            x: 384,
            y: 288,
            width: 24,
            height: 64,
            kind: ObstacleKind::Wall,
        },
        Obstacle {
            id: "east-pillar".into(),
            x: 552,
            y: 288,
            width: 24,
            height: 64,
            kind: ObstacleKind::Wall,
        },
    ]
}

fn short_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn valid_sprite(value: &str) -> bool {
    value.starts_with("assets/agents/")
        && value.ends_with(".png")
        && value.len() <= 100
        && !value.contains("..")
}
fn safe_summary(value: &str) -> String {
    value.chars().take(220).collect()
}

fn emit(
    sim: &mut Simulation,
    event_type: EventType,
    agent_id: String,
    target_id: Option<String>,
    summary: String,
) {
    sim.sequence += 1;
    if sim.events.len() == EVENT_LIMIT {
        sim.events.pop_front();
    }
    sim.events.push_back(Event {
        seq: sim.sequence,
        event_type,
        agent_id,
        target_id,
        round: sim.round,
        summary: safe_summary(&summary),
    });
}

pub fn start(config: Config, updated_at: String) -> Result<Simulation, String> {
    if config.seed == 0
        || !(2..=MAX_AGENTS).contains(&config.agents.len())
        || config.max_rounds < 20
        || config.max_rounds > 5000
        || config.match_number == 0
    {
        return Err(
            "Survival requires a seed, 2-20 agents, a match number, and 20-5000 rounds".into(),
        );
    }
    let mut ids = std::collections::BTreeSet::new();
    for agent in &config.agents {
        if !short_id(&agent.id)
            || agent.name.trim().is_empty()
            || agent.name.len() > 48
            || !valid_sprite(&agent.sprite)
            || agent.strategy.len() > 120
            || !ids.insert(agent.id.clone())
        {
            return Err("Invalid or duplicate Survival agent identity/configuration".into());
        }
        if let Some(hint) = &agent.research_hint {
            if hint.summary.len() > 240
                || hint.source_match.as_ref().is_some_and(|id| !short_id(id))
            {
                return Err("Invalid Survival research hint".into());
            }
        }
    }
    let obstacles = arena_obstacles();
    let slots = spawn_slots();
    let agents = config
        .agents
        .iter()
        .enumerate()
        .map(|(index, agent)| {
            let (x, y) = slots[index];
            AgentState {
                id: agent.id.clone(),
                x,
                y,
                hp: 100,
                max_hp: 100,
                status: AgentStatus::Alive,
                target_id: None,
                direction: "down".into(),
                movement_intent: MovementIntent::Idle,
                recent_action: "Spawned in the arena".into(),
                research: agent
                    .research_hint
                    .as_ref()
                    .map(|hint| hint.summary.clone()),
                wins: agent.wins,
                losses: agent.losses,
                cooldown: 0,
                cornered: false,
                metrics: Metrics::default(),
            }
        })
        .collect::<Vec<_>>();
    let match_id = format!("survival-{}-{}", config.seed, config.match_number);
    let mut simulation = Simulation {
        schema_version: 1,
        match_id,
        seed: config.seed,
        match_number: config.match_number,
        status: MatchStatus::Preparing,
        sequence: 0,
        round: 0,
        rng: config.seed,
        config,
        obstacles,
        agents,
        engagements: vec![],
        leader_id: None,
        events: VecDeque::new(),
        history_committed: false,
        last_updated_at: updated_at,
    };
    let first = simulation.agents[0].id.clone();
    let match_id = simulation.match_id.clone();
    emit(
        &mut simulation,
        EventType::SurvivalMatchStarted,
        first.clone(),
        None,
        format!("Survival match {} is preparing", match_id),
    );
    for index in 0..simulation.agents.len() {
        let id = simulation.agents[index].id.clone();
        let hint = simulation.config.agents[index].research_hint.as_ref();
        let summary = hint
            .map(|memory| {
                format!(
                    "{} spawned using research from {}",
                    simulation.config.agents[index].name,
                    memory.source_match.as_deref().unwrap_or("a prior match")
                )
            })
            .unwrap_or_else(|| {
                format!(
                    "{} spawned at ({}, {})",
                    simulation.config.agents[index].name,
                    simulation.agents[index].x,
                    simulation.agents[index].y
                )
            });
        emit(&mut simulation, EventType::AgentSpawned, id, None, summary);
    }
    simulation.status = MatchStatus::Live;
    validate(&simulation)?;
    Ok(simulation)
}

fn spawn_slots() -> Vec<(u16, u16)> {
    let mut slots = Vec::with_capacity(20);
    let xs = [80, 280, 480, 680, 880];
    let ys = [80, 240, 400, 560];
    for (row, y) in ys.into_iter().enumerate() {
        for col in 0..5 {
            let x = if row % 2 == 0 { xs[col] } else { xs[4 - col] };
            slots.push((x, y));
        }
    }
    slots
}

fn blocked(x: u16, y: u16, obstacles: &[Obstacle]) -> bool {
    let radius = 12i32;
    obstacles.iter().any(|o| {
        x as i32 + radius > o.x as i32
            && x as i32 - radius < (o.x + o.width) as i32
            && y as i32 + radius > o.y as i32
            && y as i32 - radius < (o.y + o.height) as i32
    })
}
fn dist(a: &AgentState, b: &AgentState) -> u32 {
    let dx = a.x as i32 - b.x as i32;
    let dy = a.y as i32 - b.y as i32;
    ((dx * dx + dy * dy) as f64).sqrt() as u32
}
fn random(sim: &mut Simulation) -> u32 {
    let mut x = sim.rng;
    if x == 0 {
        x = 0x9e3779b9;
    }
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    sim.rng = x;
    x
}
fn aggressive(agent: &AgentConfig) -> bool {
    let s = agent.strategy.to_ascii_lowercase();
    ["aggress", "degen", "gambler", "rival", "challeng", "wild"]
        .iter()
        .any(|p| s.contains(p))
}
fn cautious(agent: &AgentConfig) -> bool {
    let s = agent.strategy.to_ascii_lowercase();
    [
        "defen", "conserv", "observer", "mentor", "builder", "careful",
    ]
    .iter()
    .any(|p| s.contains(p))
}
fn opportunist(agent: &AgentConfig) -> bool {
    let s = agent.strategy.to_ascii_lowercase();
    ["opportun", "analyst", "strateg", "quant", "trader", "adapt"]
        .iter()
        .any(|p| s.contains(p))
}

fn target_for(sim: &Simulation, index: usize) -> Option<usize> {
    let actor = &sim.agents[index];
    let cfg = &sim.config.agents[index];
    let previous = actor.target_id.as_ref().and_then(|id| {
        sim.agents
            .iter()
            .position(|a| &a.id == id && a.status == AgentStatus::Alive)
    });
    let mut candidates = sim
        .agents
        .iter()
        .enumerate()
        .filter(|(j, a)| *j != index && a.status == AgentStatus::Alive)
        .map(|(j, a)| {
            let d = dist(actor, a) as i64;
            let low_hp = (100 - a.hp) as i64;
            let mut score = d;
            if opportunist(cfg) {
                score -= low_hp * 2;
            }
            if aggressive(cfg) {
                score -= low_hp / 2;
            }
            if cfg
                .research_hint
                .as_ref()
                .is_some_and(|h| h.avoid_surrounded)
            {
                let nearby = sim
                    .agents
                    .iter()
                    .filter(|other| {
                        other.id != a.id
                            && other.status == AgentStatus::Alive
                            && dist(a, other) < 100
                    })
                    .count() as i64;
                score += nearby * 80;
            }
            (score, j)
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| sim.agents[a.1].id.cmp(&sim.agents[b.1].id))
    });
    if let Some(old) = previous {
        let old_score = candidates.iter().find(|(_, j)| *j == old).map(|(s, _)| *s);
        if old_score.is_some_and(|score| {
            candidates
                .first()
                .is_some_and(|(best, _)| score <= *best + 60)
        }) {
            return Some(old);
        }
    }
    candidates.first().map(|(_, j)| *j)
}

fn cell_for(x: u16, y: u16) -> usize {
    ((y / TILE) as usize) * ((MAP_WIDTH / TILE) as usize) + (x / TILE) as usize
}
fn cell_xy(cell: usize) -> (u16, u16) {
    let cols = (MAP_WIDTH / TILE) as usize;
    (
        ((cell % cols) as u16) * TILE + TILE / 2,
        ((cell / cols) as u16) * TILE + TILE / 2,
    )
}
fn neighbors(cell: usize) -> [Option<usize>; 4] {
    let cols = (MAP_WIDTH / TILE) as usize;
    let rows = (MAP_HEIGHT / TILE) as usize;
    let x = cell % cols;
    let y = cell / cols;
    [
        if y > 0 { Some(cell - cols) } else { None },
        if x + 1 < cols { Some(cell + 1) } else { None },
        if y + 1 < rows {
            Some(cell + cols)
        } else {
            None
        },
        if x > 0 { Some(cell - 1) } else { None },
    ]
}
fn path_next(sim: &Simulation, from: &AgentState, target: &AgentState) -> Option<(u16, u16)> {
    let start = cell_for(from.x, from.y);
    let total = ((MAP_WIDTH / TILE) * (MAP_HEIGHT / TILE)) as usize;
    let mut parents = vec![usize::MAX; total];
    let mut queue = VecDeque::new();
    parents[start] = start;
    queue.push_back(start);
    while let Some(cell) = queue.pop_front() {
        let (x, y) = cell_xy(cell);
        let dx = x as i32 - target.x as i32;
        let dy = y as i32 - target.y as i32;
        if ((dx * dx + dy * dy) as f64).sqrt() as u32 <= ATTACK_RANGE {
            let mut cursor = cell;
            while parents[cursor] != start && cursor != start {
                cursor = parents[cursor];
            }
            return Some(cell_xy(cursor));
        }
        for next in neighbors(cell).into_iter().flatten() {
            if parents[next] != usize::MAX {
                continue;
            }
            let (nx, ny) = cell_xy(next);
            if blocked(nx, ny, &sim.obstacles) {
                continue;
            }
            parents[next] = cell;
            queue.push_back(next);
        }
    }
    None
}
fn move_toward(agent: &mut AgentState, destination: (u16, u16)) {
    let dx = destination.0 as i32 - agent.x as i32;
    let dy = destination.1 as i32 - agent.y as i32;
    let distance = ((dx * dx + dy * dy) as f64).sqrt();
    if distance < 1.0 {
        return;
    }
    let step = (MOVE_PER_TICK as f64).min(distance);
    let x = (agent.x as f64 + dx as f64 / distance * step).round() as u16;
    let y = (agent.y as f64 + dy as f64 / distance * step).round() as u16;
    agent.direction = if dx.abs() > dy.abs() {
        if dx < 0 {
            "left"
        } else {
            "right"
        }
    } else if dy < 0 {
        "up"
    } else {
        "down"
    }
    .into();
    agent.x = x.min(MAP_WIDTH - 12);
    agent.y = y.min(MAP_HEIGHT - 12);
}
fn retreat_to(sim: &Simulation, index: usize, target: usize) -> Option<(u16, u16)> {
    let agent = &sim.agents[index];
    let enemy = &sim.agents[target];
    let current = dist(agent, enemy);
    neighbors(cell_for(agent.x, agent.y))
        .into_iter()
        .flatten()
        .map(cell_xy)
        .filter(|(x, y)| !blocked(*x, *y, &sim.obstacles))
        .max_by_key(|(x, y)| {
            let dx = *x as i32 - enemy.x as i32;
            let dy = *y as i32 - enemy.y as i32;
            ((dx * dx + dy * dy) as u32).saturating_sub(current * current / 2)
        })
}
fn add_action(engagement: &mut Engagement, action: String) {
    engagement.recent_actions.push(action);
    if engagement.recent_actions.len() > 6 {
        engagement.recent_actions.remove(0);
    }
}

pub fn advance(sim: &mut Simulation, updated_at: String) -> Result<Vec<Event>, String> {
    validate(sim)?;
    if sim.status == MatchStatus::Finished {
        return Err("Survival match is already finished".into());
    }
    let old_sequence = sim.sequence;
    sim.round += 1;
    sim.last_updated_at = updated_at;
    let alive = (0..sim.agents.len())
        .filter(|i| sim.agents[*i].status == AgentStatus::Alive)
        .collect::<Vec<_>>();
    for &i in &alive {
        sim.agents[i].metrics.time_alive += 1;
        if sim.agents[i].cooldown > 0 {
            sim.agents[i].cooldown -= 1;
        }
    }
    let mut target_indices = vec![None; sim.agents.len()];
    for &i in &alive {
        let old_target = sim.agents[i].target_id.clone();
        let target = target_for(sim, i);
        target_indices[i] = target;
        let new_target = target.map(|j| sim.agents[j].id.clone());
        if old_target != new_target {
            if old_target.is_some() {
                sim.agents[i].metrics.target_changes += 1;
            }
            sim.agents[i].target_id = new_target.clone();
            let event = if old_target.is_some() {
                EventType::TargetChanged
            } else {
                EventType::TargetSelected
            };
            let name = target
                .map(|j| sim.config.agents[j].name.as_str())
                .unwrap_or("opponent");
            emit(
                sim,
                event,
                sim.agents[i].id.clone(),
                new_target.clone(),
                format!(
                    "{} selected {} as a target",
                    sim.config.agents[i].name, name
                ),
            );
        }
    }
    // Decide movement from a shared turn snapshot, then apply every move before resolving melee.
    let start_positions = sim.agents.clone();
    let mut planned = vec![None; sim.agents.len()];
    let mut intents = vec![MovementIntent::Idle; sim.agents.len()];
    for &i in &alive {
        let Some(j) = target_indices[i] else { continue };
        let actor = &start_positions[i];
        let enemy = &start_positions[j];
        let crowd = sim
            .agents
            .iter()
            .filter(|other| {
                other.id != actor.id
                    && other.status == AgentStatus::Alive
                    && dist(actor, other) < 92
            })
            .count();
        let low = actor.hp <= 28;
        let should_retreat = low
            && (cautious(&sim.config.agents[i])
                || crowd >= 3
                || sim.config.agents[i]
                    .research_hint
                    .as_ref()
                    .is_some_and(|h| h.avoid_surrounded && crowd >= 2));
        if should_retreat {
            intents[i] = MovementIntent::Retreat;
            planned[i] = retreat_to(sim, i, j);
        } else if dist(actor, enemy) > ATTACK_RANGE {
            intents[i] = MovementIntent::Chase;
            planned[i] = path_next(sim, actor, enemy);
        } else {
            intents[i] = MovementIntent::Idle;
        }
    }
    for &i in &alive {
        if let Some(j) = target_indices[i] {
            let prior = sim.agents[i].recent_action.clone();
            let intent = intents[i];
            let target_id = sim.agents[j].id.clone();
            let actor_name = sim.config.agents[i].name.clone();
            let new_action = match intent {
                MovementIntent::Chase => format!("Chasing {}", sim.config.agents[j].name),
                MovementIntent::Retreat => format!("Retreating from {}", sim.config.agents[j].name),
                MovementIntent::Reposition => "Repositioning around cover".into(),
                MovementIntent::Idle => format!("Engaging {}", sim.config.agents[j].name),
            };
            if intent == MovementIntent::Retreat {
                sim.agents[i].metrics.retreat_count += u32::from(!prior.starts_with("Retreating"));
                if !prior.starts_with("Retreating") {
                    emit(
                        sim,
                        EventType::RetreatStarted,
                        sim.agents[i].id.clone(),
                        Some(target_id.clone()),
                        format!("{} disengages to protect low HP", actor_name),
                    );
                }
            }
            if intent == MovementIntent::Chase && !prior.starts_with("Chasing") {
                emit(
                    sim,
                    EventType::ChaseStarted,
                    sim.agents[i].id.clone(),
                    Some(target_id.clone()),
                    format!("{} closes on {}", actor_name, sim.config.agents[j].name),
                );
            }
            sim.agents[i].movement_intent = intent;
            sim.agents[i].recent_action = new_action;
        }
    }
    for &i in &alive {
        if let Some(destination) = planned[i] {
            let old = (sim.agents[i].x, sim.agents[i].y);
            move_toward(&mut sim.agents[i], destination);
            if (sim.agents[i].x, sim.agents[i].y) != old
                && blocked(sim.agents[i].x, sim.agents[i].y, &sim.obstacles)
            {
                sim.agents[i].x = old.0;
                sim.agents[i].y = old.1;
            }
        }
    }
    let mut cornered_events = vec![];
    for &i in &alive {
        if sim.agents[i].status != AgentStatus::Alive {
            continue;
        }
        let threats = sim
            .agents
            .iter()
            .filter(|other| {
                other.id != sim.agents[i].id
                    && other.status == AgentStatus::Alive
                    && dist(&sim.agents[i], other) < 84
            })
            .count();
        let no_path = target_indices[i].is_some_and(|j| {
            dist(&sim.agents[i], &sim.agents[j]) > ATTACK_RANGE
                && path_next(sim, &sim.agents[i], &sim.agents[j]).is_none()
        });
        let is_cornered =
            (threats >= 3 || no_path) && sim.agents[i].movement_intent != MovementIntent::Retreat;
        let was = sim.agents[i].cornered;
        if is_cornered && !was {
            sim.agents[i].metrics.times_cornered += 1;
            cornered_events.push((
                i,
                EventType::AgentCornered,
                sim.agents[i].target_id.clone(),
                format!(
                    "{} is pinned by nearby opponents or arena cover",
                    sim.config.agents[i].name
                ),
            ));
        } else if was && !is_cornered {
            sim.agents[i].metrics.escapes += 1;
            cornered_events.push((
                i,
                EventType::AgentEscaped,
                sim.agents[i].target_id.clone(),
                format!("{} broke out of the corner", sim.config.agents[i].name),
            ));
        }
        sim.agents[i].cornered = is_cornered;
    }
    for (i, event, target, summary) in cornered_events {
        emit(sim, event, sim.agents[i].id.clone(), target, summary);
    }
    // Rotating initiative prevents a fixed roster index from always winning simultaneous KOs.
    for offset in 0..alive.len() {
        let i = alive[(offset + sim.round as usize) % alive.len()];
        if sim.agents[i].status != AgentStatus::Alive || sim.agents[i].cooldown > 0 {
            continue;
        }
        let Some(j) = target_indices[i] else { continue };
        if sim.agents[j].status != AgentStatus::Alive
            || dist(&sim.agents[i], &sim.agents[j]) > ATTACK_RANGE
            || sim.agents[i].movement_intent == MovementIntent::Retreat
        {
            continue;
        }
        let (low, high) = if opportunist(&sim.config.agents[i]) {
            (9u16, 16u16)
        } else if aggressive(&sim.config.agents[i]) {
            (10, 18)
        } else {
            (7, 14)
        };
        let damage = low + (random(sim) as u16 % (high - low + 1));
        sim.agents[i].cooldown = ATTACK_COOLDOWN;
        sim.agents[i].metrics.attacks_landed += 1;
        let id = sim.agents[i].id.clone();
        let target_id = sim.agents[j].id.clone();
        let engagement_id = format!("f{}-{}", i, j);
        let mut engagement = Engagement {
            id: engagement_id,
            attacker_id: id.clone(),
            target_id: target_id.clone(),
            status: EngagementStatus::Fighting,
            recent_damage: Some(damage),
            recent_actions: vec![],
        };
        add_action(
            &mut engagement,
            format!("{} started a melee attack", sim.config.agents[i].name),
        );
        emit(
            sim,
            EventType::AttackStarted,
            id.clone(),
            Some(target_id.clone()),
            format!(
                "{} swings at {}",
                sim.config.agents[i].name, sim.config.agents[j].name
            ),
        );
        let actual = damage.min(sim.agents[j].hp);
        sim.agents[j].hp -= actual;
        sim.agents[i].metrics.damage_dealt += actual as u32;
        sim.agents[j].metrics.damage_taken += actual as u32;
        sim.agents[i].recent_action = format!("Hit {} for {}", sim.config.agents[j].name, actual);
        sim.agents[j].recent_action =
            format!("Took {} damage from {}", actual, sim.config.agents[i].name);
        add_action(
            &mut engagement,
            format!("{} hit for {}", sim.config.agents[i].name, actual),
        );
        emit(
            sim,
            EventType::AttackLanded,
            id.clone(),
            Some(target_id.clone()),
            format!(
                "{} hit {} for {} damage",
                sim.config.agents[i].name, sim.config.agents[j].name, actual
            ),
        );
        emit(
            sim,
            EventType::DamageTaken,
            target_id.clone(),
            Some(id.clone()),
            format!(
                "{} lost {} HP; {} HP remain",
                sim.config.agents[j].name, actual, sim.agents[j].hp
            ),
        );
        sim.agents[i].movement_intent = MovementIntent::Idle;
        sim.agents[j].movement_intent = MovementIntent::Idle;
        sim.engagements.retain(|e| e.attacker_id != id);
        sim.engagements.push(engagement);
        if sim.agents[j].hp == 0 {
            let place = (sim
                .agents
                .iter()
                .filter(|a| a.status == AgentStatus::Alive)
                .count()) as u8;
            sim.agents[j].status = AgentStatus::Eliminated;
            sim.agents[j].target_id = None;
            sim.agents[j].metrics.final_placement = Some(place);
            sim.agents[i].metrics.eliminations += 1;
            emit(
                sim,
                EventType::AgentEliminated,
                target_id.clone(),
                Some(id.clone()),
                format!(
                    "{} is eliminated by {} in round {}",
                    sim.config.agents[j].name, sim.config.agents[i].name, sim.round
                ),
            );
        }
    }
    let alive_now = sim
        .agents
        .iter()
        .filter(|a| a.status == AgentStatus::Alive)
        .count();
    if alive_now <= 1 || sim.round >= sim.config.max_rounds {
        finish(sim)?;
    } else {
        for i in 0..sim.agents.len() {
            if sim.agents[i].status == AgentStatus::Alive
                && sim.agents[i].target_id.as_ref().is_some_and(|id| {
                    sim.agents
                        .iter()
                        .find(|a| &a.id == id)
                        .is_none_or(|a| a.status != AgentStatus::Alive)
                })
            {
                sim.agents[i].target_id = None;
            }
        }
        rebuild_engagements(sim, &target_indices);
        sim.leader_id = sim
            .agents
            .iter()
            .filter(|a| a.status == AgentStatus::Alive)
            .max_by_key(|a| {
                (
                    a.hp,
                    a.metrics.damage_dealt,
                    std::cmp::Reverse(a.id.clone()),
                )
            })
            .map(|a| a.id.clone());
    }
    validate(sim)?;
    Ok(sim
        .events
        .iter()
        .filter(|e| e.seq > old_sequence)
        .cloned()
        .collect())
}

fn finish(sim: &mut Simulation) -> Result<(), String> {
    if sim.status == MatchStatus::Finished {
        return Ok(());
    }
    let winner = sim
        .agents
        .iter()
        .enumerate()
        .filter(|(_, a)| a.status == AgentStatus::Alive)
        .max_by_key(|(_, a)| {
            (
                a.hp,
                a.metrics.damage_dealt,
                std::cmp::Reverse(a.id.clone()),
            )
        })
        .map(|(i, _)| i);
    if let Some(w) = winner {
        let winner_id = sim.agents[w].id.clone();
        let winner_name = sim.config.agents[w].name.clone();
        for i in 0..sim.agents.len() {
            if i == w {
                sim.agents[i].wins += 1;
                sim.agents[i].metrics.final_placement = Some(1);
            } else if sim.agents[i].status == AgentStatus::Alive {
                sim.agents[i].status = AgentStatus::Eliminated;
                sim.agents[i].hp = 0;
                sim.agents[i].losses += 1;
                sim.agents[i].metrics.final_placement = Some(2);
                emit(
                    sim,
                    EventType::AgentEliminated,
                    sim.agents[i].id.clone(),
                    Some(winner_id.clone()),
                    format!(
                        "{} placed behind {} at the round limit",
                        sim.config.agents[i].name, winner_name
                    ),
                );
            } else {
                sim.agents[i].losses += 1;
            }
        }
        sim.leader_id = Some(winner_id.clone());
        emit(
            sim,
            EventType::WinnerDeclared,
            winner_id.clone(),
            None,
            format!("{} is the last agent standing", winner_name),
        );
        for i in 0..sim.agents.len() {
            let summary = research_summary(&sim.agents[i]);
            sim.agents[i].research = Some(summary.clone());
            emit(
                sim,
                EventType::ResearchUpdated,
                sim.agents[i].id.clone(),
                None,
                summary,
            );
        }
        emit(
            sim,
            EventType::SurvivalMatchCompleted,
            winner_id,
            None,
            format!("{} won Survival after {} rounds", winner_name, sim.round),
        );
    } else {
        sim.leader_id = None;
        emit(
            sim,
            EventType::SurvivalMatchCompleted,
            sim.agents[0].id.clone(),
            None,
            "Survival match ended without a survivor".into(),
        );
    }
    sim.status = MatchStatus::Finished;
    sim.engagements.clear();
    Ok(())
}

fn research_summary(agent: &AgentState) -> String {
    if agent.metrics.final_placement == Some(1) {
        format!(
            "Won with {} HP after dealing {} damage; {} attacks landed.",
            agent.hp, agent.metrics.damage_dealt, agent.metrics.attacks_landed
        )
    } else if agent.metrics.times_cornered > 0 {
        format!(
            "Finished #{} after being cornered {} times; avoid multi-agent pressure next match.",
            agent.metrics.final_placement.unwrap_or(2),
            agent.metrics.times_cornered
        )
    } else if agent.metrics.retreat_count > 0 {
        format!(
            "Finished #{} after {} retreats and {} damage dealt; disengage earlier when low on HP.",
            agent.metrics.final_placement.unwrap_or(2),
            agent.metrics.retreat_count,
            agent.metrics.damage_dealt
        )
    } else {
        format!(
            "Finished #{} with {} damage dealt and {} damage taken.",
            agent.metrics.final_placement.unwrap_or(2),
            agent.metrics.damage_dealt,
            agent.metrics.damage_taken
        )
    }
}

fn rebuild_engagements(sim: &mut Simulation, targets: &[Option<usize>]) {
    let mut engagements = Vec::new();
    for (i, target) in targets.iter().enumerate().take(sim.agents.len()) {
        if sim.agents[i].status != AgentStatus::Alive {
            continue;
        }
        let Some(j) = *target else { continue };
        if sim.agents[j].status != AgentStatus::Alive {
            continue;
        }
        let status = if sim.agents[i].movement_intent == MovementIntent::Retreat {
            EngagementStatus::Retreating
        } else if dist(&sim.agents[i], &sim.agents[j]) <= ATTACK_RANGE {
            EngagementStatus::Fighting
        } else {
            EngagementStatus::Chasing
        };
        let id = format!("f{}-{}", i, j);
        let prior = sim
            .engagements
            .iter()
            .find(|e| e.attacker_id == sim.agents[i].id && e.target_id == sim.agents[j].id);
        engagements.push(Engagement {
            id,
            attacker_id: sim.agents[i].id.clone(),
            target_id: sim.agents[j].id.clone(),
            status,
            recent_damage: prior.and_then(|e| e.recent_damage),
            recent_actions: prior.map(|e| e.recent_actions.clone()).unwrap_or_default(),
        });
    }
    sim.engagements = engagements;
}

pub fn validate(sim: &Simulation) -> Result<(), String> {
    if sim.schema_version != 1
        || sim.match_id != format!("survival-{}-{}", sim.config.seed, sim.config.match_number)
        || sim.seed != sim.config.seed
        || sim.config.seed == 0
        || sim.config.match_number == 0
        || !(20..=5000).contains(&sim.config.max_rounds)
        || sim.round > sim.config.max_rounds
        || !(2..=MAX_AGENTS).contains(&sim.config.agents.len())
        || sim.sequence == 0
        || sim.agents.len() != sim.config.agents.len()
        || sim.agents.len() < 2
        || sim.agents.len() > MAX_AGENTS
        || sim.events.len() > EVENT_LIMIT
        || sim.obstacles != arena_obstacles()
    {
        return Err("Invalid Survival checkpoint metadata".into());
    }
    let mut previous = 0;
    let ids = sim
        .config
        .agents
        .iter()
        .map(|a| a.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if ids.len() != sim.config.agents.len() {
        return Err("Invalid Survival checkpoint identities".into());
    }
    for (i, a) in sim.agents.iter().enumerate() {
        let c = &sim.config.agents[i];
        if !short_id(&c.id)
            || c.name.trim().is_empty()
            || c.name.len() > 48
            || !valid_sprite(&c.sprite)
            || c.strategy.len() > 120
            || c.research_hint.as_ref().is_some_and(|hint| {
                hint.summary.len() > 240
                    || hint.source_match.as_ref().is_some_and(|id| !short_id(id))
            })
            || a.id != c.id
            || a.x > MAP_WIDTH
            || a.y > MAP_HEIGHT
            || !matches!(a.direction.as_str(), "up" | "down" | "left" | "right")
            || a.recent_action.len() > 180
            || a.hp > a.max_hp
            || a.max_hp != 100
            || (a.status == AgentStatus::Eliminated && a.hp != 0)
            || (a.status == AgentStatus::Alive && a.hp == 0)
            || blocked(a.x, a.y, &sim.obstacles)
            || a.wins < c.wins
            || a.losses < c.losses
            || a.metrics
                .final_placement
                .is_some_and(|place| place == 0 || place as usize > sim.agents.len())
            || a.research.as_ref().is_some_and(|text| text.len() > 240)
        {
            return Err("Invalid Survival agent state".into());
        }
        if let Some(target) = &a.target_id {
            if !ids.contains(target.as_str()) || target == &a.id {
                return Err("Invalid Survival target reference".into());
            }
        }
    }
    for event in &sim.events {
        if event.seq <= previous
            || event.seq > sim.sequence
            || !ids.contains(event.agent_id.as_str())
            || event
                .target_id
                .as_ref()
                .is_some_and(|id| !ids.contains(id.as_str()))
            || event.round > sim.round
            || event.summary.len() > 240
        {
            return Err("Invalid Survival event log".into());
        }
        previous = event.seq;
    }
    if sim
        .leader_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id.as_str()))
    {
        return Err("Invalid Survival winner".into());
    }
    if sim.status == MatchStatus::Finished
        && (sim.leader_id.is_none()
            || sim
                .agents
                .iter()
                .filter(|agent| agent.status == AgentStatus::Alive)
                .count()
                != 1
            || sim
                .agents
                .iter()
                .any(|agent| agent.metrics.final_placement.is_none()))
    {
        return Err("Invalid completed Survival result".into());
    }
    if sim.status == MatchStatus::Live && sim.round >= sim.config.max_rounds {
        return Err("Invalid live Survival round".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config(n: usize) -> Config {
        let names = [
            "Founder",
            "Trader",
            "Gambler",
            "Analyst",
            "Defender",
            "Strategist",
            "Social",
            "Degen",
            "Conservative",
            "Aggressive",
            "Explorer",
            "Builder",
            "Quant",
            "Random",
            "Tournament",
            "Mentor",
            "Rival",
            "Observer",
            "Adaptive",
            "Wild Card",
        ];
        Config {
            seed: 77,
            match_number: 1,
            max_rounds: 1800,
            agents: (0..n)
                .map(|i| AgentConfig {
                    id: format!("agent-{}", i + 1),
                    name: names[i].into(),
                    sprite: format!("assets/agents/{:02}-founder.png", i + 1),
                    strategy: names[i].into(),
                    wins: 0,
                    losses: 0,
                    research_hint: None,
                })
                .collect(),
        }
    }
    #[test]
    fn populations_two_four_eight_and_twenty_finish_deterministically() {
        for n in [2, 4, 8, 20] {
            let mut a = start(config(n), "now".into()).unwrap();
            let mut b = a.clone();
            let mut ticks = 0;
            while a.status != MatchStatus::Finished && ticks < 1800 {
                advance(&mut a, "now".into()).unwrap();
                advance(&mut b, "now".into()).unwrap();
                assert_eq!(a, b);
                ticks += 1;
            }
            assert_eq!(a.status, MatchStatus::Finished, "{n} agents");
            assert!(a.leader_id.is_some());
            assert!(a
                .events
                .iter()
                .any(|e| e.event_type == EventType::WinnerDeclared));
            assert!(a.agents.iter().all(|x| x.metrics.final_placement.is_some()));
        }
    }
    #[test]
    fn memory_hint_is_recorded_and_changes_crowd_avoidance_policy() {
        let mut c = config(4);
        c.agents[0].research_hint = Some(ResearchHint {
            avoid_surrounded: true,
            summary: "avoid multi-agent pressure".into(),
            source_match: Some("survival-76-1".into()),
        });
        let mut without_memory = start(config(4), "now".into()).unwrap();
        let mut with_memory = start(c.clone(), "now".into()).unwrap();
        for sim in [&mut without_memory, &mut with_memory] {
            for (agent, (x, y)) in
                sim.agents
                    .iter_mut()
                    .zip([(110, 100), (200, 100), (260, 100), (800, 500)])
            {
                agent.x = x;
                agent.y = y;
            }
        }
        assert_eq!(target_for(&without_memory, 0), Some(1));
        assert_eq!(target_for(&with_memory, 0), Some(2));

        let mut s = start(c, "now".into()).unwrap();
        assert_eq!(
            s.agents[0].research.as_deref(),
            Some("avoid multi-agent pressure")
        );
        assert!(s.events.iter().any(|e| e.agent_id == "agent-1"
            && e.event_type == EventType::AgentSpawned
            && e.summary.contains("survival-76-1")));
        for _ in 0..12 {
            advance(&mut s, "now".into()).unwrap();
        }
        assert!(
            s.config.agents[0]
                .research_hint
                .as_ref()
                .unwrap()
                .avoid_surrounded
        );
    }
    #[test]
    fn semantic_damage_and_elimination_order_is_valid() {
        let mut s = start(config(2), "now".into()).unwrap();
        while s.status != MatchStatus::Finished {
            advance(&mut s, "now".into()).unwrap();
        }
        let landed = s
            .events
            .iter()
            .filter(|e| e.event_type == EventType::AttackLanded)
            .count();
        let taken = s
            .events
            .iter()
            .filter(|e| e.event_type == EventType::DamageTaken)
            .count();
        assert_eq!(landed, taken);
        assert!(
            s.events
                .iter()
                .position(|e| e.event_type == EventType::WinnerDeclared)
                .unwrap()
                < s.events
                    .iter()
                    .position(|e| e.event_type == EventType::SurvivalMatchCompleted)
                    .unwrap()
        );
    }
    #[test]
    fn damage_event_identifies_the_agent_whose_health_changed() {
        let mut s = start(config(2), "now".into()).unwrap();
        while s.status != MatchStatus::Finished {
            advance(&mut s, "now".into()).unwrap();
        }
        let events = s.events.iter().collect::<Vec<_>>();
        let landed = events
            .iter()
            .find(|event| event.event_type == EventType::AttackLanded)
            .unwrap();
        let damage = events
            .iter()
            .find(|event| event.event_type == EventType::DamageTaken)
            .unwrap();
        assert_eq!(damage.agent_id, landed.target_id.as_deref().unwrap());
        assert_eq!(damage.target_id.as_deref(), Some(landed.agent_id.as_str()));
        assert!(landed.seq < damage.seq);
    }
    #[test]
    fn obstacles_are_avoided_by_chase_path() {
        let mut s = start(config(2), "now".into()).unwrap();
        s.agents[0].x = 350;
        s.agents[0].y = 320;
        s.agents[1].x = 610;
        s.agents[1].y = 320;
        for _ in 0..20 {
            advance(&mut s, "now".into()).unwrap();
            if s.status == MatchStatus::Finished {
                break;
            }
        }
        assert!(s.agents.iter().all(|a| !blocked(a.x, a.y, &s.obstacles)));
    }
    #[test]
    fn restored_checkpoints_revalidate_identity_and_ruleset() {
        let initial = start(config(2), "now".into()).unwrap();
        let mut duplicate = initial.clone();
        duplicate.config.agents[1].id = duplicate.config.agents[0].id.clone();
        assert!(validate(&duplicate).is_err());

        let mut invalid_limit = initial.clone();
        invalid_limit.config.max_rounds = 0;
        assert!(validate(&invalid_limit).is_err());

        let mut unsafe_sprite = initial;
        unsafe_sprite.config.agents[0].sprite = "https://example.invalid/agent.png".into();
        assert!(validate(&unsafe_sprite).is_err());
    }
}
