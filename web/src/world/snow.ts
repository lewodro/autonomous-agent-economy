/**
 * Frostgate snow scene. The northern pass leads to this small, self-contained
 * destination. It reuses the shared input, appearance and sprite helpers, but
 * keeps its own local map, collision and landmarks so crossing the pass needs
 * no new server authority and no second world renderer.
 */
import { KeyboardInput, TouchJoystickInput } from './input.js';
import { normalizeInput, type Position, type Rect } from './model.js';
import { SPRITES, loadSettings } from './sprites.js';
import { appearanceKey, appearanceSprites } from './appearance.js';
import { drawActorSprite } from './renderer.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('snow-canvas');
const ctx = canvas.getContext('2d')!;
const toast = $<HTMLDivElement>('snow-toast');
const positionText = $<HTMLElement>('snow-position');
const landmarkText = $<HTMLElement>('snow-landmarks');
const actionButton = $<HTMLButtonElement>('snow-action');
const keyboard = new KeyboardInput(canvas);
const touch = new TouchJoystickInput($('snow-joystick'), $('snow-joystick-knob'), actionButton);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

const VIEW_W = canvas.width, VIEW_H = canvas.height;
/** The snowfield is deliberately compact: a destination, not a second world. */
const WORLD = { width: 1120, height: 860 };
const SPAWN: Position = { x: 560, y: 748 };
const RETURN: Position = { x: 560, y: 812 };
const RETURN_RADIUS = 52;
const WALK_SPEED = 118;
const FOOT_RADIUS = 12;
const LANDMARK_STORAGE_KEY = 'agent-world-snow-landmarks-v1';

interface Landmark { id: string; label: string; position: Position; radius: number; note: string }
const LANDMARKS: Landmark[] = [
  { id: 'frozen-shrine', label: 'FROZEN SHRINE', position: { x: 286, y: 348 }, radius: 68,
    note: 'A rune-cut stone stands clear of the drift. The bowl at its foot is filled with clear ice.' },
  { id: 'ice-circle', label: 'ICE CIRCLE', position: { x: 836, y: 352 }, radius: 68,
    note: 'A ring of pale stones surrounds a frozen pool. Something dark rests beneath the centre.' },
  { id: 'watch-beacon', label: 'WATCH BEACON', position: { x: 560, y: 186 }, radius: 72,
    note: 'The old beacon is cold, but its lens is clean. Someone still climbs here to watch the pass.' },
];

/** The snowfield is bounded by cliffs, with one open gate back to the pass. */
const OBSTACLES: Rect[] = [
  { x: 0, y: 0, width: WORLD.width, height: 118 },
  { x: 0, y: 0, width: 74, height: WORLD.height },
  { x: WORLD.width - 74, y: 0, width: 74, height: WORLD.height },
  { x: 0, y: WORLD.height - 44, width: 500, height: 44 },
  { x: 620, y: WORLD.height - 44, width: WORLD.width - 620, height: 44 },
];

const settings = loadSettings();
const playerAppearance = settings.appearance;
const playerSprite = SPRITES.find(sprite => sprite.id === settings.avatar);
const playerImage = new Image();
if (playerSprite) playerImage.src = playerSprite.sheet;
if (playerAppearance) appearanceSprites.preload(playerAppearance);
canvas.dataset.appearance = playerAppearance ? appearanceKey(playerAppearance) : `preset:${settings.avatar}`;

function loadInspected(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(LANDMARK_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === 'string' && LANDMARKS.some(site => site.id === id)));
  } catch { return new Set(); }
}
const inspected = loadInspected();
let local: Position = { ...SPAWN };
let camera: Position = { x: 0, y: 0 };
let facing: 'up' | 'down' | 'left' | 'right' = 'up';
let moving = false, stopped = false, lastFrame = performance.now();
let moveTarget: Position | null = null, toastUntil = 0;
let snowfall: Array<{ x: number; y: number; speed: number; drift: number; size: number }> = [];

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function blocked(x: number, y: number): boolean {
  return OBSTACLES.some(rect => x + FOOT_RADIUS > rect.x && x - FOOT_RADIUS < rect.x + rect.width
    && y + FOOT_RADIUS > rect.y && y - FOOT_RADIUS < rect.y + rect.height);
}
function walkable(x: number, y: number): boolean {
  return x >= 0 && x <= WORLD.width && y >= 0 && y <= WORLD.height && !blocked(x, y);
}
function cameraFor(point: Position): Position {
  return {
    x: clamp(point.x - VIEW_W / 2, 0, Math.max(0, WORLD.width - VIEW_W)),
    y: clamp(point.y - VIEW_H / 2, 0, Math.max(0, WORLD.height - VIEW_H)),
  };
}
function distance(a: Position, b: Position): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function nearestLandmark(): Landmark | null {
  return LANDMARKS
    .filter(site => distance(local, site.position) <= site.radius)
    .sort((a, b) => distance(local, a.position) - distance(local, b.position))[0] ?? null;
}
function inReturnGate(): boolean { return distance(local, RETURN) <= RETURN_RADIUS; }
function flash(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  toastUntil = performance.now() + 4200;
}
function updateHud(): void {
  positionText.textContent = `X ${Math.round(local.x)} · Y ${Math.round(local.y)}`;
  landmarkText.textContent = `LANDMARKS ${inspected.size} / ${LANDMARKS.length}`;
  const site = nearestLandmark();
  canvas.dataset.player = `${Math.round(local.x)},${Math.round(local.y)}`;
  canvas.dataset.landmarks = [...inspected].join(',');
  canvas.dataset.nearest = site?.id ?? '';
  canvas.dataset.return = inReturnGate() ? '1' : '0';
  if (inReturnGate()) actionButton.textContent = 'E · RETURN TO WORLD';
  else if (site) actionButton.textContent = 'E · INSPECT';
  else actionButton.textContent = 'E · LOOK';
}
function persistLandmarks(): void {
  try { localStorage.setItem(LANDMARK_STORAGE_KEY, JSON.stringify([...inspected])); } catch { /* local play still works */ }
}
function returnToWorld(): void {
  if (stopped) return;
  stopped = true;
  keyboard.destroy();
  touch.destroy();
  location.assign('/world?return=snow');
}
function interact(): void {
  if (stopped) return;
  if (inReturnGate()) { returnToWorld(); return; }
  const site = nearestLandmark();
  if (!site) { flash('NOTHING WITHIN REACH · FOLLOW THE TRAIL NORTH'); return; }
  const first = !inspected.has(site.id);
  inspected.add(site.id);
  persistLandmarks();
  updateHud();
  flash(`${first ? 'RECORDED · ' : ''}${site.label} · ${site.note}`);
}

function rect(x: number, y: number, width: number, height: number, color: string): void {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}
function paintStatic(): HTMLCanvasElement {
  const surface = document.createElement('canvas');
  surface.width = WORLD.width; surface.height = WORLD.height;
  const c = surface.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const paint = (x: number, y: number, width: number, height: number, color: string): void => {
    c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  };
  // Snowfield base and broad, softly banded drifts.
  paint(0, 0, WORLD.width, WORLD.height, '#dbe8ef');
  const bands: Array<[number, number, number, number, string]> = [
    [0, 110, WORLD.width, 250, '#cfdfe8'], [0, 360, WORLD.width, 220, '#c7d9e3'],
    [0, 580, WORLD.width, 180, '#d2e2ea'], [0, 760, WORLD.width, 100, '#c0d3de'],
    [80, 120, 360, 300, '#c3d5df'], [680, 110, 360, 330, '#c0d2dd'],
  ];
  for (const [x, y, width, height, color] of bands) paint(x, y, width, height, color);
  // A faint 32px dither keeps the same authored pixel texture as the overworld.
  for (let y = 8; y < WORLD.height; y += 32) {
    for (let x = 8; x < WORLD.width; x += 32) {
      const tone = (x * 31 + y * 17) % 5;
      if (tone < 2) paint(x + (tone ? 6 : 0), y + (tone ? 10 : 0), 8, 4, tone ? '#e7f1f6' : '#c8dae4');
    }
  }
  // The packed trail from the southern gate to the beacon.
  paint(548, 300, 44, 560, '#b2c5d0');
  paint(520, 760, 100, 100, '#aebfc9');
  paint(552, 300, 20, 560, '#c1d2db');
  for (let y = 340; y < 820; y += 46) paint(548 + (y % 3) * 6, y, 34, 5, '#9fb4c1');
  // Cliff walls and snow caps.
  paint(0, 0, WORLD.width, 118, '#52646e');
  paint(0, 96, WORLD.width, 22, '#6b7d87');
  paint(0, 0, 74, WORLD.height, '#4c5d67');
  paint(60, 0, 14, WORLD.height, '#667882');
  paint(WORLD.width - 74, 0, 74, WORLD.height, '#4c5d67');
  paint(WORLD.width - 74, 0, 14, WORLD.height, '#667882');
  paint(0, 0, WORLD.width, 34, '#e9f4f8');
  paint(0, 34, WORLD.width, 10, '#d3e3ea');
  paint(0, WORLD.height - 44, 500, 44, '#4c5d67');
  paint(620, WORLD.height - 44, WORLD.width - 620, 44, '#4c5d67');
  paint(0, WORLD.height - 44, 500, 12, '#e3eff4');
  paint(620, WORLD.height - 44, WORLD.width - 620, 12, '#e3eff4');
  // A carved gate marks the only way back south.
  paint(500, WORLD.height - 54, 120, 54, '#5a6b74');
  paint(506, WORLD.height - 60, 108, 12, '#e8f3f7');
  paint(516, WORLD.height - 48, 12, 48, '#74858e');
  paint(592, WORLD.height - 48, 12, 48, '#74858e');
  paint(516, WORLD.height - 26, 88, 26, '#22333b');
  paint(548, WORLD.height - 40, 24, 6, '#a9c6d4');
  // Dark pines frame the field without closing the routes.
  const pines: Array<[number, number, number]> = [
    [150, 210, 1], [196, 470, .85], [116, 620, .9], [330, 690, .8],
    [940, 210, 1.05], [996, 470, .9], [1010, 660, .85], [760, 700, .8],
    [400, 160, .7], [700, 150, .75],
  ];
  for (const [x, y, scale] of pines) {
    paint(x - 4 * scale, y - 8 * scale, 8 * scale, 18 * scale, '#4a3f3a');
    paint(x - 22 * scale, y - 30 * scale, 44 * scale, 12 * scale, '#2c4b4a');
    paint(x - 16 * scale, y - 46 * scale, 32 * scale, 16 * scale, '#335955');
    paint(x - 10 * scale, y - 60 * scale, 20 * scale, 14 * scale, '#3c6560');
    paint(x - 8 * scale, y - 58 * scale, 16 * scale, 4 * scale, '#e7f2f6');
  }
  // Frozen shrine: leaning stone, rune face and an iced offering bowl.
  paint(268, 330, 36, 44, '#7d8b92'); paint(274, 326, 24, 10, '#e8f3f7');
  paint(276, 350, 4, 18, '#9fb6c2'); paint(292, 344, 3, 12, '#bcd7e2');
  paint(258, 372, 56, 8, '#a9bcc7'); paint(250, 380, 72, 6, '#c7d8e1');
  paint(266, 362, 40, 10, '#8fa3ae'); paint(276, 364, 20, 5, '#d8e9f1');
  paint(254, 318, 5, 12, '#6b7d87'); paint(314, 324, 4, 10, '#6b7d87');
  // Ice circle: pale ring stones around a frozen pool.
  paint(806, 348, 60, 44, '#9fbccb');
  paint(818, 356, 36, 28, '#bfdce8');
  paint(826, 362, 20, 14, '#dff1f7');
  paint(790, 342, 12, 12, '#8fa7b3'); paint(862, 340, 14, 12, '#8fa7b3');
  paint(800, 388, 14, 10, '#8fa7b3'); paint(860, 386, 12, 12, '#8fa7b3');
  paint(818, 372, 4, 6, '#5c7b8b'); paint(846, 366, 3, 5, '#5c7b8b');
  // Watch beacon: a squat tower with a cold lens.
  paint(536, 168, 48, 56, '#687a84'); paint(530, 160, 60, 12, '#e6f1f6');
  paint(542, 176, 8, 44, '#84969f'); paint(570, 176, 8, 44, '#84969f');
  paint(550, 194, 20, 18, '#2e4750'); paint(554, 198, 12, 10, '#a9d4e2');
  paint(558, 201, 4, 4, '#e6f7fd');
  paint(528, 220, 64, 8, '#9fb2bc'); paint(520, 228, 80, 6, '#c2d4dd');
  // Exposed rock, frozen shrubs and thin ice keep the open field from reading
  // as empty snow without turning the destination into a second world.
  paint(400, 500, 30, 12, '#8ea3ae'); paint(408, 494, 14, 8, '#b9ccd6');
  paint(676, 548, 26, 10, '#8ea3ae'); paint(682, 542, 12, 7, '#b9ccd6');
  paint(190, 760, 52, 10, '#b6c9d4'); paint(890, 736, 64, 12, '#b6c9d4');
  const stones: Array<[number, number]> = [[120, 178], [982, 202], [110, 700], [1002, 706], [382, 300], [724, 322], [300, 812], [820, 818]];
  for (const [x, y] of stones) {
    paint(x - 8, y - 4, 16, 10, '#6c7f88');
    paint(x - 4, y - 8, 9, 6, '#8498a1');
    paint(x - 6, y - 7, 10, 3, '#e3eff4');
  }
  const shrubs: Array<[number, number]> = [[240, 540], [860, 500], [188, 430], [930, 650], [330, 770], [790, 790], [118, 596], [992, 418], [418, 632], [692, 690]];
  for (const [x, y] of shrubs) {
    paint(x - 10, y - 6, 20, 8, '#7f9a97');
    paint(x - 6, y - 12, 12, 8, '#6f8a88');
    paint(x - 8, y - 14, 16, 3, '#e8f3f7');
    paint(x - 3, y - 18, 6, 4, '#e8f3f7');
    paint(x - 2, y - 8, 2, 5, '#55716f');
  }
  const icePatches: Array<[number, number, number, number]> = [[300, 620, 38, 14], [756, 662, 44, 16], [242, 300, 30, 12], [878, 760, 36, 14], [420, 728, 28, 10], [640, 600, 26, 10]];
  for (const [x, y, width, height] of icePatches) {
    paint(x, y, width, height, '#b7d5e2');
    paint(x + 4, y + 3, width - 10, height - 6, '#d6ebf3');
    paint(x + 8, y + 5, 8, 2, '#f0f9fc');
  }
  // A low cairn and pressed footprints mark the gate approach and packed trail.
  for (const x of [512, 596]) {
    paint(x, 764, 12, 7, '#6b7d86'); paint(x + 3, 758, 7, 6, '#84969f');
    paint(x + 1, 756, 10, 3, '#e3eff4');
  }
  for (let y = 330; y < 800; y += 28) {
    const side = Math.floor(y / 28) % 2 ? 4 : -4;
    paint(566 + side, y, 3, 5, '#9fb4c1');
    paint(575 - side, y + 3, 3, 5, '#9fb4c1');
  }
  return surface;
}
const background = paintStatic();

function drawSnow(time: number): void {
  if (reduced.matches) {
    for (let index = 0; index < 34; index++) {
      const x = (index * 97) % VIEW_W, y = (index * 53) % VIEW_H;
      rect(x, y, 2, 2, '#f4fbff');
    }
    return;
  }
  for (const flake of snowfall) {
    rect(flake.x, flake.y, flake.size, flake.size, flake.size > 2 ? '#f4fbff' : '#dfeef5');
  }
}
function updateSnow(dt: number, time: number): void {
  if (reduced.matches) return;
  if (!snowfall.length) {
    for (let index = 0; index < 72; index++) {
      snowfall.push({
        x: (index * 79 + 13) % VIEW_W, y: (index * 47 + 29) % VIEW_H,
        speed: 14 + (index % 5) * 7, drift: 6 + (index % 4) * 3, size: index % 6 === 0 ? 3 : 2,
      });
    }
  }
  for (const flake of snowfall) {
    flake.y += flake.speed * dt;
    flake.x += Math.sin(time / 900 + flake.y / 90) * flake.drift * dt;
    if (flake.y > VIEW_H + 4) { flake.y = -4; flake.x = (flake.x + 137) % VIEW_W; }
    if (flake.x > VIEW_W + 4) flake.x = -4;
    if (flake.x < -4) flake.x = VIEW_W + 4;
  }
}
function drawScene(time: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  rect(0, 0, VIEW_W, VIEW_H, '#c8dbe5');
  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  ctx.drawImage(background, 0, 0);
  // Return gate glow and the nearest landmark get a small, calm pixel marker.
  const gateX = RETURN.x, gateY = RETURN.y;
  if (!reduced.matches) {
    const pulse = Math.floor(time / 420) % 2;
    rect(gateX - 14, gateY - 30 - pulse, 28, 3, '#dff4ff');
    rect(gateX - 3, gateY - 38 - pulse, 6, 4, '#9fc9d8');
  }
  const site = nearestLandmark();
  if (site) {
    const pulse = reduced.matches ? 0 : Math.floor(time / 300) % 2;
    rect(site.position.x - 3, site.position.y - 54 + pulse, 6, 4, '#f0cf75');
    rect(site.position.x - 2, site.position.y - 59 + pulse, 4, 3, '#fff0b0');
  }
  // Player shadow and the shared appearance-aware actor sprite.
  ctx.fillStyle = '#1b2f3866';
  ctx.beginPath(); ctx.ellipse(Math.round(local.x), Math.round(local.y + 8), 14, 5, 0, 0, Math.PI * 2); ctx.fill();
  const composed = playerAppearance ? appearanceSprites.sheet(playerAppearance) ?? undefined : undefined;
  drawActorSprite(ctx, playerSprite, playerImage, { position: local, facing, movementState: moving ? 'walking' : 'idle' },
    time, reduced.matches, 44, composed);
  ctx.restore();
  drawSnow(time);
}
function setFacingFromInput(x: number, y: number): void {
  if (Math.abs(x) > Math.abs(y)) facing = x > 0 ? 'right' : 'left';
  else if (y !== 0) facing = y > 0 ? 'down' : 'up';
}
function moveBy(x: number, y: number): boolean {
  let moved = false;
  const nx = local.x + x;
  if (walkable(nx, local.y)) { local.x = nx; moved = true; }
  const ny = local.y + y;
  if (walkable(local.x, ny)) { local.y = ny; moved = true; }
  return moved;
}
function pointerTarget(event: PointerEvent): void {
  if (stopped || event.button !== 0) return;
  canvas.focus({ preventScroll: true });
  const box = canvas.getBoundingClientRect();
  const point = {
    x: camera.x + (event.clientX - box.left) * VIEW_W / Math.max(1, box.width),
    y: camera.y + (event.clientY - box.top) * VIEW_H / Math.max(1, box.height),
  };
  if (inReturnGate() || distance(point, RETURN) < 46) { interact(); return; }
  const site = LANDMARKS
    .filter(value => distance(point, value.position) < 54)
    .sort((a, b) => distance(point, a.position) - distance(point, b.position))[0];
  moveTarget = site ? { ...site.position } : point;
}
function frame(time: number): void {
  if (stopped) return;
  const dt = Math.min(.05, (time - lastFrame) / 1000); lastFrame = time;
  const k = keyboard.read(), t = touch.read();
  const input = normalizeInput(k.x + t.x, k.y + t.y, k.interact || t.interact);
  moving = false;
  if (input.x || input.y) {
    moveTarget = null;
    setFacingFromInput(input.x, input.y);
    moving = moveBy(input.x * WALK_SPEED * dt, input.y * WALK_SPEED * dt);
  } else if (moveTarget) {
    const dx = moveTarget.x - local.x, dy = moveTarget.y - local.y, length = Math.hypot(dx, dy);
    if (length <= 4) moveTarget = null;
    else {
      setFacingFromInput(dx, dy);
      moving = moveBy(dx / length * WALK_SPEED * dt, dy / length * WALK_SPEED * dt);
    }
  }
  camera = cameraFor(local);
  if (input.interact) interact();
  if (toastUntil && time > toastUntil) { toast.hidden = true; toastUntil = 0; }
  updateSnow(dt, time);
  updateHud();
  drawScene(time);
  requestAnimationFrame(frame);
}

actionButton.addEventListener('click', () => interact());
canvas.addEventListener('pointerdown', pointerTarget);
$<HTMLAnchorElement>('snow-return').addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  returnToWorld();
});
$<HTMLAnchorElement>('snow-brand-link')?.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  returnToWorld();
});
window.addEventListener('pagehide', () => { stopped = true; keyboard.destroy(); touch.destroy(); });

camera = cameraFor(local);
updateHud();
document.body.dataset.snowReady = '1';
canvas.dataset.snow = 'frostgate';
canvas.dataset.snowLandmarks = LANDMARKS.map(site => site.id).join(',');
requestAnimationFrame(frame);
