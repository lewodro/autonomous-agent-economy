/**
 * Quick-chat vocabulary for the world selector. The server owns the canonical
 * allowlist in service/quick-chat.js and is the only source of the relayed text;
 * this catalog mirrors it for rendering. A unit test compares both lists.
 */
export type QuickChatDirection = 'up' | 'right' | 'down' | 'left';
export interface QuickChatPhrase {id: string; direction: QuickChatDirection; text: string}

export const QUICK_CHAT_OPTIONS: ReadonlyArray<QuickChatPhrase> = Object.freeze([
  {id: 'ttt', direction: 'up', text: 'run tic-tac-toe?'},
  {id: 'arena', direction: 'right', text: 'arena?'},
  {id: 'follow', direction: 'down', text: 'follow me'},
  {id: 'nice', direction: 'left', text: 'nice one'},
]);

/** A held key opens the selector; a tap still performs the normal E action. */
export const QUICK_CHAT_HOLD_MS = 380;
/** Mirrors the server's send radius so the affordance appears at the same distance that will be accepted. */
export const QUICK_CHAT_RADIUS = 220;
/** The server accepts a phrase within its own tighter radius; rendering is a little wider so edge cases still appear. */
export const QUICK_CHAT_VISIBLE_RADIUS = 320;
export const QUICK_CHAT_BUBBLE_MS = 2_600;
export const QUICK_CHAT_BUBBLE_EXIT_MS = 220;

export function quickChatPhrase(id: string): QuickChatPhrase | undefined {
  return QUICK_CHAT_OPTIONS.find(option => option.id === id);
}
export function quickChatForDirection(direction: QuickChatDirection): QuickChatPhrase | undefined {
  return QUICK_CHAT_OPTIONS.find(option => option.direction === direction);
}
