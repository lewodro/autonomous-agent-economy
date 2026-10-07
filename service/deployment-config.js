import path from 'node:path';
import {validateProviderTransport} from './provider-transport.js';

export function validateDeploymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if(env.TRUST_PROXY!==undefined&&!['true','false'].includes(env.TRUST_PROXY))throw new Error('TRUST_PROXY must be true or false.');
  const trustProxy=env.TRUST_PROXY==='true';
  const rawPort = env.PORT ?? '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535 (or 0 in tests).');

  let publicOrigin = null;
  const configuredOrigin = env.PUBLIC_ORIGIN || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  if (configuredOrigin) {
    let parsed;
    try { parsed = new URL(configuredOrigin); } catch { throw new Error('PUBLIC_ORIGIN must be a valid origin URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== configuredOrigin || parsed.username || parsed.password) {
      throw new Error('PUBLIC_ORIGIN must contain only a scheme and host, without credentials or a path.');
    }
    publicOrigin = parsed.origin;
  }

  const wagering = env.ENABLE_MAINNET_MATCH_WAGERING;
  if (wagering !== undefined && !['true','false'].includes(wagering)) throw new Error('ENABLE_MAINNET_MATCH_WAGERING must be true or false.');
  if (wagering === 'true') throw Object.assign(new Error('MAINNET_MATCH_WAGERING_DISABLED: wagering is not implemented and remains disabled.'),{code:'MAINNET_MATCH_WAGERING_DISABLED'});
  const mainnetFunding = env.ENABLE_MAINNET_AGENT_FUNDING;
  if (mainnetFunding !== undefined && !['true','false'].includes(mainnetFunding)) throw new Error('ENABLE_MAINNET_AGENT_FUNDING must be true or false.');
  const publicModelInference=env.ENABLE_PUBLIC_MODEL_INFERENCE;
  if(publicModelInference!==undefined&&!['true','false'].includes(publicModelInference))throw new Error('ENABLE_PUBLIC_MODEL_INFERENCE must be true or false.');
  if(production&&publicModelInference==='true'){
    validateProviderTransport(env.MODEL_BASE_URL||'https://api.openai.com/v1',{production:true});
    if(env.AGENT_HTTP_ENDPOINT)validateProviderTransport(env.AGENT_HTTP_ENDPOINT,{production:true});
  }
  const solanaNetwork = env.SOLANA_NETWORK || (env.ECONOMY_MODE === 'DEVNET' || env.APP_MODE === 'devnet' ? 'devnet' : env.ECONOMY_MODE === 'LOCAL' || env.APP_MODE === 'local-validator' ? 'localnet' : 'none');
  if (!['none','localnet','devnet','mainnet-beta'].includes(solanaNetwork)) throw new Error('SOLANA_NETWORK must be none, localnet, devnet, or mainnet-beta.');
  if (solanaNetwork === 'mainnet-beta' || mainnetFunding === 'true') {
    if (solanaNetwork !== 'mainnet-beta' || mainnetFunding !== 'true') throw new Error('Mainnet ownership requires SOLANA_NETWORK=mainnet-beta and ENABLE_MAINNET_AGENT_FUNDING=true.');
    throw Object.assign(new Error('MAINNET_AGENT_FUNDING_NOT_IMPLEMENTED: ownership can be configured after wallet signing, receipt verification, recovery, and withdrawal gates pass.'),{code:'MAINNET_AGENT_FUNDING_NOT_IMPLEMENTED'});
  }
  const requestedMode=env.APP_MODE;
  const allowedModes=['free','mock','local-validator','devnet','mainnet-ownership'];
  if(requestedMode&&!allowedModes.includes(requestedMode))throw new Error(`APP_MODE must be one of ${allowedModes.join(', ')}.`);
  if(requestedMode==='mainnet-ownership')throw Object.assign(new Error('MAINNET_AGENT_FUNDING_NOT_IMPLEMENTED: mainnet ownership is not ready for activation.'),{code:'MAINNET_AGENT_FUNDING_NOT_IMPLEMENTED'});
  const appMode=requestedMode||(env.ECONOMY_MODE==='DEVNET'?'devnet':env.ECONOMY_MODE==='LOCAL'?'local-validator':env.ECONOMY_LAB==='1'?'mock':'free');
  const publicDevnet = production && env.ENTRY_FEE_ENABLED === 'true' && env.ECONOMY_MODE === 'DEVNET';
  if((appMode==='devnet'&&solanaNetwork!=='devnet')||(appMode==='local-validator'&&solanaNetwork!=='localnet')||(['free','mock'].includes(appMode)&&solanaNetwork!=='none'))throw new Error('APP_MODE and SOLANA_NETWORK do not match.');
  if(production&&['mock','local-validator'].includes(requestedMode))throw new Error('Mock and local-validator modes are disabled in public production.');
  if(production&&appMode==='devnet'&&!publicDevnet)throw new Error('Public Devnet mode requires the explicit Devnet test-SOL funding configuration.');
  const publicPredictions = env.PREDICTIONS_ENABLED === 'true';
  if (publicPredictions && !publicDevnet) throw new Error('Public predictions require explicit production DEVNET test SOL mode.');
  if (publicPredictions) throw new Error('Public prediction routes and payment integration are not implemented; leave PREDICTIONS_ENABLED disabled.');
  if (production) {
    if (!publicOrigin || !publicOrigin.startsWith('https://')) throw new Error('Set PUBLIC_ORIGIN or assign a Railway public domain before production startup.');
    if (!env.MATCHES_DIR || !path.isAbsolute(env.MATCHES_DIR)) throw new Error('Set MATCHES_DIR to an absolute path on persistent mounted storage.');
    if (!env.HOST_SESSION_SECRET || env.HOST_SESSION_SECRET.length < 32) throw new Error('Set HOST_SESSION_SECRET to at least 32 random characters and keep it stable across redeploys.');
    if (env.ECONOMY_LAB === '1' || env.MACHINE_PAYMENTS_DEMO === '1') throw new Error('Economy labs and machine payment demos are disabled in public production.');
    if (env.ENTRY_FEE_ENABLED === 'true' && !publicDevnet) throw new Error('Paid entry production supports explicit DEVNET test SOL mode only.');
    if (env.ECONOMY_MODE && !['SIMULATED', 'DEVNET'].includes(env.ECONOMY_MODE)) throw new Error('Production economy mode must be SIMULATED or DEVNET.');
    if (publicDevnet) {
      if (env.PUBLIC_DEVNET_ACK !== 'I_UNDERSTAND_TEST_SOL_ONLY') throw new Error('Acknowledge that public Devnet uses valueless test SOL.');
      if (!env.SOLANA_DEVNET_RPC_URL?.startsWith('https://')) throw new Error('Public Devnet requires a dedicated HTTPS SOLANA_DEVNET_RPC_URL.');
    }
  }

  const publicOrigins = [...new Set([publicOrigin, env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null].filter(Boolean))];
  return { production, publicDevnet, publicPredictions, publicModelInferenceEnabled:publicModelInference==='true', appMode, solanaNetwork, trustProxy, mainnetAgentFundingEnabled:false, mainnetMatchWageringEnabled:false, publicOrigin, publicOrigins, port, host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1') };
}
