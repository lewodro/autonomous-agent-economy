import { readFile, writeFile } from 'node:fs/promises';
import { configureRun } from '../src/config.js';
import { Orchestrator, eligibility } from '../src/orchestrator.js';
import { assertAccounting } from '../src/economy.js';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2), options = {};
if (args.includes('--help')) {
  console.log('node scripts/simulate.js [--agents 2|20] [--mode bounded|survival] [--seed 42] [--bankroll 1] [--stake 0.03] [--rounds 1000] [--config demos/run.json] [--out run.json]'); process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  if (!/^--(agents|mode|seed|bankroll|stake|rounds|config|out)$/.test(args[i]) || args[i + 1] === undefined) throw new Error('Invalid option. Use --help.');
  options[args[i].slice(2)] = args[i + 1];
}
const preset = options.config ? JSON.parse(await readFile(options.config, 'utf8')) : {};
const state = configureRun({ ...preset, ...options });
const runner = new Orchestrator(state);
while (state.matches.length < state.config.maxRounds && state.agents.filter(a => eligibility(state, a).eligible).length >= 2) await runner.step();
assertAccounting(state);
const remaining = state.agents.filter(a => eligibility(state, a).eligible);
const experiment = { seed: state.seed, mode: state.mode, config: state.config,
  results: state.matches.map(m => ({ players: m.players, result: m.result, stake: m.stake, moves: m.players.map(id => m.reveals[id].move) })) };
const digest = createHash('sha256').update(JSON.stringify(experiment)).digest('hex');
console.log(`${state.agents.length} agents / ${state.matches.length} matches / ${remaining.length} eligible / seed ${state.seed}`);
console.log(remaining.length < 2 ? 'Stopped: fewer than two eligible agents remain.' : 'Stopped: configured match limit reached.');
console.table([...state.agents].sort((a, b) => b.pnl - a.pnl).map(a => ({ agent: a.name, bankrollSOL: a.balance / 1e9, pnlSOL: a.pnl / 1e9, roiPct: +(100 * a.pnl / a.capital).toFixed(2), wins: a.wins, losses: a.losses, draws: a.draws, drawdownSOL: a.drawdown / 1e9, state: eligibility(state, a).eligible ? 'READY' : 'OUT' })));
console.log(`Experiment SHA-256 (results, not random nonces): ${digest}`);
if (options.out) { await writeFile(options.out, JSON.stringify(state, null, 2)); console.log(`Audit saved: ${options.out}`); }
