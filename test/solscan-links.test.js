import test from 'node:test';
import assert from 'node:assert/strict';
import { solscanAccountUrl, validPublicSolanaAddress } from '../web/dist/world/solscan.js';

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
