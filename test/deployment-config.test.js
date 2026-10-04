import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentConfig } from '../service/deployment-config.js';

test('development keeps loopback and a local port by default', () => {
  assert.deepEqual(validateDeploymentConfig({}), {
    production: false, publicOrigin: null, publicOrigins: [], port: 3000, host: '127.0.0.1',
  });
});

test('Railway production accepts its assigned HTTPS host and mounted persistent directory', () => {
  const config = validateDeploymentConfig({
    NODE_ENV: 'production', RAILWAY_PUBLIC_DOMAIN: 'axile.up.railway.app',
    MATCHES_DIR: '/data/matches', PORT: '8080', HOST_SESSION_SECRET: 'a'.repeat(32),
  });
  assert.equal(config.publicOrigin, 'https://axile.up.railway.app');
  assert.deepEqual(config.publicOrigins, ['https://axile.up.railway.app']);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 8080);
});

test('custom domain and Railway domain are both valid public origins', () => {
  assert.deepEqual(validateDeploymentConfig({
    NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://axile.example',
    RAILWAY_PUBLIC_DOMAIN: 'axile.up.railway.app', MATCHES_DIR: '/data/matches', HOST_SESSION_SECRET: 'a'.repeat(32),
  }).publicOrigins, ['https://axile.example', 'https://axile.up.railway.app']);
});

test('production refuses missing origin, ephemeral storage, and enabled economy experiments', () => {
  const base = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://axile.example', MATCHES_DIR: '/data/matches', HOST_SESSION_SECRET: 'a'.repeat(32) };
  assert.throws(() => validateDeploymentConfig({ ...base, PUBLIC_ORIGIN: '' }), /PUBLIC_ORIGIN|Railway public domain/);
  assert.throws(() => validateDeploymentConfig({ ...base, MATCHES_DIR: './matches' }), /absolute path/);
  assert.throws(() => validateDeploymentConfig({ ...base, HOST_SESSION_SECRET: 'short' }), /HOST_SESSION_SECRET/);
  assert.throws(() => validateDeploymentConfig({ ...base, ECONOMY_LAB: '1' }), /disabled in public production/);
  assert.throws(() => validateDeploymentConfig({ ...base, MACHINE_PAYMENTS_DEMO: '1' }), /disabled in public production/);
  assert.throws(() => validateDeploymentConfig({ ...base, ENTRY_FEE_ENABLED: 'true' }), /free matches only/);
  assert.throws(() => validateDeploymentConfig({ ...base, ECONOMY_MODE: 'LOCAL' }), /free matches only/);
});

test('rejects origins with paths and invalid port settings', () => {
  const base = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://axile.example', MATCHES_DIR: '/data/matches', HOST_SESSION_SECRET: 'a'.repeat(32) };
  assert.throws(() => validateDeploymentConfig({ ...base, PUBLIC_ORIGIN: 'https://axile.example/app' }), /ORIGIN/);
  assert.throws(() => validateDeploymentConfig({ ...base, PORT: 'nope' }), /PORT/);
});
