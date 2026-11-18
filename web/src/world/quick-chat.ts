/**
 * Quick-chat vocabulary for the world selector. The server owns the canonical
 * allowlist in service/quick-chat.js and is the only source of the relayed text;
 * this catalog mirrors it for rendering. A unit test compares both lists.
 *
 * Eight phrases live on two pages of four directions. The page only changes
 * which phrase a direction maps to; every phrase is still sent by ID.
 */
export type QuickChatDirection = 'up' | 'right' | 'down' | 'left';
export type QuickChatPage = 'social' | 'game';
export type QuickChatGame = 'tictactoe' | 'rps';
export interface QuickChatPhrase {id: string; page: QuickChatPage; direction: QuickChatDirection; text: string; challenge?: QuickChatGame}

export const QUICK_CHAT_OPTIONS: ReadonlyArray<QuickChatPhrase> = Object.freeze([
  {id: 'hi', page: 'social', direction: 'up', text: 'hi!'},
  {id: 'follow', page: 'social', direction: 'right', text: 'follow me'},
  {id: 'nice', page: 'social', direction: 'down', text: 'nice one'},
  {id: 'wait', page: 'social', direction: 'left', text: 'wait here'},
  {id: 'ttt', page: 'game', direction: 'up', text: 'tic-tac-toe?', challenge: 'tictactoe'},
  {id: 'rps', page: 'game', direction: 'right', text: 'rps?', challenge: 'rps'},
  {id: 'arena', page: 'game', direction: 'down', text: 'arena?'},
  {id: 'explore', page: 'game', direction: 'left', text: "let's explore"},
]);

export const QUICK_CHAT_PAGES: ReadonlyArray<QuickChatPage> = Object.freeze(['social', 'game']);
export const QUICK_CHAT_PAGE_LABEL: Record<QuickChatPage, string> = {social: 'SOCIAL', game: 'GAME'};

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
export function quickChatPhrases(page: QuickChatPage): ReadonlyArray<QuickChatPhrase> {
  return QUICK_CHAT_OPTIONS.filter(option => option.page === page);
}
export function quickChatForDirection(direction: QuickChatDirection, page: QuickChatPage = 'social'): QuickChatPhrase | undefined {
  return QUICK_CHAT_OPTIONS.find(option => option.page === page && option.direction === direction);
}
export function nextQuickChatPage(page: QuickChatPage): QuickChatPage {
  return page === 'social' ? 'game' : 'social';
}
