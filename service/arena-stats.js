const VERSION = 1;
const GAME_KEYS = Object.freeze(['rps', 'tictactoe', 'survival']);
const SURVIVAL_CURSOR_LIMIT = 128;
const ROOM_CURSOR_LIMIT = 512;
/** Kept in sync with the Survival research rollup in service/arena-survival.js. */
const SURVIVAL_METRICS = Object.freeze([
  'damage_dealt', 'damage_taken', 'attacks_landed', 'target_changes',
  'retreat_count', 'time_alive', 'eliminations', 'times_cornered', 'escapes',
]);

const count = value => (Number.isFinite(value) ? value : 0);
const emptyGame = () => ({ matches: 0, draws: 0, decisions: 0 });
const emptyArena = () => ({ matches: 0, wins: 0, losses: 0, draws: 0 });
const emptyMetrics = () => Object.fromEntries(SURVIVAL_METRICS.map(key => [key, 0]));
const emptySurvival = () => ({
  matches: 0, wins: 0, losses: 0, placement_total: 0,
  latest_final_placement: null, latest_research: null, latest_match_id: null, latest_completed_at: null,
  metrics: emptyMetrics(),
});
const emptyAgent = id => ({ id, name: null, sprite: null, strategy: null, arena: emptyArena(), survival: emptySurvival() });

function emptyState() {
  return {
    version: VERSION,
    updated_at: null,
    games: { rps: emptyGame(), tictactoe: emptyGame(), survival: emptyGame() },
    agents: {},
    cursors: { rooms: {}, survival: [] },
  };
}

function normalize(saved) {
  const state = emptyState();
  if (!saved || typeof saved !== 'object' || saved.version !== VERSION) return state;
  if (typeof saved.updated_at === 'string') state.updated_at = saved.updated_at;
  for (const game of GAME_KEYS) {
    const source = saved.games?.[game];
    if (!source) continue;
    state.games[game] = { matches: count(source.matches), draws: count(source.draws), decisions: count(source.decisions) };
  }
  for (const [id, source] of Object.entries(saved.agents || {})) {
    if (!source || typeof source !== 'object') continue;
    const agent = emptyAgent(id);
    for (const field of ['name', 'sprite', 'strategy']) if (typeof source[field] === 'string') agent[field] = source[field];
    for (const field of Object.keys(agent.arena)) agent.arena[field] = count(source.arena?.[field]);
    for (const field of ['matches', 'wins', 'losses', 'placement_total']) agent.survival[field] = count(source.survival?.[field]);
    for (const field of ['latest_final_placement', 'latest_research', 'latest_match_id', 'latest_completed_at']) {
      if (source.survival?.[field] !== undefined) agent.survival[field] = source.survival[field];
    }
    for (const metric of SURVIVAL_METRICS) agent.survival.metrics[metric] = count(source.survival?.metrics?.[metric]);
    state.agents[id] = agent;
  }
  for (const [runId, matchId] of Object.entries(saved.cursors?.rooms || {})) {
    if (typeof matchId === 'string') state.cursors.rooms[runId] = matchId;
  }
  state.cursors.survival = Array.isArray(saved.cursors?.survival)
    ? saved.cursors.survival.filter(value => typeof value === 'string').slice(-SURVIVAL_CURSOR_LIMIT)
    : [];
  return state;
}

function completionTime(run, match) {
  return run.state.events?.find(event => event.type === 'GAME_FINISHED' && event.data?.matchId === match.id)?.time || null;
}

/**
 * Durable, monotonic arena rollups. Retained room checkpoints and Survival
 * history are intentionally bounded and live on an ephemeral disk in production,
 * so counts derived from them reset on deploys. This document is stored through
 * WorldStore (Postgres when DATABASE_URL is present) and only ever grows.
 *
 * Every recording pass is idempotent: room runs continue from their last
 * recorded match id and Survival matches are deduplicated by match id.
 */
export class ArenaCumulativeStats {
  constructor(store, { logger = console } = {}) {
    this.store = store;
    this.logger = logger;
    this.state = emptyState();
  }

  async restore() {
    let saved = null;
    try { saved = await this.store.load(); }
    catch (error) { this.logger.error(`Arena cumulative statistics could not be loaded: ${error.message}`); }
    this.state = normalize(saved);
    return this.state;
  }

  persist() { return this.store.save(this.state); }

  snapshot() { return structuredClone(this.state); }

  hasMatches() {
    return GAME_KEYS.some(game => this.state.games[game].matches > 0);
  }

  agent(id) {
    this.state.agents[id] ??= emptyAgent(id);
    return this.state.agents[id];
  }

  touch(completedAt) {
    if (typeof completedAt !== 'string' || !completedAt) return;
    if (!this.state.updated_at || completedAt > this.state.updated_at) this.state.updated_at = completedAt;
  }

  /** Records every newly settled RPS/Tic-Tac-Toe match from retained runs. */
  recordRooms(runs = []) {
    let recorded = 0;
    for (const run of runs) {
      if (!run?.runId || !run.state) continue;
      const matches = (run.state.matches || []).filter(match => match.status === 'settled');
      let start = 0;
      const cursor = this.state.cursors.rooms[run.runId];
      if (cursor) {
        const index = matches.findIndex(match => match.id === cursor);
        if (index >= 0) start = index + 1;
      }
      for (const match of matches.slice(start)) {
        this.recordVersus(run, match);
        recorded++;
      }
      if (matches.length) this.state.cursors.rooms[run.runId] = matches.at(-1).id;
    }
    // Cursors are only dropped by the bounded retention window. Deleting a
    // cursor merely because this call did not include its run would let a
    // later pass recount an entire retained run.
    const cursors = Object.entries(this.state.cursors.rooms);
    if (cursors.length > ROOM_CURSOR_LIMIT) this.state.cursors.rooms = Object.fromEntries(cursors.slice(-ROOM_CURSOR_LIMIT));
    return recorded;
  }

  recordVersus(run, match) {
    const game = run.game === 'tictactoe' ? 'tictactoe' : 'rps';
    const summary = this.state.games[game];
    summary.matches++;
    if (match.result === 'draw') summary.draws++;
    summary.decisions += game === 'tictactoe' ? (match.moves?.length || 0) : Object.keys(match.reveals || {}).length;
    const winnerId = match.result === 'a' || match.result === 'b' ? match.players[match.result === 'a' ? 0 : 1] : null;
    for (const id of match.players || []) {
      const agent = this.agent(id);
      const source = run.state.agents?.find(candidate => candidate.id === id);
      if (source) {
        if (typeof source.name === 'string') agent.name = source.name;
        if (typeof source.sprite === 'string') agent.sprite = source.sprite;
        if (typeof source.strategy === 'string') agent.strategy = source.strategy;
      }
      agent.arena.matches++;
      if (match.result === 'draw') agent.arena.draws++;
      else if (winnerId === id) agent.arena.wins++;
      else agent.arena.losses++;
    }
    this.touch(completionTime(run, match));
  }

  /** Records every Survival result that was not already counted. */
  recordSurvival(items = []) {
    const seen = new Set(this.state.cursors.survival);
    let recorded = 0;
    for (const item of items) {
      if (!item || typeof item.match_id !== 'string' || seen.has(item.match_id)) continue;
      seen.add(item.match_id);
      const summary = this.state.games.survival;
      summary.matches++;
      const completedAt = typeof item.completed_at === 'string' ? item.completed_at : null;
      let decisions = 0;
      for (const result of item.agents || []) {
        if (!result?.id) continue;
        const agent = this.agent(result.id);
        if (typeof result.name === 'string') agent.name = result.name;
        if (typeof result.sprite === 'string') agent.sprite = result.sprite;
        if (typeof result.strategy === 'string') agent.strategy = result.strategy;
        const won = result.won === true || item.winner_id === result.id;
        agent.survival.matches++;
        if (won) agent.survival.wins++;
        else agent.survival.losses++;
        const metrics = result.metrics || {};
        for (const metric of SURVIVAL_METRICS) {
          const value = count(metrics[metric]);
          agent.survival.metrics[metric] += value;
          if (metric === 'attacks_landed' || metric === 'target_changes') decisions += value;
        }
        const placement = metrics.final_placement;
        agent.survival.placement_total += Number.isFinite(placement) ? placement : 20;
        if (Number.isFinite(placement)) agent.survival.latest_final_placement = placement;
        if (completedAt && (!agent.survival.latest_completed_at || completedAt >= agent.survival.latest_completed_at)) {
          agent.survival.latest_completed_at = completedAt;
          agent.survival.latest_match_id = item.match_id;
          agent.survival.latest_research = typeof result.research === 'string' ? result.research : null;
        }
      }
      summary.decisions += decisions;
      this.touch(completedAt);
      recorded++;
    }
    this.state.cursors.survival = [...seen].slice(-SURVIVAL_CURSOR_LIMIT);
    return recorded;
  }

  survivalView(agent) {
    return {
      matches: agent.survival.matches,
      wins: agent.survival.wins,
      losses: agent.survival.losses,
      ...agent.survival.metrics,
      average_placement: agent.survival.matches
        ? Math.round(agent.survival.placement_total / agent.survival.matches * 10) / 10
        : null,
      latest_placement: agent.survival.latest_final_placement,
      latest_research: agent.survival.latest_research,
    };
  }

  /** Overlays durable totals onto live profiles while preserving presence and memory. */
  applyProfiles(profiles = []) {
    return profiles.map(profile => {
      const agent = this.state.agents[profile.id];
      if (!agent) return profile;
      const matches = agent.arena.matches + agent.survival.matches;
      if (!matches) return profile;
      return {
        ...profile,
        matches,
        wins: agent.arena.wins + agent.survival.wins,
        losses: agent.arena.losses + agent.survival.losses,
        draws: agent.arena.draws,
        scope: 'cumulative all-time arena results',
        survival: agent.survival.matches ? this.survivalView(agent) : profile.survival,
      };
    });
  }

  /**
   * Returns cumulative totals when any match has been recorded, otherwise the
   * existing retained-run statistics so a fresh deployment still renders.
   */
  statistics(base, profiles = base?.agents || []) {
    if (!this.hasMatches()) return { ...base, cumulative: false };
    const identities = new Map((profiles || []).map(profile => [profile.id, profile]));
    const agents = Object.values(this.state.agents)
      .filter(agent => agent.arena.matches + agent.survival.matches > 0)
      .map(agent => {
        const identity = identities.get(agent.id) || {
          id: agent.id, name: agent.name || agent.id, sprite: agent.sprite || '', strategy: agent.strategy || 'analyst',
          recentWinner: false, roomId: null, arenaStatus: 'queued', memory: [], latestMatch: null,
        };
        const merged = this.applyProfiles([identity])[0];
        return { ...merged, win_rate: merged.matches ? Math.round(merged.wins / merged.matches * 1000) / 10 : 0 };
      })
      .sort((a, b) => b.wins - a.wins || b.matches - a.matches || String(a.name).localeCompare(String(b.name)));
    const games = structuredClone(this.state.games);
    return {
      ...base,
      scope: 'cumulative all-time arena results',
      cumulative: true,
      updated_at: this.state.updated_at,
      totals: {
        matches: games.rps.matches + games.tictactoe.matches + games.survival.matches,
        decisions: games.rps.decisions + games.tictactoe.decisions + games.survival.decisions,
        draws: games.rps.draws + games.tictactoe.draws,
      },
      games,
      agents,
    };
  }
}
