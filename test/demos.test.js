import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, verify } from 'node:crypto';
import { encode58, decode58, ephemeralSigner, transferMessage, signedTransaction } from '../demos/solana-codec.js';
import { spawnSync } from 'node:child_process';
test('base58 preserves leading zeroes and round-trips 32-byte account keys', () => {
  for (const bytes of [Buffer.alloc(32), Buffer.concat([Buffer.alloc(4), randomBytes(28)]), randomBytes(32)]) assert.deepEqual(decode58(encode58(bytes)), bytes);
  assert.equal(encode58(Buffer.alloc(32)), '11111111111111111111111111111111');
  assert.throws(() => decode58('0invalid'));
});
test('Solana wire demo signs the message and rejects tampering or excessive transfers', () => {
  const payer = ephemeralSigner(), recipient = ephemeralSigner();
  const hash = encode58(randomBytes(32));
  const message = transferMessage(payer.address, recipient.address, hash, 1_000_000);
  const tx = signedTransaction(payer, message);
  assert.equal(tx.length, 215);
  assert.deepEqual([...message.subarray(0, 4)], [1, 0, 1, 3]);
  assert.ok(verify(null, message, payer.publicKey, tx.subarray(1, 65)));
  const changed = Buffer.from(message); changed[changed.length - 1] ^= 1;
  assert.equal(verify(null, changed, payer.publicKey, tx.subarray(1, 65)), false);
  assert.throws(() => transferMessage(payer.address, recipient.address, hash, 1_000_001));
  assert.throws(() => transferMessage(payer.address, recipient.address, hash, -1));
  assert.throws(() => transferMessage('bad-address', recipient.address, hash, 1));
  assert.equal(payer.privateKey, undefined);
});
test('CLI runs a complete survival experiment with a reproducible result digest', () => {
  const args = ['scripts/simulate.js', '--agents', '2', '--mode', 'survival', '--bankroll', '0.09', '--stake', '0.03', '--seed', '9', '--rounds', '300'];
  const runs = [spawnSync(process.execPath, args, { encoding: 'utf8' }), spawnSync(process.execPath, args, { encoding: 'utf8' })];
  for (const run of runs) { assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /1 eligible/); }
  assert.equal(runs[0].stdout.match(/[a-f0-9]{64}/)[0], runs[1].stdout.match(/[a-f0-9]{64}/)[0]);
});
