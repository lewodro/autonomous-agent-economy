import type { Replay, State, GameEvent } from './types.js';
export function checkpoint(run: Replay, turn: number): { state: State; cursor: number } {
  let state = structuredClone(run.starting_state), cursor = 1;
  for (const event of run.events) {
    if (event.turn > turn) break;
    if (event.type === 'RoundEnded' && event.state) { state = structuredClone(event.state); cursor = event.seq + 1; }
  }
  return { state, cursor };
}
// Presentation projection only: the authoritative Rust core supplies every resulting value.
export function applyEvent(state: State, event: GameEvent): State {
  if (event.type === 'RoundEnded' && event.state) return structuredClone(event.state);
  state.turn = event.turn;
  const actor = state.agents.find(a => a.id === event.actor);
  if (event.type === 'RoundStarted') { state.agents.forEach(a => a.guarded = false); state.alliances = state.alliances.filter(p => p.every(id => state.agents.find(a => a.id === id)?.alive)); }
  if (event.type === 'AgentActionSelected' && actor && event.decision) actor.last_action = event.decision.action;
  if (event.type === 'GuardRaised' && actor) actor.guarded = true;
  if (event.type === 'ResourceChanged' && actor && event.after !== null) actor.credits = event.after;
  if (event.type === 'AgentEliminated' && actor) { actor.alive = false; actor.guarded = false; actor.stats.eliminated_turn = event.turn; }
  if (event.type === 'AllianceCreated' && event.actor && event.target) { const pair = [event.actor,event.target].sort() as [string,string]; if (!state.alliances.some(p => p[0] === pair[0] && p[1] === pair[1])) state.alliances.push(pair); }
  if (event.type === 'AllianceBroken') state.alliances = state.alliances.filter(p => !p.includes(event.actor || '') || !p.includes(event.target || ''));
  if (event.type === 'MatchEnded') { state.ended = true; state.winner = event.actor; state.end_reason = event.reason; }
  return state;
}
export function moments(run: Replay): GameEvent[] {
  return run.events.filter(e => e.type === 'AgentEliminated' || e.type === 'AllianceCreated' || e.type === 'AllianceBroken' || e.type === 'MatchEnded');
}
