import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRequest } from '../service/http-policy.js';

test('matching hostile Host and Origin headers cannot authorize a local request', () => {
  assert.equal(authorizeRequest({ headers: { host: 'attacker.example:3000', origin: 'http://attacker.example:3000' } }, 3000, '').status, 421);
  for (const host of ['127.0.0.1:3000.attacker.example', 'localhost:3001', 'localhost', undefined]) {
    assert.equal(authorizeRequest({ headers: { host } }, 3000, '').status, 421);
  }
});

test('loopback hosts are allowed on the actual listener port and external origins are rejected', () => {
  for (const host of ['127.0.0.1:45678', 'localhost:45678']) {
    assert.equal(authorizeRequest({ headers: { host } }, 45678, ''), null);
    assert.equal(authorizeRequest({ headers: { host, origin: `http://${host}` } }, 45678, ''), null);
    assert.equal(authorizeRequest({ headers: { host, origin: 'https://attacker.example' } }, 45678, '').status, 403);
    assert.equal(authorizeRequest({ headers: { host, origin: 'null' } }, 45678, '').status, 403);
  }
});

test('a public origin can only be authorized by explicit server configuration', () => {
  const request = { headers: { host: 'table.example', origin: 'https://table.example' } };
  assert.equal(authorizeRequest(request, 3000, 'https://table.example'), null);
  assert.equal(authorizeRequest(request, 3000, '').status, 421);
  assert.throws(() => authorizeRequest(request, 3000, 'https://table.example/path'), /HTTP origin/);
});
