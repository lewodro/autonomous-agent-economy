import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentConfig } from '../service/deployment-config.js';

test('development keeps loopback and a local port by default', () => {
  assert.deepEqual(validateDeploymentConfig({}), {
    production: false, publicDevnet: false, publicPredictions: false, appMode:'free', solanaNetwork:'none', trustProxy:false, mainnetAgentFundingEnabled:false, mainnetMatchWageringEnabled:false, publicOrigin: null, publicOrigins: [], port: 3000, host: '127.0.0.1',
  });
});

test('runtime modes are explicit and mainnet ownership and wagering fail closed',()=>{
  assert.equal(validateDeploymentConfig({APP_MODE:'mock'}).appMode,'mock');
  assert.equal(validateDeploymentConfig({APP_MODE:'local-validator',SOLANA_NETWORK:'localnet'}).solanaNetwork,'localnet');
  assert.equal(validateDeploymentConfig({APP_MODE:'devnet',SOLANA_NETWORK:'devnet'}).appMode,'devnet');
  assert.throws(()=>validateDeploymentConfig({APP_MODE:'devnet',SOLANA_NETWORK:'none'}),/do not match/);
  assert.throws(()=>validateDeploymentConfig({ENABLE_MAINNET_MATCH_WAGERING:'true'}),{code:'MAINNET_MATCH_WAGERING_DISABLED'});
  assert.throws(()=>validateDeploymentConfig({SOLANA_NETWORK:'mainnet-beta'}),/requires SOLANA_NETWORK/);
  assert.throws(()=>validateDeploymentConfig({SOLANA_NETWORK:'mainnet-beta',ENABLE_MAINNET_AGENT_FUNDING:'true'}),{code:'MAINNET_AGENT_FUNDING_NOT_IMPLEMENTED'});
  assert.throws(()=>validateDeploymentConfig({SOLANA_NETWORK:'mainnet-beta',ENABLE_MAINNET_AGENT_FUNDING:'false'}),/requires SOLANA_NETWORK/);
  assert.throws(()=>validateDeploymentConfig({SOLANA_NETWORK:'devnet',ENABLE_MAINNET_AGENT_FUNDING:'true'}),/requires SOLANA_NETWORK/);
  assert.throws(()=>validateDeploymentConfig({APP_MODE:'mainnet-ownership'}),{code:'MAINNET_AGENT_FUNDING_NOT_IMPLEMENTED'});
  assert.equal(validateDeploymentConfig({TRUST_PROXY:'true'}).trustProxy,true);
  assert.throws(()=>validateDeploymentConfig({TRUST_PROXY:'1'}),/TRUST_PROXY must be true or false/);
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
  assert.equal(config.publicDevnet, false);
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
  assert.throws(() => validateDeploymentConfig({ ...base, ENTRY_FEE_ENABLED: 'true' }), /DEVNET/);
  assert.throws(() => validateDeploymentConfig({ ...base, ECONOMY_MODE: 'LOCAL' }), /SIMULATED or DEVNET/);
});

test('production devnet needs an explicit test-SOL acknowledgement and dedicated HTTPS RPC', () => {
  const base = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://axile.example', MATCHES_DIR: '/data/matches',
    HOST_SESSION_SECRET: 'a'.repeat(32), ENTRY_FEE_ENABLED: 'true', ECONOMY_MODE: 'DEVNET' };
  assert.throws(() => validateDeploymentConfig(base), /test SOL/);
  assert.throws(() => validateDeploymentConfig({ ...base, PUBLIC_DEVNET_ACK: 'I_UNDERSTAND_TEST_SOL_ONLY' }), /dedicated HTTPS/);
  const config = validateDeploymentConfig({ ...base, PUBLIC_DEVNET_ACK: 'I_UNDERSTAND_TEST_SOL_ONLY', SOLANA_DEVNET_RPC_URL: 'https://devnet.example/rpc' });
  assert.equal(config.publicDevnet, true);
  assert.throws(() => validateDeploymentConfig({ ...base, PUBLIC_DEVNET_ACK: 'I_UNDERSTAND_TEST_SOL_ONLY', SOLANA_DEVNET_RPC_URL: 'https://devnet.example/rpc', PREDICTIONS_ENABLED: 'true' }), /prediction routes and payment integration are not implemented/);
  assert.throws(() => validateDeploymentConfig({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://axile.example', MATCHES_DIR: '/data/matches', HOST_SESSION_SECRET: 'a'.repeat(32), PREDICTIONS_ENABLED: 'true' }), /predictions require explicit production DEVNET/);
});

test('rejects origins with paths and invalid port settings', () => {
  const base = { NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://axile.example', MATCHES_DIR: '/data/matches', HOST_SESSION_SECRET: 'a'.repeat(32) };
  assert.throws(() => validateDeploymentConfig({ ...base, PUBLIC_ORIGIN: 'https://axile.example/app' }), /ORIGIN/);
  assert.throws(() => validateDeploymentConfig({ ...base, PORT: 'nope' }), /PORT/);
});
