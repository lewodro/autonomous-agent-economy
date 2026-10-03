import { record } from './economy.js';
import { eligibility } from './orchestrator.js';
export function startTournament(state) {
  if (state.paused) throw new Error('Economy is paused');
  if (state.tournament?.status === 'open') throw new Error('A tournament is already open');
  const players = state.agents.filter(a => eligibility(state, a).eligible).slice(0, 4).map(a => a.id);
  if (players.length < 2) throw new Error('At least two eligible agents are required');
  const schedule = [];
  for (let a = 0; a < players.length; a++) for (let b = a + 1; b < players.length; b++) schedule.push([players[a], players[b]]);
  const tournament = { id: `tournament-${state.events.length + 1}`, status: 'open', players, schedule, cursor: 0,
    points: Object.fromEntries(players.map(id => [id, 0])), matchIds: [], skipped: 0 };
  state.tournament = tournament;
  record(state, 'TOURNAMENT_OPENED', { tournament });
  return tournament;
}
export function nextTournamentPair(state) {
  const t = state.tournament;
  if (!t || t.status !== 'open') return null;
  if (state.paused) throw new Error('Economy is paused');
  while (t.cursor < t.schedule.length) {
    const pair = t.schedule[t.cursor++];
    const eligible = pair.every(id => eligibility(state, state.agents.find(a => a.id === id)).eligible);
    record(state, 'TOURNAMENT_PAIR_SELECTED', { tournamentId: t.id, pair, eligible });
    if (eligible) return pair;
    t.skipped++;
  }
  t.status = 'finished';
  record(state, 'TOURNAMENT_FINISHED', { tournamentId: t.id, points: t.points, skipped: t.skipped });
  return null;
}
export function scoreTournament(state, match) {
  const t = state.tournament;
  if (!t || t.status !== 'open' || match.status !== 'settled' || t.matchIds.includes(match.id)) return;
  if (JSON.stringify(t.schedule[t.cursor - 1]) !== JSON.stringify(match.players)) throw new Error('Match does not match the tournament schedule');
  t.matchIds.push(match.id);
  if (match.result === 'draw') match.players.forEach(id => t.points[id]++);
  else t.points[match.players[match.result === 'a' ? 0 : 1]] += 3;
  record(state, 'TOURNAMENT_SCORED', { tournamentId: t.id, matchId: match.id, points: t.points });
}
