import path from 'node:path';
import {validateProviderTransport} from './provider-transport.js';
import {validSolanaAddress} from './world-economy.js';

function validateDevnetRpc(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Public Devnet requires a valid dedicated HTTPS SOLANA_DEVNET_RPC_URL.'); }
  if (value.length > 512 || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error('Public Devnet requires a dedicated HTTPS SOLANA_DEVNET_RPC_URL without credentials or fragments.');
  }
  if (`${parsed.hostname}${parsed.pathname}`.toLowerCase().includes('mainnet')) {
    throw new Error('SOLANA_DEVNET_RPC_URL must not identify a mainnet endpoint.');
  }
  return parsed;
}

function validatePayoutUrl(value,name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error(`${name} must be HTTPS without embedded credentials or fragments.`);
  return parsed.href;
}
function positiveInteger(env,name){const value=Number(env[name]);if(!Number.isSafeInteger(value)||value<1)throw new Error(`${name} must be a positive safe integer.`);return value;}

export function validateDeploymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535 (or 0 in tests).');

  let publicOrigin = null;
  const configuredOrigin = env.PUBLIC_ORIGIN;
  if (configuredOrigin) {
    let parsed;
    try { parsed = new URL(configuredOrigin); } catch { throw new Error('PUBLIC_ORIGIN must be a valid origin URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== configuredOrigin || parsed.username || parsed.password) {
      throw new Error('PUBLIC_ORIGIN must contain only a scheme and host, without credentials or a path.');
    }
    publicOrigin = parsed.origin;
  }

  const publicDevnet = production && env.ENTRY_FEE_ENABLED === 'true' && env.ECONOMY_MODE === 'DEVNET';
  if(env.WORLD_SOL_PAYOUTS_ENABLED!==undefined&&!['0','1'].includes(env.WORLD_SOL_PAYOUTS_ENABLED))throw new Error('WORLD_SOL_PAYOUTS_ENABLED must be 0 or 1.');
  const worldPayoutsEnabled=env.WORLD_SOL_PAYOUTS_ENABLED==='1';
  if(env.ENABLE_PUBLIC_MODEL_INFERENCE!==undefined&&!['true','false'].includes(env.ENABLE_PUBLIC_MODEL_INFERENCE))throw new Error('ENABLE_PUBLIC_MODEL_INFERENCE must be true or false.');
  if(production&&env.ENABLE_PUBLIC_MODEL_INFERENCE==='true'){
    validateProviderTransport(env.MODEL_BASE_URL||'https://api.openai.com/v1',{production:true});
    if(env.AGENT_HTTP_ENDPOINT)validateProviderTransport(env.AGENT_HTTP_ENDPOINT,{production:true});
  }
  const publicPredictions = env.PREDICTIONS_ENABLED === 'true';
  if (publicPredictions && !publicDevnet) throw new Error('Public predictions require explicit production DEVNET test SOL mode.');
  if (publicPredictions) throw new Error('Public prediction routes and payment integration are not implemented; leave PREDICTIONS_ENABLED disabled.');
  if (production) {
    if (!publicOrigin || !publicOrigin.startsWith('https://')) throw new Error('Set PUBLIC_ORIGIN to the canonical HTTPS origin before production startup.');
    if (!env.MATCHES_DIR || !path.isAbsolute(env.MATCHES_DIR)) throw new Error('Set MATCHES_DIR to an absolute path on persistent mounted storage.');
    if (!env.HOST_SESSION_SECRET || env.HOST_SESSION_SECRET.length < 32) throw new Error('Set HOST_SESSION_SECRET to at least 32 random characters and keep it stable across redeploys.');
    if (env.ECONOMY_LAB === '1' || env.MACHINE_PAYMENTS_DEMO === '1') throw new Error('Economy labs and machine payment demos are disabled in public production.');
    if (env.ENTRY_FEE_ENABLED === 'true' && !publicDevnet) throw new Error('Paid entry production supports explicit DEVNET test SOL mode only.');
    if (env.ECONOMY_MODE && !['SIMULATED', 'DEVNET'].includes(env.ECONOMY_MODE)) throw new Error('Production economy mode must be SIMULATED or DEVNET.');
    if (publicDevnet) {
      if (env.PUBLIC_DEVNET_ACK !== 'I_UNDERSTAND_TEST_SOL_ONLY') throw new Error('Acknowledge that public Devnet uses valueless test SOL.');
      validateDevnetRpc(env.SOLANA_DEVNET_RPC_URL || '');
    }
    if(worldPayoutsEnabled){
      if(env.DEPLOYMENT_MODE==='EPHEMERAL_DEMO')throw new Error('Real SOL payouts require durable storage, not EPHEMERAL_DEMO.');
      if(!validSolanaAddress(env.WORLD_TREASURY_ADDRESS))throw new Error('WORLD_TREASURY_ADDRESS must be a valid public Solana address.');
      const cluster=env.WORLD_SOL_PAYOUT_CLUSTER;
      if(!['devnet','mainnet-beta'].includes(cluster))throw new Error('WORLD_SOL_PAYOUT_CLUSTER must be devnet or mainnet-beta.');
      const acknowledgement=cluster==='mainnet-beta'?'I_UNDERSTAND_REAL_SOL':'I_UNDERSTAND_TEST_SOL_ONLY';
      if(env.WORLD_SOL_PAYOUT_ACK!==acknowledgement)throw new Error(`WORLD_SOL_PAYOUT_ACK must be ${acknowledgement}.`);
      validatePayoutUrl(env.WORLD_PAYOUT_EXECUTOR_URL,'WORLD_PAYOUT_EXECUTOR_URL');
      validatePayoutUrl(env.WORLD_SOLANA_RPC_URL,'WORLD_SOLANA_RPC_URL');
      if(!env.WORLD_PAYOUT_EXECUTOR_TOKEN||env.WORLD_PAYOUT_EXECUTOR_TOKEN.length<32)throw new Error('WORLD_PAYOUT_EXECUTOR_TOKEN must contain at least 32 characters.');
      if(!env.WORLD_SOLANA_GENESIS_HASH||env.WORLD_SOLANA_GENESIS_HASH.length<20)throw new Error('WORLD_SOLANA_GENESIS_HASH is required to pin the configured cluster.');
      for(const name of ['WORLD_LAMPORTS_PER_CREDIT','WORLD_MAX_PAYOUT_LAMPORTS','WORLD_DAILY_PAYOUT_CAP_LAMPORTS','WORLD_MAX_PAYOUT_ATTEMPTS'])positiveInteger(env,name);
    }
  }

  const publicOrigins = publicOrigin ? [publicOrigin] : [];
  return { production, publicDevnet, worldPayoutsEnabled, publicPredictions, publicModelInferenceEnabled:env.ENABLE_PUBLIC_MODEL_INFERENCE==='true', publicOrigin, publicOrigins, port, host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1') };
}
