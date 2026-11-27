/**
 * One authoritative shared duel, opened by the two visitors who accepted a
 * proximity challenge or by anyone watching a public match read-only.
 *
 * This page only renders server state. Participants may submit a move or a
 * pick; spectators (`?spectate=1`) never hold a seat and never send a command.
 * Rules, turn order, reveal order and results stay on the server.
 */
import { SwordArena, type SwordEvent, type SwordFighter, type SwordView } from './sword-arena.js';

type Game = 'tictactoe' | 'rps' | 'swordduel';
type Marker = 'a' | 'b';
type RpsMove = 'rock' | 'paper' | 'scissors';
interface DuelPlayerView { player_id: string; name: string; marker: Marker; avatar?: string; picked?: boolean; pick?: RpsMove | null }
interface DuelView {
  duel_id: string; game: Game; status: 'playing' | 'finished' | 'expired'; revision: number;
  created_at: string; expires_at: string;
  you: DuelPlayerView; opponent: DuelPlayerView; result: Marker | 'draw' | null; winner_player_id: string | null;
  board?: Array<Marker | null>; moves?: Array<{ player_id: string; cell: number }>; turn_player_id?: string | null;
  combat?: SwordView['combat']; fighters?: SwordFighter[]; events?: SwordEvent[]; countdown_ms?: number;
}
interface SpectateView {
  duel_id: string; game: Game; status: 'playing' | 'finished' | 'expired'; revision: number; spectating: true;
  created_at: string; expires_at: string; finished_at: string | null;
  players: Array<{ player_id: string; name: string; marker: Marker; avatar?: string; picked?: boolean }>;
  result: Marker | 'draw' | null; winner_player_id: string | null;
  board?: Array<Marker | null>; moves?: Array<{ player_id: string; cell: number }>; turn_player_id?: string | null;
  locked?: boolean[]; picks?: Array<{ player_id: string; move: RpsMove | null }>;
  combat?: SwordView['combat']; fighters?: SwordFighter[]; events?: SwordEvent[]; countdown_ms?: number;
}
interface Seat { id: string; name: string; marker: Marker; avatar: string; picked: boolean; pick: RpsMove | null; hp?: number; maxHp?: number }
interface Snapshot {
  id: string; game: Game; status: 'playing' | 'finished' | 'expired'; revision: number;
  seats: [Seat, Seat]; board: Array<Marker | null> | null; turnId: string | null;
  result: Marker | 'draw' | null; winnerId: string | null; spectating: boolean; youId: string | null;
  sword: SwordView | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = $<HTMLElement>('duel-title'), status = $<HTMLElement>('duel-status'), players = $<HTMLDivElement>('duel-players');
const board = $<HTMLDivElement>('duel-board'), actions = $<HTMLDivElement>('duel-actions');
const hint = $<HTMLElement>('duel-hint'), result = $<HTMLElement>('duel-result');
const gameLabel = $<HTMLElement>('duel-game'), scope = $<HTMLElement>('duel-scope'), modeLabel = $<HTMLElement>('duel-mode');
const arenaWrap = $<HTMLDivElement>('duel-arena-wrap'), arenaCanvas = $<HTMLCanvasElement>('duel-arena'), arenaControls = $<HTMLDivElement>('duel-arena-controls');
const strikeButton = $<HTMLButtonElement>('duel-strike'), dodgeButton = $<HTMLButtonElement>('duel-dodge');
const shieldButton = $<HTMLButtonElement>('duel-shield'), shieldHud = $<HTMLElement>('duel-shield-hud');
const returnLink = $<HTMLAnchorElement>('duel-return'), exitLink = document.querySelector<HTMLAnchorElement>('.duel-exit');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const POLL_MS = 800;
const SWORD_POLL_MS = 160;
const GAME_LABEL: Record<Game, string> = { tictactoe: 'TIC-TAC-TOE', rps: 'ROCK PAPER SCISSORS', swordduel: 'SWORD DUEL' };
const MOVES: RpsMove[] = ['rock', 'paper', 'scissors'];
const AVATAR_PREVIEW: Record<string, string> = {
  visitor_starter: '/assets/avatars/clean/starter_preview.png',
  visitor_ember: '/assets/avatars/clean/ember_preview.png',
  visitor_atlas: '/assets/avatars/clean/atlas_preview.png',
  visitor_nova: '/assets/avatars/clean/nova_preview.png',
  visitor_echo: '/assets/avatars/clean/echo_preview.png',
};
const WIN_LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];
const spectating = new URLSearchParams(location.search).get('spectate') === '1';
const duelId = location.pathname.match(/^\/duel\/(duel-[a-f0-9-]{36})$/)?.[1] ?? '';

let state: Snapshot | null = null, previous: Snapshot | null = null;
let busy = false, stopped = false, timer = 0, errorText = '';
let playerSignature = '', leftCard: HTMLElement | null = null, rightCard: HTMLElement | null = null;
let lastBoard: Array<Marker | null> | null = null;
let revealPhase: 'settled' | 'locked' = 'settled', revealTimer = 0;
const cells: HTMLButtonElement[] = [];
let arena: SwordArena | null = null;

function setStatus(message: string, tone: 'info' | 'good' | 'warn' | 'bad' = 'info'): void {
  status.textContent = message; status.dataset.tone = tone;
}
async function duelRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', signal: AbortSignal.timeout(8_000) });
  const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) throw Object.assign(new Error(data?.error || 'Match request failed'), { status: response.status, code: data?.code });
  return data as T;
}
function codeOf(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
}
function seatOf(player: DuelPlayerView, picked: boolean, pick: RpsMove | null): Seat {
  return { id: player.player_id, name: player.name, marker: player.marker, avatar: player.avatar || 'visitor_starter', picked, pick };
}
function swordFrom(view: DuelView | SpectateView): SwordView | null {
  if (!view.combat || !view.fighters || view.fighters.length !== 2) return null;
  return { combat: view.combat, fighters: [view.fighters[0]!, view.fighters[1]!], events: view.events ?? [],
    countdown_ms: view.countdown_ms ?? view.combat.countdown_ms };
}
function fromParticipant(view: DuelView): Snapshot {
  const sword = swordFrom(view);
  // A finished duel no longer sends combat state. Keep the last known arena
  // so the final health bars and impact effects remain visible to both sides.
  if (!sword && state?.sword && state.id === view.duel_id) view = { ...view, combat: state.sword.combat, fighters: state.sword.fighters, events: state.sword.events };
  const seats: [Seat, Seat] = [seatOf(view.you, Boolean(view.you.picked), view.you.pick ?? null), seatOf(view.opponent, Boolean(view.opponent.picked), view.opponent.pick ?? null)];
  if (sword) seats.forEach((seat, index) => { seat.hp = sword.fighters[index]!.hp; seat.maxHp = sword.fighters[index]!.max_hp; });
  return {
    id: view.duel_id, game: view.game, status: view.status, revision: view.revision,
    seats, board: view.board ?? null, turnId: view.turn_player_id ?? null,
    result: view.result, winnerId: view.winner_player_id, spectating: false, youId: view.you.player_id, sword,
  };
}
function fromSpectator(view: SpectateView): Snapshot {
  const picks = new Map((view.picks ?? []).map(entry => [entry.player_id, entry.move]));
  const sword = swordFrom(view);
  const seats = view.players.slice(0, 2).map((player, index) => ({
    id: player.player_id, name: player.name, marker: player.marker, avatar: player.avatar || 'visitor_starter',
    picked: Boolean(view.locked?.[index] ?? player.picked), pick: picks.get(player.player_id) ?? null,
    hp: sword?.fighters[index]?.hp, maxHp: sword?.fighters[index]?.max_hp,
  })) as Seat[];
  return {
    id: view.duel_id, game: view.game, status: view.status, revision: view.revision,
    seats: [seats[0]!, seats[1]!], board: view.board ?? null, turnId: view.turn_player_id ?? null,
    result: view.result, winnerId: view.winner_player_id, spectating: true, youId: null, sword,
  };
}
function winnerLine(cellsValue: Array<Marker | null>): number[] | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const value = cellsValue[a];
    if (value && value === cellsValue[b] && value === cellsValue[c]) return [a, b, c];
  }
  return null;
}

/* ---------------------------------------------------------------- players */
function playerCard(seat: Seat, tag: string): HTMLElement {
  const card = document.createElement('div'); card.className = 'duel-player'; card.dataset.side = seat.marker;
  const label = document.createElement('span'); label.className = 'duel-player__tag'; label.textContent = tag;
  const avatar = document.createElement('img'); avatar.className = 'duel-player__avatar';
  avatar.src = AVATAR_PREVIEW[seat.avatar] || AVATAR_PREVIEW.visitor_starter!; avatar.alt = ''; avatar.width = 48; avatar.height = 48;
  const name = document.createElement('strong'); name.className = 'duel-player__name'; name.textContent = seat.name.toUpperCase();
  const meta = document.createElement('small'); meta.className = 'duel-player__meta';
  card.append(label, avatar, name, meta);
  return card;
}
function renderPlayers(): void {
  if (!state) return;
  const signature = `${state.seats.map(seat => `${seat.id}:${seat.name}:${seat.avatar}:${seat.marker}`).join('|')}|${state.spectating}`;
  if (signature !== playerSignature) {
    playerSignature = signature;
    players.replaceChildren();
    const tags = state.spectating ? ['PLAYER A', 'PLAYER B'] : ['YOU', 'OPPONENT'];
    leftCard = playerCard(state.seats[0], tags[0]!); rightCard = playerCard(state.seats[1], tags[1]!);
    const versus = document.createElement('span'); versus.className = 'duel-vs'; versus.textContent = 'VS';
    players.append(leftCard, versus, rightCard);
    if (!reduceMotion.matches) {
      for (const card of [leftCard, rightCard]) {
        card.classList.add('is-entering');
        requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('is-entering')));
      }
    }
  }
  const [left, right] = state.seats;
  const metaFor = (seat: Seat): string => {
    if (state!.game === 'tictactoe') return seat.marker === 'a' ? 'X' : 'O';
    if (state!.game === 'swordduel') return `${seat.hp ?? '—'} / ${seat.maxHp ?? '—'} HP`;
    return seat.picked ? 'LOCKED' : 'CHOOSING';
  };
  const update = (card: HTMLElement | null, seat: Seat): void => {
    if (!card) return;
    (card.querySelector('.duel-player__meta') as HTMLElement).textContent = metaFor(seat);
    card.classList.toggle('is-turn', state!.status === 'playing' && state!.turnId === seat.id);
    card.classList.toggle('is-picked', state!.game === 'rps' && seat.picked && state!.status === 'playing');
    card.classList.toggle('is-winner', state!.status === 'finished' && state!.result !== 'draw' && state!.winnerId === seat.id);
  };
  update(leftCard, left); update(rightCard, right);
}

/* ------------------------------------------------------------------ board */
function ensureCells(): void {
  if (cells.length) return;
  for (let index = 0; index < 9; index++) {
    const cell = document.createElement('button'); cell.type = 'button'; cell.className = 'duel-cell'; cell.dataset.cell = String(index);
    cell.addEventListener('click', () => {
      if (!cell.disabled && !state?.spectating) void submit('move', { cell: index, revision: state!.revision });
    });
    cells.push(cell); board.append(cell);
  }
}
function renderBoard(): void {
  const isBoard = state?.game === 'tictactoe';
  board.hidden = !isBoard;
  if (!state || !isBoard) return;
  ensureCells();
  const values = state.board ?? [];
  const line = state.status === 'finished' ? winnerLine(values) : null;
  const mine = state.spectating ? false : state.turnId === state.youId && state.status === 'playing';
  for (let index = 0; index < 9; index++) {
    const cell = cells[index]!;
    const marker = values[index] ?? null;
    const before = lastBoard?.[index] ?? null;
    const label = marker === 'a' ? 'X' : marker === 'b' ? 'O' : '';
    if (cell.textContent !== label) cell.textContent = label;
    if (marker) cell.dataset.marker = marker; else delete cell.dataset.marker;
    cell.classList.toggle('is-winning', Boolean(line?.includes(index)));
    cell.disabled = busy || state.spectating || state.status !== 'playing' || !mine || marker !== null;
    cell.setAttribute('aria-label', marker ? `Cell ${index + 1}, ${label}` : `Cell ${index + 1}, empty`);
    if (marker && marker !== before && !reduceMotion.matches) {
      cell.classList.remove('is-placing');
      void cell.offsetWidth;
      cell.classList.add('is-placing');
    }
  }
  lastBoard = values.slice();
}

/* -------------------------------------------------------------------- rps */
function renderActions(): void {
  const isRps = state?.game === 'rps';
  actions.hidden = !isRps;
  if (!state || !isRps) return;
  actions.replaceChildren();
  const reveal = state.status === 'finished';
  for (const move of MOVES) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.pick = move;
    button.textContent = move.toUpperCase();
    const mine = state.spectating ? false : state.seats[0].pick === move;
    if (mine) button.classList.add('is-picked');
    button.disabled = busy || state.spectating || state.status !== 'playing' || state.seats[0].picked;
    button.addEventListener('click', () => { if (!button.disabled) void submit('pick', { move }); });
    actions.append(button);
  }
  const locks = state.seats.map(seat => seat.picked);
  actions.dataset.locked = String(locks.filter(Boolean).length);
  actions.classList.toggle('is-revealed', reveal);
}

/* ----------------------------------------------------------------- result */
function renderResult(): void {
  result.hidden = true; hint.textContent = '';
  const current = state;
  if (!current) return;
  if (current.status === 'expired') {
    setStatus('THIS MATCH EXPIRED', 'warn');
    result.hidden = false; result.textContent = 'MATCH EXPIRED';
    return;
  }
  if (current.game === 'swordduel') {
    const finished = current.status === 'finished';
    const countdown = current.sword?.countdown_ms ?? current.sword?.combat.countdown_ms ?? 0;
    const winner = current.seats.find(seat => seat.id === current.winnerId) ?? null;
    const youWon = !current.spectating && winner?.id === current.youId;
    setStatus(finished ? youWon ? 'VICTORY' : current.spectating ? `${winner?.name.toUpperCase() || 'A PLAYER'} WINS` : 'DEFEAT'
      : countdown > 0 ? `GUARD UP · ${Math.ceil(countdown / 1000)}`
        : current.spectating ? 'SPECTATING · READ ONLY' : 'FIGHT!',
      finished ? youWon ? 'good' : 'bad' : 'info');
    hint.textContent = finished
      ? 'Match settled by the server. Both fighters return to their saved world position.'
      : current.spectating
        ? 'Read-only view. Movement, damage and the winner are decided on the server.'
        : countdown > 0
          ? 'Both fighters enter the ring. The server starts the duel after a short countdown; equipment stats are standardised here.'
          : 'WASD / arrows move · SPACE or J strike · right-click or F shields · SHIFT or K dodge. Equipment stats are standardised here.';
    result.hidden = !finished;
    if (finished) {
      result.textContent = youWon ? 'VICTORY' : winner ? 'DEFEAT' : 'MATCH COMPLETE';
      result.dataset.outcome = youWon ? 'win' : 'complete';
    }
    return;
  }
  if (current.status !== 'finished' || revealPhase === 'locked') {
    if (current.game === 'tictactoe') {
      const yourTurn = !current.spectating && current.turnId === current.youId;
      const turnName = current.seats.find(seat => seat.id === current.turnId)?.name.toUpperCase();
      setStatus(current.spectating ? `${turnName ?? 'A PLAYER'}'S TURN` : yourTurn ? 'YOUR MOVE' : `WAITING FOR ${current.seats[1].name.toUpperCase()}`,
        yourTurn ? 'good' : 'info');
      hint.textContent = current.spectating ? 'Read-only view. The server owns the board and decides the winner.' : 'Click an empty square. The server owns the board and decides the winner.';
      return;
    }
    const locks = current.seats.map(seat => seat.picked);
    const locked = locks.filter(Boolean).length;
    if (locked >= 2 || revealPhase === 'locked') {
      setStatus('BOTH LOCKED · REVEALING…', 'good');
      hint.textContent = 'Both choices are locked. The reveal is next.';
    } else if (current.spectating) {
      setStatus(`WAITING · ${locked}/2 LOCKED`, 'info');
      hint.textContent = 'Choices stay hidden until both players lock in.';
    } else {
      setStatus(current.seats[0].picked ? 'WAITING FOR OPPONENT' : locked ? 'WAITING · 1/2 LOCKED' : 'WAITING FOR PICKS', current.seats[0].picked ? 'good' : 'info');
      hint.textContent = 'Pick rock, paper or scissors. Your pick stays hidden until your opponent has chosen.';
    }
    return;
  }
  const draw = current.result === 'draw';
  const winner = current.seats.find(seat => seat.id === current.winnerId) ?? null;
  const youWon = !current.spectating && winner?.id === current.youId;
  const headline = draw ? 'DRAW' : youWon ? 'YOU WIN' : winner ? `${winner.name.toUpperCase()} WINS` : 'MATCH COMPLETE';
  scope.textContent = 'FINAL';
  if (current.spectating) setStatus(draw ? 'DRAW' : winner ? `${winner.name.toUpperCase()} WINS` : 'MATCH COMPLETE', draw ? 'warn' : 'good');
  else setStatus(youWon ? 'WINNER' : draw ? 'DRAW' : 'YOU LOST', youWon ? 'good' : draw ? 'warn' : 'bad');
  result.hidden = false; result.textContent = headline;
  result.dataset.outcome = draw ? 'draw' : winner ? 'win' : 'complete';
  if (current.game === 'rps') {
    const [left, right] = current.seats;
    hint.textContent = `${left.name.toUpperCase()} ${(left.pick ?? '—').toUpperCase()} · ${right.name.toUpperCase()} ${(right.pick ?? '—').toUpperCase()}`;
  } else {
    hint.textContent = current.spectating ? 'Read-only match complete. Players return to their own saved world position.' : 'Match complete. You keep your own saved world position.';
  }
}

/* ----------------------------------------------------------------- render */
function render(): void {
  if (!state) return;
  title.textContent = GAME_LABEL[state.game];
  gameLabel.textContent = GAME_LABEL[state.game];
  scope.textContent = state.status === 'finished' ? 'FINAL' : 'LIVE';
  modeLabel.textContent = state.spectating ? 'SPECTATING · READ ONLY' : 'SHARED MATCH';
  const isSword = state.game === 'swordduel';
  arenaWrap.hidden = !isSword;
  arenaControls.hidden = !isSword || state.spectating || state.status !== 'playing';
  if (isSword && state.sword) {
    arena?.update(state.sword, state.youId, state.spectating);
    const countdown = state.sword.countdown_ms ?? state.sword.combat.countdown_ms ?? 0;
    const youId = state.youId;
    const fighterIndex = state.sword.fighters.findIndex(fighter => fighter.player_id === youId);
    const mine = state.sword.fighters[Math.max(0, fighterIndex)];
    const charges = mine?.block_charges ?? state.sword.combat.block_charges;
    const total = state.sword.combat.block_charges;
    shieldHud.textContent = `SHIELD ${Array.from({ length: total }, (_, index) => index < charges ? '●' : '○').join(' ')}`
      + (mine && mine.block_recharge_ms > 0 ? ` · ${Math.ceil(mine.block_recharge_ms / 1000)}s` : '');
    shieldHud.hidden = !isSword;
    const active = state.status === 'playing' && countdown <= 0;
    strikeButton.disabled = busy || !active || !mine?.can_attack;
    shieldButton.disabled = busy || !active || charges <= 0;
    dodgeButton.disabled = busy || !active;
  } else shieldHud.hidden = true;
  if (state.spectating) setStatus('SPECTATING · READ ONLY', 'info'), status.dataset.spectating = 'true';
  renderPlayers(); renderBoard(); renderActions(); renderResult();
  if (errorText) { setStatus(errorText, 'bad'); errorText = ''; }
}
function schedule(): void {
  if (timer) window.clearTimeout(timer); timer = 0;
  if (stopped || !state || state.status !== 'playing') return;
  timer = window.setTimeout(() => { void load(); }, state.game === 'swordduel' ? SWORD_POLL_MS : POLL_MS);
}
function apply(next: Snapshot): void {
  previous = state; state = next;
  if (next.game === 'rps' && next.status === 'finished' && previous?.status === 'playing' && previous.id === next.id) {
    // Both players just locked: hold the deliberate WAITING → LOCKED → REVEAL beat.
    revealPhase = 'locked'; render();
    if (revealTimer) window.clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => { revealPhase = 'settled'; render(); }, reduceMotion.matches ? 0 : 420);
    return;
  }
  revealPhase = 'settled';
  render();
}
async function load(): Promise<void> {
  if (stopped || !duelId) return;
  try {
    const next = spectating
      ? fromSpectator(await duelRequest<SpectateView>(`/api/world/duels/${encodeURIComponent(duelId)}/spectate`))
      : fromParticipant(await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}`));
    if (stopped) return;
    errorText = ''; apply(next);
  } catch (error) {
    if (stopped) return;
    const code = codeOf(error);
    if (code === 'DUEL_NOT_FOUND' || code === 'DUEL_NOT_YOURS') {
      setStatus(code === 'DUEL_NOT_YOURS' ? 'THIS MATCH BELONGS TO ANOTHER PAIR' : 'THIS MATCH IS NO LONGER AVAILABLE', 'bad');
      board.hidden = true; actions.hidden = true; players.replaceChildren(); hint.textContent = '';
      stopped = true; return;
    }
    setStatus('RECONNECTING TO THE MATCH…', 'warn');
  }
  schedule();
}
async function submit(action: 'move' | 'pick', body: Record<string, unknown>): Promise<void> {
  if (busy || stopped || spectating || !state || state.status !== 'playing') return;
  busy = true; render();
  try {
    apply(fromParticipant(await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}/${action}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })));
  } catch (error) {
    const code = codeOf(error);
    if (code === 'DUEL_REVISION' || code === 'PICK_LOCKED' || code === 'DUEL_FINISHED') {
      try { apply(fromParticipant(await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}`))); }
      catch { render(); }
    } else {
      errorText = code === 'INVALID_MOVE' ? 'THAT MOVE IS NOT LEGAL' : code === 'NOT_NEARBY' ? 'MOVE CLOSER TOGETHER' : code === 'WRONG_GAME' ? 'WRONG MATCH TYPE' : 'COULD NOT SEND THAT MOVE';
    }
  } finally { busy = false; render(); schedule(); }
}

/** Movement is fire-and-forget; attacks carry a request ID so retries cannot double-hit. */
async function sendSword(action: 'move' | 'attack' | 'block' | 'dodge', body: Record<string, unknown>): Promise<void> {
  if (spectating || !state || state.status !== 'playing' || !state.sword) return;
  const payload = action === 'move' ? body : { ...body, request_id: crypto.randomUUID() };
  try {
    const next = await duelRequest<DuelView>(`/api/world/duels/${encodeURIComponent(duelId)}/${action}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    apply(fromParticipant(next));
  } catch (error) {
    const code = codeOf(error);
    if (code === 'DUEL_FINISHED' || code === 'DUEL_NOT_FOUND') return;
    // Movement races are expected at 14 Hz; the next poll resynchronises.
  }
}
arena = new SwordArena(arenaCanvas, {
  onMove: (x, y, facing) => { void sendSword('move', { x, y, facing }); },
  onAttack: () => { void sendSword('attack', {}); },
  onBlock: () => { void sendSword('block', {}); },
  onDodge: () => { void sendSword('dodge', {}); },
});
strikeButton.addEventListener('click', () => { void sendSword('attack', {}); });
shieldButton.addEventListener('click', () => { void sendSword('block', {}); });
dodgeButton.addEventListener('click', () => { void sendSword('dodge', {}); });
for (const button of document.querySelectorAll<HTMLButtonElement>('#duel-arena-pad button')) {
  const vector: Record<string, { x: number; y: number }> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const direction = button.dataset.dir || 'up';
  const release = () => arena?.setJoystick(0, 0);
  button.addEventListener('pointerdown', event => { event.preventDefault(); arena?.setJoystick(vector[direction]!.x, vector[direction]!.y); });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}
arena.start();

if (spectating) {
  returnLink.href = '/arena';
  returnLink.textContent = 'RETURN TO ARENA';
  if (exitLink) { exitLink.href = '/arena'; exitLink.textContent = '← Back to Arena'; }
  modeLabel.textContent = 'SPECTATING · READ ONLY';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && state?.status === 'playing') void load(); });
window.addEventListener('pagehide', () => { stopped = true; if (timer) window.clearTimeout(timer); if (revealTimer) window.clearTimeout(revealTimer); arena?.destroy(); });
if (!duelId) { setStatus('THIS MATCH LINK IS INVALID', 'bad'); stopped = true; }
else void load();
export {};
