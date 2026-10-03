import { generateKeyPairSync, sign } from 'node:crypto';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function encode58(bytes) {
  let number = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), text = '';
  while (number) { text = alphabet[Number(number % 58n)] + text; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; text = '1' + text; }
  return text;
}
export function decode58(text) {
  if (typeof text !== 'string' || !text.length || text.length > 88) throw new Error('Invalid base58');
  let number = 0n;
  for (const char of text) { const n = alphabet.indexOf(char); if (n < 0) throw new Error('Invalid base58'); number = number * 58n + BigInt(n); }
  let hex = number ? number.toString(16) : ''; if (hex.length % 2) hex = '0' + hex;
  return Buffer.concat([Buffer.alloc(text.match(/^1*/)[0].length), Buffer.from(hex, 'hex')]);
}
export function ephemeralSigner() {
  const keys = generateKeyPairSync('ed25519');
  const bytes = keys.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  // Return a signing closure, never raw private-key material.
  return { address: encode58(bytes), bytes, publicKey: keys.publicKey, sign: message => sign(null, message, keys.privateKey) };
}
export function transferMessage(payer, recipient, blockhash, lamports) {
  if (!Number.isSafeInteger(lamports) || lamports < 1 || lamports > 1_000_000) throw new Error('Demo transfer limited to 0.001 SOL');
  const keys = [payer, recipient, '11111111111111111111111111111111'].map(decode58);
  const hash = decode58(blockhash);
  if (keys.some(key => key.length !== 32) || hash.length !== 32) throw new Error('Addresses and blockhash must be 32 bytes');
  const data = Buffer.alloc(12); data.writeUInt32LE(2); data.writeBigUInt64LE(BigInt(lamports), 4);
  // Legacy message: one signer, three accounts, one System Program transfer instruction.
  return Buffer.concat([Buffer.from([1, 0, 1, 3]), ...keys, hash, Buffer.from([1, 2, 2, 0, 1, 12]), data]);
}
export function signedTransaction(signer, message) {
  return Buffer.concat([Buffer.from([1]), signer.sign(message), message]);
}
