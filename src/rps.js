export const MOVES = Object.freeze(['rock', 'paper', 'scissors']);
export function resolve(a, b) {
  if (!MOVES.includes(a) || !MOVES.includes(b)) throw new Error('Invalid RPS move');
  return a === b ? 'draw' : (MOVES.indexOf(a) - MOVES.indexOf(b) + 3) % 3 === 1 ? 'a' : 'b';
}
export function nonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
}
export async function commitment(matchId, agentId, move, salt) {
  if (!MOVES.includes(move) || !/^[a-f0-9]{64}$/.test(salt)) throw new Error('Invalid commitment input');
  const payload = JSON.stringify(['rps-v1', matchId, agentId, move, salt]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
export async function verifyProof(match) {
  if (!match?.players || match.players.length !== 2 || match.players[0] === match.players[1] || !match.reveals || !match.commitments) return false;
  try {
    const valid = await Promise.all(match.players.map(async id => {
      const reveal = match.reveals[id];
      return reveal && await commitment(match.id, id, reveal.move, reveal.nonce) === match.commitments[id];
    }));
    return valid.every(Boolean) && (!match.result || match.result === resolve(...match.players.map(id => match.reveals[id].move)));
  } catch { return false; }
}
