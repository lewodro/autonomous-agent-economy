import { randomBytes, verify } from 'node:crypto';
import { ephemeralSigner, transferMessage, signedTransaction, encode58 } from './solana-codec.js';
const flags = process.argv.slice(2);
if (flags.some(flag => !['--devnet', '--airdrop'].includes(flag))) throw new Error('Usage: node demos/solana.js [--devnet] [--airdrop]');
if (flags.includes('--airdrop') && !flags.includes('--devnet')) throw new Error('--airdrop requires --devnet');
const payer = ephemeralSigner(), recipient = ephemeralSigner();
const rpc = async (method, params = []) => {
  const response = await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Devnet RPC HTTP ${response.status}`);
  const data = await response.json(); if (data.error) throw new Error(`Devnet ${method}: ${data.error.message}`); return data.result;
};
let blockhash = encode58(randomBytes(32));
if (flags.includes('--devnet')) {
  const genesis = await rpc('getGenesisHash');
  if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Unexpected genesis hash; refusing to use this cluster');
  console.log(`Connected to Solana devnet: ${genesis}`);
  if (flags.includes('--airdrop')) {
    const signature = await rpc('requestAirdrop', [payer.address, 1_000_000_000, { commitment: 'confirmed' }]);
    console.log(`Devnet faucet request: ${signature}`);
    let confirmed = false;
    for (let i = 0; i < 20; i++) {
      const status = (await rpc('getSignatureStatuses', [[signature]])).value[0];
      if (status?.err) throw new Error(`Faucet transaction failed: ${JSON.stringify(status.err)}`);
      if (['confirmed', 'finalized'].includes(status?.confirmationStatus)) { confirmed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!confirmed) throw new Error('Faucet confirmation timed out');
  }
  blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
  const balance = (await rpc('getBalance', [payer.address, { commitment: 'confirmed' }])).value;
  console.log(`Ephemeral payer ${payer.address} / confirmed balance ${balance} lamports`);
}
const message = transferMessage(payer.address, recipient.address, blockhash, 1_000_000);
const transaction = signedTransaction(payer, message);
if (!verify(null, message, payer.publicKey, transaction.subarray(1, 65))) throw new Error('Local signature verification failed');
console.log(JSON.stringify({ mode: flags.includes('--devnet') ? 'devnet-simulation' : 'offline-wire-demo', payer: payer.address, recipient: recipient.address, transferLamports: 1_000_000, signatureVerified: true, transactionBytes: transaction.length, broadcast: false }, null, 2));
if (flags.includes('--devnet')) {
  const fee = (await rpc('getFeeForMessage', [message.toString('base64'), { commitment: 'confirmed' }])).value;
  const simulated = (await rpc('simulateTransaction', [transaction.toString('base64'), { encoding: 'base64', commitment: 'confirmed', sigVerify: true }])).value;
  console.log(JSON.stringify({ networkFeeLamports: fee, simulationError: simulated.err, logs: simulated.logs,
    note: flags.includes('--airdrop') ? 'Simulation only. No transfer broadcast. Faucet funds belong to an ephemeral devnet key.' : 'An unfunded ephemeral payer is expected to fail simulation. Add --airdrop to request devnet test funds.' }, null, 2));
  if (flags.includes('--airdrop') && simulated.err) throw new Error('Funded devnet simulation failed');
}
