export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet';

export function validPublicSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let decoded = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (decoded > 0n) { bytes++; decoded >>= 8n; }
  let leading = 0;
  for (const char of value) { if (char !== '1') break; leading++; }
  return bytes + leading === 32;
}

export function solscanAccountUrl(address: unknown, network: unknown): string | null {
  if (!validPublicSolanaAddress(address)) return null;
  if (network === 'mainnet-beta') return `https://solscan.io/account/${address}`;
  if (network === 'devnet' || network === 'testnet') return `https://solscan.io/account/${address}?cluster=${network}`;
  return null;
}
