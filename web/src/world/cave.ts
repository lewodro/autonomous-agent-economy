/**
 * Cave client. Everything authoritative (position, health, monster state,
 * damage, rewards and defeat settlement) lives in CaveService; this page only
 * sends movement/attack/descent intents and paints the returned view.
 */
import { KeyboardInput, TouchJoystickInput } from './input.js';
import { normalizeInput, type Position, type Rect } from './model.js';
import { MAP } from './map.js';
import { loadSettings, saveSettings } from './sprites.js';

interface RectLike extends Rect {}
interface Torch { x: number; y: number; radius: number }
interface Prop { kind: string; x: number; y: number }
interface Level {
  level: number; name: string; ambient: number; bounds: RectLike; entry: Position;
  exit: Position | null; descent: Position | null; rooms: RectLike[];
  torches: Torch[]; props: Prop[]; monster_kinds: Array<{ id: string; kind: string; boss: boolean }>;
}
interface Config {
  reset_ms: number; attack_range: number; attack_damage: number; max_hp: number; levels: Level[];
}
interface Monster {
  id: string; kind: string; boss: boolean; x: number; y: number; hp: number;
  max_hp: number; alive: boolean; state: string;
}
interface View {
  run_id: string; level: number; level_name: string; status: 'playing' | 'exited' | 'dead';
  player: Position & { facing: string; hp: number; max_hp: number };
  monsters: Monster[]; reset_at: string;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cave-canvas'), overlay = $<HTMLDivElement>('cave-overlay');
const message = $<HTMLElement>('cave-message'), depth = $<HTMLElement>('cave-depth');
const healthFill = $<HTMLElement>('cave-health-fill'), healthText = $<HTMLElement>('cave-health-text');
const hint = $<HTMLElement>('cave-hint'), notice = $<HTMLElement>('cave-notice');
const actionButton = $<HTMLButtonElement>('cave-action'), attackButton = $<HTMLButtonElement>('cave-attack');
const keyboard = new KeyboardInput(canvas);
const touch = new TouchJoystickInput($('cave-joystick'), $('cave-joystick-knob'), actionButton);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const ctx = canvas.getContext('2d')!;
const mask = document.createElement('canvas'); mask.width = canvas.width; mask.height = canvas.height;
const maskCtx = mask.getContext('2d')!;
const VIEW_W = canvas.width, VIEW_H = canvas.height;
let config: Config | null = null, view: View | null = null;
let local: Position = { x: 0, y: 0 }, camera: Position = { x: 0, y: 0 };
let lastFrame = performance.now(), lastMove = 0, lastPoll = 0, lastAttack = 0, sequence = 0;
let stopped = false, movePending = false, noticeUntil = 0;

async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(6_000),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error || 'Cave request failed');
  return data;
}
function level(): Level | null { return config?.levels.find(value => value.level === view?.level) ?? null; }
function walkable(point: Position, radius = 12): boolean {
  return Boolean(level()?.rooms.some(room => point.x >= room.x + radius && point.x <= room.x + room.width - radius
    && point.y >= room.y + radius && point.y <= room.y + room.height - radius));
}
function flash(text: string): void { notice.textContent = text; noticeUntil = performance.now() + 1600; }
function showOverlay(text: string, returnLabel: string): void {
  message.textContent = text;
  const link = $<HTMLAnchorElement>('cave-return'); link.textContent = returnLabel;
  overlay.hidden = false;
}
function applyView(next: View): void {
  const changedLevel = !view || view.level !== next.level;
  view = next;
  if (changedLevel) { local = { x: next.player.x, y: next.player.y }; camera = cameraFor(local); }
  depth.textContent = `CAVE · LEVEL ${next.level} · ${next.level_name}`;
  healthFill.style.width = `${Math.max(0, Math.round(next.player.hp / next.player.max_hp * 100))}%`;
  healthText.textContent = `${next.player.hp} / ${next.player.max_hp}`;
  const current = level();
  if (current?.exit && Math.hypot(local.x - current.exit.x, local.y - current.exit.y) < 64) {
    actionButton.textContent = 'E · EXIT';
    hint.textContent = 'Press E to leave through the entrance. Your outside position is saved.';
  } else if (current?.descent && Math.hypot(local.x - current.descent.x, local.y - current.descent.y) < 64) {
    actionButton.textContent = 'E · DESCEND';
    hint.textContent = 'Press E to take the descending passage. Deeper means darker and harder.';
  } else {
    actionButton.textContent = 'E · ACTION';
    hint.textContent = config ? 'WASD / arrows to move · ATTACK when a monster is close · find the passage' : 'Loading cave…';
  }
  if (next.status === 'dead') {
    const settings = loadSettings(); settings.position = { ...MAP.spawn }; saveSettings(settings);
    showOverlay('DEFEATED · RETURNING TO THE PLAZA · ALL INTERNAL GAME CREDITS LOST', 'RETURN TO PLAZA');
    $<HTMLAnchorElement>('cave-return').href = '/world';
    setTimeout(() => { if (!stopped) location.assign('/world'); }, reduced.matches ? 0 : 900);
    stopped = true;
  } else if (next.status === 'exited') {
    showOverlay('CAVE RUN ENDED', 'RETURN TO WORLD');
    stopped = true;
  }
}
function cameraFor(point: Position): Position {
  const current = level();
  const maxX = Math.max(0, (current?.bounds.width ?? VIEW_W) - VIEW_W), maxY = Math.max(0, (current?.bounds.height ?? VIEW_H) - VIEW_H);
  return { x: Math.max(0, Math.min(maxX, point.x - VIEW_W / 2)), y: Math.max(0, Math.min(maxY, point.y - VIEW_H / 2)) };
}
function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function drawScene(time: number): void {
  const current = level(); if (!current) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  rect(ctx, 0, 0, VIEW_W, VIEW_H, '#080c0a');
  ctx.save(); ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  for (const room of current.rooms) {
    rect(ctx, room.x, room.y, room.width, room.height, '#1d251f');
    ctx.strokeStyle = '#2c3b31'; ctx.lineWidth = 2;
    ctx.strokeRect(room.x + 1, room.y + 1, room.width - 2, room.height - 2);
    for (let x = room.x + 12; x < room.x + room.width; x += 28) for (let y = room.y + 12; y < room.y + room.height; y += 28) {
      if ((x + y) % 84 === 0) rect(ctx, x, y, 3, 2, '#2a352c');
    }
  }
  for (const prop of current.props) {
    const color = prop.kind === 'crystal' ? '#7fc7d9' : prop.kind === 'bones' ? '#c8c4a9'
      : prop.kind === 'crate' ? '#8b6b46' : prop.kind === 'pillar' ? '#46534a' : '#596058';
    rect(ctx, prop.x - 8, prop.y - 6, 16, 12, color);
    rect(ctx, prop.x - 6, prop.y - 10, 12, 5, prop.kind === 'crystal' ? '#b6e8f2' : '#39443c');
  }
  for (const [index, torch] of current.torches.entries()) {
    const flicker = reduced.matches ? 1 : 1 + 0.03 * Math.sin(time / 130 + index * 1.7);
    const radius = torch.radius * flicker;
    const glow = ctx.createRadialGradient(torch.x, torch.y, 2, torch.x, torch.y, radius);
    glow.addColorStop(0, '#f8d98a66'); glow.addColorStop(1, '#f8d98000');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(torch.x, torch.y, radius, 0, Math.PI * 2); ctx.fill();
    rect(ctx, torch.x - 3, torch.y - 2, 6, 14, '#4a3b2b');
    rect(ctx, torch.x - 2, torch.y - 8 - (reduced.matches ? 0 : Math.floor(time / 160) % 2), 4, 7, '#ffd27a');
  }
  if (current.descent) {
    rect(ctx, current.descent.x - 18, current.descent.y - 12, 36, 24, '#39493c');
    rect(ctx, current.descent.x - 12, current.descent.y - 7, 24, 14, '#141b16');
  }
  if (current.exit) {
    rect(ctx, current.exit.x - 16, current.exit.y - 10, 32, 20, '#53614b');
    rect(ctx, current.exit.x - 10, current.exit.y - 7, 20, 14, '#1a241c');
  }
  for (const monster of view?.monsters ?? []) {
    if (!monster.alive) {
      rect(ctx, monster.x - 7, monster.y + 3, 14, 4, '#384039');
      continue;
    }
    const color = monster.state === 'attack' ? '#e07b62' : monster.state === 'chase' ? '#c9a35c'
      : monster.kind === 'bat' ? '#8d7aa6' : monster.kind === 'stone' ? '#7f8a83' : '#9c6d5b';
    const size = monster.boss ? 22 : monster.kind === 'stone' ? 16 : 12;
    rect(ctx, monster.x - size / 2, monster.y - size / 2, size, size, color);
    rect(ctx, monster.x - size / 2, monster.y - size / 2 - 5, size * (monster.hp / monster.max_hp), 3, '#d96b57');
    if (monster.kind === 'bat' && !reduced.matches) {
      const flap = Math.floor(time / 110) % 2 ? 3 : 0;
      rect(ctx, monster.x - size / 2 - 5, monster.y - 4 - flap, 5, 3, color);
      rect(ctx, monster.x + size / 2, monster.y - 4 - flap, 5, 3, color);
    }
  }
  rect(ctx, local.x - 7, local.y - 9, 14, 18, '#f0dfb4');
  rect(ctx, local.x - 4, local.y - 6, 8, 6, '#263a30');
  const facing = view?.player.facing ?? 'down';
  rect(ctx, local.x + (facing === 'right' ? 7 : facing === 'left' ? -9 : facing === 'up' ? -2 : -2),
    local.y + (facing === 'down' ? 8 : facing === 'up' ? -12 : -4), 4, 4, '#f0cf75');
  ctx.restore();

  // One small darkness mask: solid ambient black with soft destination-out
  // holes around the visitor and torches. No real-time lighting engine.
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  maskCtx.clearRect(0, 0, VIEW_W, VIEW_H);
  maskCtx.fillStyle = `rgba(2,5,4,${Math.min(0.97, 1 - current.ambient)})`;
  maskCtx.fillRect(0, 0, VIEW_W, VIEW_H);
  maskCtx.globalCompositeOperation = 'destination-out';
  const cut = (x: number, y: number, radius: number, strength: number) => {
    const gradient = maskCtx.createRadialGradient(x, y, radius * 0.18, x, y, radius);
    gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
    gradient.addColorStop(0.65, `rgba(0,0,0,${strength * 0.7})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    maskCtx.fillStyle = gradient; maskCtx.beginPath(); maskCtx.arc(x, y, radius, 0, Math.PI * 2); maskCtx.fill();
  };
  cut(local.x - camera.x, local.y - camera.y, 96, 1);
  for (const [index, torch] of current.torches.entries()) {
    const flicker = reduced.matches ? 1 : 1 + 0.035 * Math.sin(time / 150 + index * 2.1);
    cut(torch.x - camera.x, torch.y - camera.y, torch.radius * flicker, 0.94);
  }
  maskCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(mask, 0, 0);
}
async function send(action: string, body: Record<string, unknown>): Promise<void> {
  if (!view) return;
  try { applyView(await request<View>(`/api/world/cave/${action}`, { run_id: view.run_id, ...body })); }
  catch (error) { if (error instanceof Error) flash(error.message.toUpperCase()); }
}
async function attack(): Promise<void> {
  if (!view || view.status !== 'playing' || stopped || performance.now() - lastAttack < 420) return;
  lastAttack = performance.now();
  await send('attack', { request_id: `strike-${Date.now()}-${++sequence}` });
}
async function action(): Promise<void> {
  const current = level(); if (!current || !view || view.status !== 'playing' || stopped) return;
  if (current.exit && Math.hypot(local.x - current.exit.x, local.y - current.exit.y) < 64) {
    await request(`/api/world/cave/exit`, { run_id: view.run_id });
    stopped = true; location.assign('/world?return=cave');
  } else if (current.descent && Math.hypot(local.x - current.descent.x, local.y - current.descent.y) < 64) {
    await send('descend', {});
  } else flash('NO EXIT OR PASSAGE HERE');
}
function frame(time: number): void {
  if (stopped) return;
  const dt = Math.min(.05, (time - lastFrame) / 1000); lastFrame = time;
  const k = keyboard.read(), t = touch.read();
  const input = normalizeInput(k.x + t.x, k.y + t.y, k.interact || t.interact);
  if (view?.status === 'playing' && (input.x || input.y)) {
    const step = Math.min(7, 150 * dt);
    const nx = { x: local.x + input.x * step, y: local.y };
    if (walkable(nx)) local.x = nx.x;
    const ny = { x: local.x, y: local.y + input.y * step };
    if (walkable(ny)) local.y = ny.y;
    camera = cameraFor(local);
    if (time - lastMove > 100 && !movePending) {
      lastMove = time; movePending = true;
      void request<View>('/api/world/cave/move', {
        run_id: view.run_id, x: Math.round(local.x), y: Math.round(local.y),
        facing: Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'right' : 'left') : (input.y > 0 ? 'down' : 'up'),
      }).then(next => { if (!stopped) applyView(next); if (Math.hypot(next.player.x - local.x, next.player.y - local.y) > 24) local = { x: next.player.x, y: next.player.y }; })
        .catch(() => {}).finally(() => { movePending = false; });
    }
  }
  if (input.interact) void action();
  if (time - lastPoll > 700 && !movePending && view?.status === 'playing') {
    lastPoll = time;
    void request<{ run: View | null }>('/api/world/cave').then(result => { if (result.run && !stopped) applyView(result.run); }).catch(() => {});
  }
  if (noticeUntil && time > noticeUntil) { notice.textContent = ''; noticeUntil = 0; }
  drawScene(time);
  requestAnimationFrame(frame);
}
attackButton.addEventListener('click', () => void attack());
window.addEventListener('pagehide', () => { stopped = true; keyboard.read(); touch.destroy(); });

try {
  config = await request<Config>('/api/world/cave/config');
  const result = await request<{ run: View | null }>('/api/world/cave');
  if (!result.run) {
    showOverlay('NO ACTIVE CAVE RUN · ENTER A CAVE FROM THE WORLD', 'RETURN TO WORLD');
    stopped = true;
  } else {
    applyView(result.run);
    document.body.dataset.caveReady = '1';
    requestAnimationFrame(frame);
  }
} catch {
  showOverlay('THE CAVE IS UNAVAILABLE · TRY AGAIN', 'RETURN TO WORLD');
  stopped = true;
}
