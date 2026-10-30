const MAX_WORLD_AGENTS = 6;

// This ordered route mirrors the collision-safe public path in web/src/world/map.ts.
// Server authority only moves between adjacent points; clients only interpolate it.
export const WORLD_AGENT_ROUTE = Object.freeze([
  {x:430,y:310},{x:640,y:320},{x:740,y:350},{x:660,y:430},{x:430,y:510},
  {x:340,y:430},{x:0,y:430},{x:-300,y:430},{x:-650,y:430},{x:-650,y:760},
  {x:-400,y:900},{x:-200,y:1300},{x:200,y:1370},{x:700,y:1450},
  {x:700,y:1320},{x:1000,y:1320},{x:1000,y:1100},{x:1660,y:1100},{x:1660,y:1052},{x:1780,y:1052},
  {x:1780,y:820},{x:2050,y:820},{x:2300,y:820},{x:2448,y:820},{x:2448,y:608},
  {x:2450,y:600},{x:2420,y:100},{x:2100,y:100},{x:1900,y:200},{x:1900,y:400},
  {x:1702,y:460},{x:1568,y:365},{x:1568,y:320},{x:1568,y:365},{x:1702,y:460},
  {x:1702,y:640},{x:1870,y:668},{x:1702,y:640},{x:1702,y:460},{x:1280,y:460},{x:1100,y:460},
  {x:900,y:760},{x:700,y:760},{x:430,y:730},{x:430,y:510},
  {x:576,y:0},{x:576,y:-250},{x:576,y:-168},{x:790,y:-168},{x:1000,y:-168},
  {x:1140,y:-300},{x:1400,y:-180},{x:1200,y:0},{x:800,y:0},{x:576,y:0},
  {x:-580,y:350},{x:-350,y:350},{x:-210,y:780},{x:-100,y:680},{x:220,y:1120},
  {x:420,y:1390},{x:700,y:1390},{x:820,y:1280},{x:980,y:1390},{x:1160,y:1410},{x:1500,y:1230},
  {x:1568,y:340},{x:1702,y:460},{x:1870,y:668}
]);

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function direction(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export class WorldAgentPresenceService {
  constructor({ profiles, now = () => Date.now(), tickMs = 100, rosterMs = 5_000, maxAgents = MAX_WORLD_AGENTS } = {}) {
    if (typeof profiles !== 'function') throw new Error('World agents require a canonical profile provider');
    this.profiles = profiles;
    this.now = now;
    this.tickMs = tickMs;
    this.rosterMs = rosterMs;
    this.maxAgents = maxAgents;
    this.agents = new Map();
    this.emit = () => {};
    this.lastTickAt = now();
    this.lastRosterAt = -Infinity;
    this.timer = null;
  }

  setEmitter(emit) {
    this.emit = typeof emit === 'function' ? emit : () => {};
  }

  publicAgent(agent) {
    const { waypoint, routeDirection, speed, pauseUntil, ...value } = agent;
    return value;
  }

  snapshot() {
    this.syncRoster();
    return [...this.agents.values()].map(agent => this.publicAgent(agent));
  }

  syncRoster(force = false) {
    const now = this.now();
    if (!force && now - this.lastRosterAt < this.rosterMs) return;
    this.lastRosterAt = now;
    const selected = this.profiles().filter(profile => profile.arenaStatus !== 'fighting').slice(0, this.maxAgents);
    const selectedIds = new Set(selected.map(profile => profile.id));
    for (const [id] of this.agents) {
      if (!selectedIds.has(id)) {
        this.agents.delete(id);
        this.emit('AgentLeft', { agent_id: id });
      }
    }
    selected.forEach((profile, index) => {
      const existing = this.agents.get(profile.id);
      if (existing) {
        existing.display_name = profile.name;
        existing.strategy = profile.strategy;
        existing.sprite = profile.sprite;
        existing.recent_winner = Boolean(profile.recentWinner);
        return;
      }
      const seed = hash(profile.id);
      const waypoint = (index * 11 + seed) % WORLD_AGENT_ROUTE.length;
      const position = WORLD_AGENT_ROUTE[waypoint];
      const agent = {
        player_id: `agent:${profile.id}`,
        agent_id: profile.id,
        kind: 'canonical_agent',
        display_name: profile.name,
        avatar: 'canonical_agent',
        sprite: profile.sprite,
        strategy: profile.strategy,
        position: { ...position },
        direction: 'down',
        animation_state: 'idle',
        activity: 'Taking a world break',
        updated_at: new Date(now).toISOString(),
        recent_winner: Boolean(profile.recentWinner),
        waypoint,
        routeDirection: seed % 2 === 0 ? 1 : -1,
        speed: 35 + seed % 22,
        pauseUntil: now + 500 + seed % 3_500
      };
      this.agents.set(profile.id, agent);
      this.emit('AgentJoined', { agent: this.publicAgent(agent) });
    });
  }

  tick() {
    this.syncRoster();
    const now = this.now();
    const seconds = Math.min(0.25, Math.max(0, now - this.lastTickAt) / 1_000);
    this.lastTickAt = now;
    if (!seconds) return;
    for (const agent of this.agents.values()) {
      if (now < agent.pauseUntil) {
        if (agent.animation_state !== 'idle') {
          agent.animation_state = 'idle';
          agent.activity = 'Taking a world break';
          agent.updated_at = new Date(now).toISOString();
          this.emit('AgentUpdated', { agent: this.publicAgent(agent) });
        }
        continue;
      }
      const nextIndex = (agent.waypoint + agent.routeDirection + WORLD_AGENT_ROUTE.length) % WORLD_AGENT_ROUTE.length;
      const target = WORLD_AGENT_ROUTE[nextIndex];
      const dx = target.x - agent.position.x;
      const dy = target.y - agent.position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= Math.max(4, agent.speed * seconds)) {
        agent.position = { ...target };
        agent.waypoint = nextIndex;
        agent.animation_state = 'idle';
        agent.activity = 'Visiting a town landmark';
        agent.pauseUntil = now + 700 + hash(`${agent.agent_id}:${nextIndex}`) % 3_800;
      } else {
        const amount = agent.speed * seconds / distance;
        agent.position = { x: agent.position.x + dx * amount, y: agent.position.y + dy * amount };
        agent.direction = direction(dx, dy);
        agent.animation_state = 'walk';
        agent.activity = 'Walking through the shared world';
      }
      agent.updated_at = new Date(now).toISOString();
      this.emit('AgentMoved', { agent: this.publicAgent(agent) });
    }
  }

  start() {
    if (this.timer) return;
    this.syncRoster(true);
    this.lastTickAt = this.now();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.agents.clear();
  }
}
