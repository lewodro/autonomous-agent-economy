/**
 * Cave client. Everything authoritative (position, health, monster state,
 * damage, rewards and defeat settlement) lives in CaveService; this page only
 * sends movement/attack/descent intents and paints the returned view.
 */
import { KeyboardInput, TouchJoystickInput } from './input.js';
import { normalizeInput, type Position, type Rect } from './model.js';
import { MAP } from './map.js';
import { SPRITES, loadSettings, saveSettings } from './sprites.js';
import { appearanceKey, appearanceSprites } from './appearance.js';
import { drawActorSprite } from './renderer.js';
import { drawCaveChest, drawCaveMonster } from './cave-art.js';
import { caveActionFor } from './cave-controls.js';

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
  monsters: Monster[]; chests: Array<{ id: string; x: number; y: number; opened: boolean }>;
  kills: number; required: number; cleared: boolean; can_descend: boolean;
  weapon: { id: string; name: string; damage: number; range: number };
  reset_at: string;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('cave-canvas'), overlay = $<HTMLDivElement>('cave-overlay');
const message = $<HTMLElement>('cave-message'), depth = $<HTMLElement>('cave-depth');
const healthFill = $<HTMLElement>('cave-health-fill'), healthText = $<HTMLElement>('cave-health-text');
const hint = $<HTMLElement>('cave-hint'), notice = $<HTMLElement>('cave-notice');
const monstersText = $<HTMLElement>('cave-monsters'), weaponText = $<HTMLElement>('cave-weapon');
const actionButton = $<HTMLButtonElement>('cave-action'), attackButton = $<HTMLButtonElement>('cave-attack');
const keyboard = new KeyboardInput(canvas);
const touch = new TouchJoystickInput($('cave-joystick'), $('cave-joystick-knob'), actionButton);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const ctx = canvas.getContext('2d')!;
const mask = document.createElement('canvas'); mask.width = canvas.width; mask.height = canvas.height;
const maskCtx = mask.getContext('2d')!;
const VIEW_W = canvas.width, VIEW_H = canvas.height;
// The cave is part of the same world session, so it renders the exact saved
// visitor appearance instead of a generic placeholder.
const settings = loadSettings();
const playerAppearance = settings.appearance;
const playerSprite = SPRITES.find(sprite => sprite.id === settings.avatar);
const playerImage = new Image();
if (playerSprite) playerImage.src = playerSprite.sheet;
if (playerAppearance) appearanceSprites.preload(playerAppearance);
canvas.dataset.appearance = playerAppearance ? appearanceKey(playerAppearance) : `preset:${settings.avatar}`;
canvas.dataset.monsterSprites = 'pixel';
let config: Config | null = null, view: View | null = null;
let local: Position = { x: 0, y: 0 }, camera: Position = { x: 0, y: 0 };
let lastFrame = performance.now(), lastMove = 0, lastPoll = 0, lastAttack = 0, sequence = 0;
let stopped = false, movePending = false, noticeUntil = 0, moving = false;
let moveTarget: Position | null = null;
let attackTargetId: string | null = null;
let interactTarget: { kind: 'chest' | 'exit' | 'descent'; id?: string } | null = null;
let targetStuck = 0, targetDistance = Infinity;

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
  canvas.dataset.monsters = next.monsters.map(monster => monster.kind).join(',');
  healthFill.style.width = `${Math.max(0, Math.round(next.player.hp / next.player.max_hp * 100))}%`;
  healthText.textContent = `${next.player.hp} / ${next.player.max_hp}`;
  monstersText.textContent = `MONSTERS ${next.kills} / ${next.required}`;
  weaponText.textContent = next.weapon ? next.weapon.name.toUpperCase() : 'STARTER BLADE';
  const current = level();
  const chest = nearbyChest();
  const exit = Boolean(current?.exit && Math.hypot(local.x - current.exit.x, local.y - current.exit.y) < 64);
  const descent = Boolean(current?.descent && Math.hypot(local.x - current.descent.x, local.y - current.descent.y) < 64);
  const choice = caveActionFor({ chest: Boolean(chest), exit, descent, monster: Boolean(nearbyMonster()) });
  if (choice === 'chest') {
    actionButton.textContent = 'E · CHEST';
    hint.textContent = 'Press E or click the chest to open it. Chests hold the cave-only blades.';
  } else if (choice === 'exit') {
    actionButton.textContent = 'E · EXIT';
    hint.textContent = 'Press E to leave through the entrance. Your outside position is saved.';
  } else if (choice === 'descent') {
    actionButton.textContent = next.cleared ? 'E · DESCEND' : 'PASSAGE SEALED';
    hint.textContent = next.cleared
      ? 'Press E to take the descending passage. Deeper means darker and harder.'
      : `Clear the floor first: ${next.kills} / ${next.required} monsters defeated.`;
  } else if (choice === 'attack') {
    actionButton.textContent = 'E · STRIKE';
    hint.textContent = 'Press E or click the monster to strike. Keep the floor clear to open the passage.';
  } else {
    actionButton.textContent = 'E · ACTION';
    hint.textContent = config ? 'WASD / arrows or click to move · click a monster to attack · E interacts or strikes' : 'Loading cave…';
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
  for (const chest of view?.chests ?? []) drawCaveChest(ctx, chest, time, reduced.matches);
  for (const monster of view?.monsters ?? []) drawCaveMonster(ctx, monster, time, reduced.matches);
  ctx.fillStyle = '#050a0880';
  ctx.beginPath(); ctx.ellipse(Math.round(local.x), Math.round(local.y + 8), 14, 5, 0, 0, Math.PI * 2); ctx.fill();
  const facing = (view?.player.facing ?? 'down') as 'up' | 'down' | 'left' | 'right';
  const composed = playerAppearance ? appearanceSprites.sheet(playerAppearance) ?? undefined : undefined;
  drawActorSprite(ctx, playerSprite, playerImage, { position: local, facing, movementState: moving ? 'walking' : 'idle' },
    time, reduced.matches, 44, composed);
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
function nearbyChest(): View['chests'][number] | null {
  return view?.chests.find(chest => !chest.opened
    && Math.hypot(local.x - chest.x, local.y - chest.y) < 64) ?? null;
}
function nearbyMonster(): Monster | null {
  if (!view) return null;
  const range = view.weapon?.range ?? 62;
  return view.monsters.filter(monster => monster.alive
    && Math.hypot(local.x - monster.x, local.y - monster.y) <= range)
    .sort((a, b) => Math.hypot(a.x - local.x, a.y - local.y) - Math.hypot(b.x - local.x, b.y - local.y))[0] ?? null;
}
async function action(): Promise<void> {
  const current = level(); if (!current || !view || view.status !== 'playing' || stopped) return;
  const chest = nearbyChest();
  const exit = Boolean(current.exit && Math.hypot(local.x - current.exit.x, local.y - current.exit.y) < 64);
  const descent = Boolean(current.descent && Math.hypot(local.x - current.descent.x, local.y - current.descent.y) < 64);
  const choice = caveActionFor({ chest: Boolean(chest), exit, descent, monster: Boolean(nearbyMonster()) });
  if (choice === 'chest' && chest) { await send('chest', { chest_id: chest.id }); return; }
  if (choice === 'exit') {
    await request(`/api/world/cave/exit`, { run_id: view.run_id });
    stopped = true; location.assign('/world?return=cave');
  } else if (choice === 'descent') {
    if (!view.cleared) { flash(`PASSAGE SEALED · MONSTERS ${view.kills} / ${view.required}`); return; }
    await send('descend', {});
  } else if (choice === 'attack') await attack();
  else flash('NO EXIT, CHEST, PASSAGE OR MONSTER IN REACH');
}
function clearTargets(): void {
  moveTarget = null; attackTargetId = null; interactTarget = null;
  targetStuck = 0; targetDistance = Infinity;
}
function walkToward(target: Position, step: number): boolean {
  const dx = target.x - local.x, dy = target.y - local.y, distance = Math.hypot(dx, dy);
  if (distance <= 3) return true;
  const moveX = dx / distance * step, moveY = dy / distance * step;
  const nx = { x: local.x + moveX, y: local.y };
  if (walkable(nx)) local.x = nx.x;
  const ny = { x: local.x, y: local.y + moveY };
  if (walkable(ny)) local.y = ny.y;
  return Math.hypot(target.x - local.x, target.y - local.y) <= 4;
}
function queueMove(time: number, facing: string): void {
  const current = view; if (!current || time - lastMove <= 100 || movePending) return;
  lastMove = time; movePending = true;
  void request<View>('/api/world/cave/move', {
    run_id: current.run_id, x: Math.round(local.x), y: Math.round(local.y), facing,
  }).then(next => {
    if (stopped) return;
    applyView(next);
    if (Math.hypot(next.player.x - local.x, next.player.y - local.y) > 24) local = { x: next.player.x, y: next.player.y };
  }).catch(() => {}).finally(() => { movePending = false; });
}
function facingFor(target: Position): string {
  const dx = target.x - local.x, dy = target.y - local.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
function pointerTarget(event: PointerEvent): void {
  if (!view || view.status !== 'playing' || stopped || event.button !== 0) return;
  canvas.focus({ preventScroll: true });
  const box = canvas.getBoundingClientRect();
  const point = {
    x: camera.x + (event.clientX - box.left) * VIEW_W / Math.max(1, box.width),
    y: camera.y + (event.clientY - box.top) * VIEW_H / Math.max(1, box.height),
  };
  const monster = view.monsters
    .filter(value => value.alive && Math.hypot(value.x - point.x, value.y - point.y) < 26)
    .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
  if (monster) {
    attackTargetId = monster.id; moveTarget = { x: monster.x, y: monster.y }; interactTarget = null;
    targetStuck = 0; targetDistance = Infinity;
    return;
  }
  const chest = view.chests
    .filter(value => !value.opened && Math.hypot(value.x - point.x, value.y - point.y) < 26)
    .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y))[0];
  if (chest) {
    interactTarget = { kind: 'chest', id: chest.id }; moveTarget = { x: chest.x, y: chest.y }; attackTargetId = null;
    targetStuck = 0; targetDistance = Infinity;
    return;
  }
  const current = level();
  if (current?.exit && Math.hypot(current.exit.x - point.x, current.exit.y - point.y) < 30) {
    interactTarget = { kind: 'exit' }; moveTarget = { ...current.exit }; attackTargetId = null;
    targetStuck = 0; targetDistance = Infinity;
    return;
  }
  if (current?.descent && Math.hypot(current.descent.x - point.x, current.descent.y - point.y) < 30) {
    interactTarget = { kind: 'descent' }; moveTarget = { ...current.descent }; attackTargetId = null;
    targetStuck = 0; targetDistance = Infinity;
    return;
  }
  attackTargetId = null; interactTarget = null; moveTarget = point;
  targetStuck = 0; targetDistance = Infinity;
}
function frame(time: number): void {
  if (stopped) return;
  const dt = Math.min(.05, (time - lastFrame) / 1000); lastFrame = time;
  const k = keyboard.read(), t = touch.read();
  const input = normalizeInput(k.x + t.x, k.y + t.y, k.interact || t.interact);
  moving = false;
  if (view?.status === 'playing' && (input.x || input.y)) {
    clearTargets();
    const step = Math.min(7, 150 * dt);
    const nx = { x: local.x + input.x * step, y: local.y };
    if (walkable(nx)) local.x = nx.x;
    const ny = { x: local.x, y: local.y + input.y * step };
    if (walkable(ny)) local.y = ny.y;
    moving = true;
    camera = cameraFor(local);
    const facing = Math.abs(input.x) > Math.abs(input.y) ? (input.x > 0 ? 'right' : 'left') : (input.y > 0 ? 'down' : 'up');
    queueMove(time, facing);
  } else if (view?.status === 'playing' && (attackTargetId || moveTarget)) {
    let target: Position | null = moveTarget;
    if (attackTargetId) {
      const monster = view.monsters.find(value => value.id === attackTargetId && value.alive);
      if (!monster) { clearTargets(); target = null; }
      else { target = { x: monster.x, y: monster.y }; moveTarget = target; }
    }
    if (target) {
      const distance = Math.hypot(target.x - local.x, target.y - local.y);
      const range = view.weapon?.range ?? 62;
      if (attackTargetId && distance <= range) {
        moving = false;
        void attack();
      } else {
        const step = Math.min(7, 150 * dt);
        const before = { ...local };
        const reached = walkToward(target, step);
        const travelled = Math.hypot(local.x - before.x, local.y - before.y);
        moving = travelled > 0.01;
        if (moving) { camera = cameraFor(local); queueMove(time, facingFor(target)); }
        if (distance >= targetDistance - 0.5) targetStuck += dt; else { targetStuck = 0; targetDistance = distance; }
        if (targetStuck > 1.1) { clearTargets(); }
        else if (reached && !attackTargetId) {
          const pending = interactTarget;
          clearTargets();
          if (pending) void action();
        }
      }
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
canvas.addEventListener('pointerdown', pointerTarget);
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
