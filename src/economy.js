import { SOL, amount, authorize } from './policy.js';
import { resolve, commitment } from './rps.js';

export const PROFILES = [
  ['founder', 'Founder', 'Balanced pioneer'], ['trader', 'Trader', 'Pattern trader'],
  ['gambler', 'Gambler', 'High variance'], ['analyst', 'Analyst', 'Statistical analyst'],
  ['defender', 'Defender', 'Reserve guardian'], ['strategist', 'Strategist', 'Opponent modeler'],
  ['social', 'Social', 'Social challenger'], ['degen', 'Degen', 'Bold explorer'],
  ['conservative', 'Conservative', 'Bankroll manager'], ['aggressive', 'Aggressive', 'Active competitor'],
  ['explorer', 'Explorer', 'Curious explorer'], ['builder', 'Builder', 'Patient builder'],
  ['quant', 'Quant', 'Probability modeler'], ['random', 'Random', 'Randomized baseline'],
  ['tournament', 'Tournament', 'Tournament specialist'], ['mentor', 'Mentor', 'Measured mentor'],
  ['rival', 'Rival', 'Rivalry tracker'], ['observer', 'Observer', 'Careful observer'],
  ['adaptive', 'Adaptive', 'Adaptive learner'], ['wild-card', 'Wild Card', 'Unpredictable explorer']
];
export function record(state, type, data) {
  state.events.push({ seq: state.events.length + 1, type, time: new Date().toISOString(), data: structuredClone(data) });
}
export function createState(count = 20) {
  if (![2, 20].includes(count)) throw new Error('Choose 2 or 20 agents');
  const state = { version: 1, paused: false, config: { stake: 30_000_000, networkFee: 0, protocolFee: 0 },
    treasury: 0, externalCapital: count * SOL, agents: [], matches: [], events: [], nextMatch: 1 };
  state.agents = PROFILES.slice(0, count).map(([slug, name, strategy], index) => ({
    id: `agent-${index + 1}`, name, strategy, address: `simulation:agent-${index + 1}`,
    sprite: `assets/sprites-agent/${String(index + 1).padStart(2, '0')}-${slug}.png`,
    balance: SOL, capital: SOL, pnl: 0, peak: SOL, drawdown: 0, wins: 0, losses: 0, draws: 0,
    staked: 0, opponents: {}, memory: [],
    prior: [1 + index % 3, 1 + (index + 1) % 3, 1 + (index + 2) % 3],
    exploration: index === 13 ? 1 : 0.15 + (index % 5) * 0.1,
    policy: { maxStake: 100_000_000, maxExposureBps: [1000, 1500, 2000][index % 3], reserve: 100_000_000, maxLoss: 500_000_000 }
  }));
  record(state, 'FUNDS_RECEIVED', { source: 'simulation-genesis', amount: state.externalCapital, agents: count });
  return state;
}
export function opportunity(state, players) {
  return { id: `game-${state.nextMatch}`, type: 'rps', provider: 'simulation:rps', participants: players,
    stake: state.config.stake, rules: 'rps-v1', responseSchema: 'ENTER_GAME', settlement: 'two-verified-reveals', capabilities: ['commit-reveal'] };
}
export function enterMatch(state, players, stake = state.config.stake) {
  if (!Array.isArray(players) || players.length !== 2 || players[0] === players[1]) throw new Error('Two different agents are required');
  const agents = players.map(agentId => authorize(state, { type: 'ENTER_GAME', agentId, stake, destination: 'simulation:rps' }));
  const match = { id: `game-${state.nextMatch++}`, players: [...players], stake, escrow: stake * 2,
    status: 'committing', commitments: {}, reveals: {}, result: null, payouts: {}, networkFee: 0, protocolFee: 0 };
  amount(match.escrow);
  agents.forEach(agent => { agent.balance -= stake; });
  state.matches.push(match);
  record(state, 'PAYMENT_CONFIRMED', { matchId: match.id, players, stake, escrow: match.escrow });
  return match;
}
export function commitMove(state, match, agentId, hash) {
  if (!state.matches.includes(match) || match.status !== 'committing' || !match.players.includes(agentId) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid commitment');
  if (match.commitments[agentId]) {
    if (match.commitments[agentId] === hash) return;
    throw new Error('Commitment already locked');
  }
  match.commitments[agentId] = hash;
  record(state, 'MOVE_COMMITTED', { matchId: match.id, agentId, hash });
  if (match.players.every(id => match.commitments[id])) match.status = 'revealing';
}
export async function revealMove(state, match, agentId, move, salt) {
  if (!state.matches.includes(match) || match.status !== 'revealing' || !match.players.includes(agentId)) throw new Error('Both commitments are required before reveal');
  const hash = await commitment(match.id, agentId, move, salt);
  if (hash !== match.commitments[agentId]) throw new Error('Reveal does not match commitment');
  if (match.status !== 'revealing') throw new Error('Match changed during reveal');
  if (match.reveals[agentId]) return;
  match.reveals[agentId] = { move, nonce: salt };
  record(state, 'MOVE_REVEALED', { matchId: match.id, agentId, move, nonce: salt });
}
export function settleMatch(state, match) {
  if (!state.matches.includes(match)) throw new Error('Unknown match');
  if (match.status === 'settled') return match;
  if (match.status !== 'revealing' || !match.players.every(id => match.reveals[id])) throw new Error('Two verified reveals required');
  const [a, b] = match.players.map(id => state.agents.find(agent => agent.id === id));
  const result = resolve(match.reveals[a.id].move, match.reveals[b.id].move);
  match.result = result;
  match.payouts = { [a.id]: result === 'draw' ? match.stake : result === 'a' ? match.escrow : 0,
    [b.id]: result === 'draw' ? match.stake : result === 'b' ? match.escrow : 0 };
  for (const [agent, opponent] of [[a, b], [b, a]]) {
    const payout = match.payouts[agent.id];
    const delta = payout - match.stake;
    agent.balance += payout;
    agent.pnl += delta;
    agent.staked += match.stake;
    agent.peak = Math.max(agent.peak, agent.capital + agent.pnl);
    agent.drawdown = Math.max(agent.drawdown, agent.peak - (agent.capital + agent.pnl));
    const outcome = result === 'draw' ? 'draws' : delta > 0 ? 'wins' : 'losses';
    agent[outcome]++;
    const memory = agent.opponents[opponent.id] ||= { rock: 0, paper: 0, scissors: 0, wins: 0, losses: 0, draws: 0 };
    memory[match.reveals[opponent.id].move]++;
    memory[outcome]++;
    agent.memory.push({ matchId: match.id, opponent: opponent.id, move: match.reveals[agent.id].move, observed: match.reveals[opponent.id].move, delta });
  }
  match.escrow = 0;
  match.status = 'settled';
  record(state, 'GAME_FINISHED', { matchId: match.id, result });
  record(state, 'PAYOUT_RECEIVED', { matchId: match.id, payouts: match.payouts });
  record(state, 'AGENTS_LEARNED', { matchId: match.id, agents: match.players });
  assertAccounting(state);
  return match;
}
export function assertAccounting(state) {
  const total = state.agents.reduce((sum, a) => sum + amount(a.balance), 0) + amount(state.treasury)
    + state.matches.reduce((sum, m) => sum + amount(m.escrow), 0);
  if (total !== amount(state.externalCapital)) throw new Error('Capital conservation failed');
  for (const agent of state.agents) {
    const locked = state.matches.filter(m => m.status !== 'settled' && m.players.includes(agent.id)).reduce((sum, m) => sum + m.stake, 0);
    if (agent.balance + locked !== agent.capital + agent.pnl) throw new Error('Agent ledger mismatch');
  }
  return true;
}
