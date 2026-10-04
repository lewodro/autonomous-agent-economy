import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

if (process.env.PUBLIC_DEVNET_ACK !== 'I_UNDERSTAND_TEST_SOL_ONLY') {
  throw new Error('Set PUBLIC_DEVNET_ACK=I_UNDERSTAND_TEST_SOL_ONLY. This command uses valueless Devnet test SOL.');
}
if (!process.env.ECONOMY_DIR || !path.isAbsolute(process.env.ECONOMY_DIR)) {
  throw new Error('Set ECONOMY_DIR to an absolute durable directory. Generated development keys are stored there.');
}
const worker = spawn(path.resolve('rust/target/debug/table-core'), ['--serve'], {
  env: process.env, stdio: ['pipe', 'pipe', 'inherit'],
});
const config = JSON.parse(await readFile(new URL('../examples/matches/mock-funded-match.json', import.meta.url)));
config.economy = { ...config.economy, mode: 'devnet', minimum_reserve_sol: '0' };
const session = process.argv[2] || randomUUID();
const response = new Promise((resolve, reject) => {
  worker.once('error', reject);
  worker.once('exit', code => { if (code) reject(new Error(`Rust worker stopped with ${code}`)); });
  readline.createInterface({ input: worker.stdout }).once('line', line => {
    try { const parsed = JSON.parse(line); parsed.ok ? resolve(parsed.result) : reject(new Error(parsed.error)); }
    catch (error) { reject(error); }
  });
});
worker.stdin.end(`${JSON.stringify({ command: 'funded-host', action: 'create', session, config })}\n`);
try {
  const result = await response;
  console.log(JSON.stringify({ session, network: 'solana-devnet', entry_lamports: result.economy.economy.entry_amount,
    wallets: result.economy.wallets.map(({ account, address, balance, explorer_url }) => ({ account, address, balance, explorer_url })),
    next: 'Fund each agent address with exactly the entry amount and fund fee-sponsor for transaction fees. Never send mainnet SOL.' }, null, 2));
} finally {
  worker.kill();
}
