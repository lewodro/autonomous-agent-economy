/**
 * The only phrases the world will ever relay. Clients send one of these IDs;
 * the server owns the display text, so the quick-chat endpoint can never be
 * used as free-form text chat.
 *
 * Keep this list in sync with web/src/world/quick-chat.ts. A unit test compares
 * both catalogs so the selector and the server cannot drift apart.
 */
export const QUICK_CHAT_PHRASES = Object.freeze({
  ttt: Object.freeze({direction: 'up', text: 'run tic-tac-toe?'}),
  arena: Object.freeze({direction: 'right', text: 'arena?'}),
  follow: Object.freeze({direction: 'down', text: 'follow me'}),
  nice: Object.freeze({direction: 'left', text: 'nice one'}),
});

export const QUICK_CHAT_IDS = Object.freeze(Object.keys(QUICK_CHAT_PHRASES));

/** Roughly four avatar widths: close enough to feel spoken, not shouted. */
export const QUICK_CHAT_RADIUS = 220;
export const QUICK_CHAT_COOLDOWN_MS = 1_500;
