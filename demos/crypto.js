import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { configureRun } from '../src/config.js';
import { Orchestrator } from '../src/orchestrator.js';
import { verifyProof } from '../src/rps.js';
const state = configureRun({ agents: 2 });
const match = await new Orchestrator(state).step();
assert.equal(await verifyProof(match), true);
const receipt = Buffer.from(JSON.stringify({ domain: 'agent-arena-local-receipt-v1', match }));
const hash = createHash('sha256').update(receipt).digest('hex');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signature = sign(null, receipt, privateKey);
assert.ok(verify(null, receipt, publicKey, signature));
assert.equal(verify(null, Buffer.from('tampered receipt'), publicKey, signature), false);
console.log(JSON.stringify({ matchId: match.id, commitments: match.commitments, reveals: match.reveals, result: match.result,
  receiptSHA256: hash, signature: signature.toString('base64'), publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  verified: true, note: 'Ephemeral signing key exists only in process memory. A signature proves who signed these bytes, not real funds or an independent match.' }, null, 2));
