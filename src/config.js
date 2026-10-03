import { createState, assertAccounting, record } from './economy.js';
import { SOL, toLamports } from './policy.js';
import { eligibility } from './orchestrator.js';
export function configureRun({ agents = 20, bankroll = '1', stake = '0.03', seed = 42, rounds = 1000, mode = 'bounded' } = {}) {
  const count = Number(agents), capital = toLamports(bankroll), entry = toLamports(stake);
  seed = Number(seed); rounds = Number(rounds);
  if (!capital || !entry || entry > capital || !Number.isSafeInteger(capital * count) || capital > 10000 * SOL) throw new Error('Use a positive bankroll and stake; stake cannot exceed bankroll (maximum 10,000 SOL per agent).');
  if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295 || !Number.isInteger(rounds) || rounds < 1 || rounds > 10000 || !['bounded', 'survival'].includes(mode)) throw new Error('Invalid experiment settings');
  const next = createState(count);
  next.seed = seed; next.rng = seed; next.mode = mode; next.config.stake = entry; next.config.maxRounds = rounds;
  next.externalCapital = capital * count;
  for (const a of next.agents) {
    a.balance = capital; a.capital = capital; a.peak = capital;
    a.policy.maxStake = mode === 'survival' ? capital : Math.floor(capital / 10);
    a.policy.maxExposureBps = mode === 'survival' ? 10000 : a.policy.maxExposureBps;
    a.policy.reserve = mode === 'survival' ? 0 : Math.floor(capital / 10);
    a.policy.maxLoss = mode === 'survival' ? capital : Math.floor(capital / 2);
  }
  next.events[0].data.amount = next.externalCapital;
  record(next, 'RUN_CONFIGURED', { seed, mode, bankroll: capital, stake: entry, count, maxRounds: rounds });
  if (next.agents.filter(a => eligibility(next, a).eligible).length < 2) throw new Error('Stake exceeds this mode’s limits. Lower the stake or choose survival.');
  assertAccounting(next); return next;
}
