import { createState, enterMatch, commitMove, revealMove, settleMatch, record, assertAccounting, opportunity } from './economy.js';
import { configureRun } from './config.js';
import { receiveRevenue, allocateTreasury } from './treasury.js';
import { startTournament, nextTournamentPair, scoreTournament } from './tournament.js';

export const STORAGE_KEY = 'agent-arena-v1';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function validateState(input) {
  if (!input || input.version !== 1 || ![2, 20].includes(input.agents?.length) || !Array.isArray(input.matches)
      || !Array.isArray(input.events) || input.matches.length > 10000 || input.events.length > 150000
      || !Number.isInteger(input.rng) || input.rng < 1 || input.rng > 4294967295) throw new Error('Unsupported or malformed saved run');
  if (input.matches.some(m => m.status !== 'settled')) throw new Error('Saved run contains an incomplete settlement');
  let rebuilt;
  const configured = input.events[1];
  if (configured?.type === 'RUN_CONFIGURED') {
    const data = configured.data;
    rebuilt = configureRun({ agents: data.count, bankroll: (data.bankroll / 1e9).toFixed(9), stake: (data.stake / 1e9).toFixed(9), seed: data.seed, mode: data.mode, rounds: data.maxRounds });
  } else rebuilt = createState(input.agents.length);
  // Replay the append-only ledger through the same deterministic authorization engine.
  while (rebuilt.events.length < input.events.length) {
    const previousLength = rebuilt.events.length;
    const event = input.events[rebuilt.events.length], data = event.data;
    const match = () => rebuilt.matches.find(m => m.id === data.matchId);
    switch (event.type) {
      case 'GAME_AVAILABLE':
        if (!same(data, opportunity(rebuilt, data.participants))) throw new Error('Opportunity mismatch');
        record(rebuilt, event.type, data); break;
      case 'PAYMENT_CONFIRMED': enterMatch(rebuilt, data.players, data.stake); break;
      case 'MOVE_COMMITTED': commitMove(rebuilt, match(), data.agentId, data.hash); break;
      case 'MOVE_REVEALED': await revealMove(rebuilt, match(), data.agentId, data.move, data.nonce); break;
      case 'GAME_FINISHED': settleMatch(rebuilt, match()); break;
      case 'EMERGENCY_PAUSE':
        if (typeof data.paused !== 'boolean') throw new Error('Invalid pause event');
        rebuilt.paused = data.paused; record(rebuilt, event.type, data); break;
      case 'TREASURY_UPDATED': receiveRevenue(rebuilt, data.receiptId, data.revenue); break;
      case 'TREASURY_ALLOCATED': allocateTreasury(rebuilt, data.allocationId); break;
      case 'TOURNAMENT_OPENED': startTournament(rebuilt); break;
      case 'TOURNAMENT_PAIR_SELECTED': nextTournamentPair(rebuilt); break;
      case 'TOURNAMENT_FINISHED': nextTournamentPair(rebuilt); break;
      case 'TOURNAMENT_SCORED': scoreTournament(rebuilt, match()); break;
      default: throw new Error(`Unexpected ledger event: ${event.type}`);
    }
    if (rebuilt.events.length === previousLength) throw new Error('Duplicate or invalid ledger event');
  }
  const stripTime = events => events.map(({ time, ...event }) => event);
  if (!same(stripTime(rebuilt.events), stripTime(input.events))) throw new Error('Ledger event ordering or values do not reconcile');
  for (const key of ['agents', 'matches', 'config', 'seed', 'mode', 'paused', 'treasury', 'externalCapital', 'nextMatch', 'tournament']) {
    if (!same(rebuilt[key], input[key])) throw new Error(`Saved ${key} does not match the verified ledger`);
  }
  rebuilt.rng = input.rng;
  rebuilt.events = structuredClone(input.events);
  assertAccounting(rebuilt);
  return rebuilt;
}
export function saveState(state, storage = localStorage) {
  if (state.matches.some(m => m.status !== 'settled')) throw new Error('Only completed settlements can be saved');
  assertAccounting(state);
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
export async function loadState(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  if (raw.length > 30_000_000) throw new Error('Saved run exceeds the supported size');
  return validateState(JSON.parse(raw));
}
