import test from 'node:test';
import assert from 'node:assert/strict';
import { copyPublicSolanaAddress, shortPublicSolanaAddress, solscanAccountUrl, validPublicSolanaAddress } from '../web/dist/world/solscan.js';

const address = '11111111111111111111111111111111';

test('Solscan account links use the configured network and a validated public address', () => {
  assert.equal(validPublicSolanaAddress(address), true);
  assert.equal(solscanAccountUrl(address, 'mainnet-beta'), `https://solscan.io/account/${address}`);
  assert.equal(solscanAccountUrl(address, 'devnet'), `https://solscan.io/account/${address}?cluster=devnet`);
  assert.equal(solscanAccountUrl(address, 'testnet'), `https://solscan.io/account/${address}?cluster=testnet`);
  assert.equal(solscanAccountUrl(address, 'not_configured'), null);
  assert.equal(solscanAccountUrl('https://attacker.example/account', 'mainnet-beta'), null);
  assert.equal(solscanAccountUrl(`${address}?x=1`, 'mainnet-beta'), null);
  assert.equal(solscanAccountUrl(null, 'mainnet-beta'), null);
});

test('profile presentation shortens addresses while copy and Solscan use the complete value', async () => {
  assert.equal(shortPublicSolanaAddress(address), '111111...11111');
  let copied = null;
  await copyPublicSolanaAddress(address, { writeText: async value => { copied = value; } });
  assert.equal(copied, address);
  assert.equal(solscanAccountUrl(address, 'mainnet-beta'), `https://solscan.io/account/${address}`);
  await assert.rejects(() => copyPublicSolanaAddress('https://invalid.example', { writeText: async () => {} }), /Invalid public/);
});
