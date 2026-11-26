/**
 * The only phrases the world will ever relay. Clients send one of these IDs;
 * the server owns the display text, so the quick-chat endpoint can never be
 * used as free-form text chat.
 *
 * Phrases with a `challenge` are actionable: after the bubble is relayed the
 * server may invite the nearest human to one shared match. The other phrases
 * stay ordinary ephemeral quick chat.
 *
 * The client shows two pages of four directions. `page` only groups phrases
 * for the selector; direction alone never selects a phrase without a page.
 *
 * Keep this list in sync with web/src/world/quick-chat.ts. A unit test compares
 * both catalogs so the selector and the server cannot drift apart.
 */
export const QUICK_CHAT_PHRASES = Object.freeze({
  hi: Object.freeze({page: 'social', direction: 'up', text: 'hi!'}),
  follow: Object.freeze({page: 'social', direction: 'right', text: 'follow me'}),
  nice: Object.freeze({page: 'social', direction: 'down', text: 'nice one'}),
  wait: Object.freeze({page: 'social', direction: 'left', text: 'wait here'}),
  ttt: Object.freeze({page: 'game', direction: 'up', text: 'tic-tac-toe?', challenge: 'tictactoe'}),
  rps: Object.freeze({page: 'game', direction: 'right', text: 'rps?', challenge: 'rps'}),
  sword: Object.freeze({page: 'game', direction: 'down', text: 'sword duel?', challenge: 'swordduel'}),
  explore: Object.freeze({page: 'game', direction: 'left', text: "let's explore"}),
});

export const QUICK_CHAT_IDS = Object.freeze(Object.keys(QUICK_CHAT_PHRASES));
export const QUICK_CHAT_PAGES = Object.freeze(['social', 'game']);

/** Roughly four avatar widths: close enough to feel spoken, not shouted. */
export const QUICK_CHAT_RADIUS = 220;
export const QUICK_CHAT_COOLDOWN_MS = 1_500;

/** A challenge invite is readable for long enough to accept, but not a queue. */
export const CHALLENGE_TTL_MS = 15_000;
/** One invite per challenger every few seconds, independent of the bubble cooldown. */
export const CHALLENGE_COOLDOWN_MS = 4_000;
