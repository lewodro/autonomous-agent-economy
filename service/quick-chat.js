/**
 * The only phrases the world will ever relay. Clients send one of these IDs;
 * the server owns the display text, so the quick-chat endpoint can never be
 * used as free-form text chat.
 *
 * Phrases with a `challenge` are actionable: after the bubble is relayed the
 * server may invite the nearest human to one shared match. The other phrases
 * stay ordinary ephemeral quick chat.
 *
 * Keep this list in sync with web/src/world/quick-chat.ts. A unit test compares
 * both catalogs so the selector and the server cannot drift apart.
 */
export const QUICK_CHAT_PHRASES = Object.freeze({
  ttt: Object.freeze({direction: 'up', text: 'tic-tac-toe?', challenge: 'tictactoe'}),
  rps: Object.freeze({direction: 'right', text: 'rps?', challenge: 'rps'}),
  follow: Object.freeze({direction: 'down', text: 'follow me'}),
  nice: Object.freeze({direction: 'left', text: 'nice one'}),
});

export const QUICK_CHAT_IDS = Object.freeze(Object.keys(QUICK_CHAT_PHRASES));

/** Roughly four avatar widths: close enough to feel spoken, not shouted. */
export const QUICK_CHAT_RADIUS = 220;
export const QUICK_CHAT_COOLDOWN_MS = 1_500;

/** A challenge invite is readable for long enough to accept, but not a queue. */
export const CHALLENGE_TTL_MS = 15_000;
/** One invite per challenger every few seconds, independent of the bubble cooldown. */
export const CHALLENGE_COOLDOWN_MS = 4_000;
