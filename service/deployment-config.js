import path from 'node:path';

export function validateDeploymentConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
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

  const publicDevnet = production && env.ENTRY_FEE_ENABLED === 'true' && env.ECONOMY_MODE === 'DEVNET';
  const publicPredictions = env.PREDICTIONS_ENABLED === 'true';
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
    if (publicPredictions && !publicDevnet) throw new Error('Public predictions require explicit DEVNET test SOL mode.');
  }

  const publicOrigins = [...new Set([publicOrigin, env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : null].filter(Boolean))];
  return { production, publicDevnet, publicPredictions, publicOrigin, publicOrigins, port, host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1') };
}
