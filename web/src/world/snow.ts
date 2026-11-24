/**
 * Frostgate mountain scene. The northern pass leads to this explorable snow
 * region: five authored terraces rise from the gate in the south to a summit
 * outpost in the north. It reuses the shared input, appearance, sprite and
 * discovery helpers, so crossing the pass needs no new server authority.
 */
import { KeyboardInput, TouchJoystickInput } from './input.js';
import { normalizeInput, type Position } from './model.js';
import { SPRITES, loadSettings } from './sprites.js';
import { appearanceKey, appearanceSprites } from './appearance.js';
import { drawActorSprite } from './renderer.js';
import { loadDiscoveries, saveDiscoveries } from './explore.js';
import {
  SNOW_WORLD, SNOW_SPAWN, SNOW_RETURN, SNOW_RETURN_RADIUS, SNOW_WALK_SPEED, SNOW_FOOT_RADIUS,
  TERRACES, CLIFFS, CLIMB_STEPS, SNOW_TRAIL, terraceAt, elevationAt, regionAtElevation, cliffBlocks, climbAt,
  FROSTGATE_LANDMARKS, FROSTGATE_BUILDINGS, INTERIORS, SNOW_OBSTACLES,
  SNOW_PINES, SNOW_ROCKS, SNOW_SHRUBS, SNOW_ICE,
  interiorBlocks, buildingAt,
  type Interior, type InteriorProp, type FrostgateLandmark,
} from './frostgate.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('snow-canvas');
const ctx = canvas.getContext('2d')!;
const toast = $<HTMLDivElement>('snow-toast');
const positionText = $<HTMLElement>('snow-position');
const landmarkText = $<HTMLElement>('snow-landmarks');
const regionText = $<HTMLElement>('snow-region');
const actionButton = $<HTMLButtonElement>('snow-action');
const keyboard = new KeyboardInput(canvas);
const touch = new TouchJoystickInput($('snow-joystick'), $('snow-joystick-knob'), actionButton);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

const VIEW_W = canvas.width, VIEW_H = canvas.height;
const WALK_SPEED = SNOW_WALK_SPEED;
const FOOT_RADIUS = SNOW_FOOT_RADIUS;

const settings = loadSettings();
const playerAppearance = settings.appearance;
const playerSprite = SPRITES.find(sprite => sprite.id === settings.avatar);
const playerImage = new Image();
if (playerSprite) playerImage.src = playerSprite.sheet;
if (playerAppearance) appearanceSprites.preload(playerAppearance);
canvas.dataset.appearance = playerAppearance ? appearanceKey(playerAppearance) : `preset:${settings.avatar}`;

const discovered = new Set(loadDiscoveries());
let mode: 'exterior' | 'interior' = 'exterior';
let activeInterior: Interior | null = null;
let exteriorReturn: Position | null = null;
let activeDoor: string | null = null;
let local: Position = { ...SNOW_SPAWN };
let camera: Position = { x: 0, y: 0 };
let facing: 'up' | 'down' | 'left' | 'right' = 'up';
let moving = false, stopped = false, lastFrame = performance.now();
let moveTarget: Position | null = null, toastUntil = 0;
let snowfall: Array<{ x: number; y: number; speed: number; drift: number; size: number }> = [];

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function distance(a: Position, b: Position): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => clamp(((value >> shift) & 255) + amount, 0, 255);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}
function hashUnit(x: number, y: number, seed = 0): number {
  let value = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1597334677)) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0; value = Math.imul(value, 1274126177) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function snowNoise(x: number, y: number, scale: number, seed: number): number {
  const nx = x / scale, ny = y / scale, gx = Math.floor(nx), gy = Math.floor(ny);
  const fx = nx - gx, fy = ny - gy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hashUnit(gx, gy, seed), b = hashUnit(gx + 1, gy, seed);
  const c = hashUnit(gx, gy + 1, seed), d = hashUnit(gx + 1, gy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function blockedExterior(x: number, y: number): boolean {
  if (x < FOOT_RADIUS || y < FOOT_RADIUS || x > SNOW_WORLD.width - FOOT_RADIUS || y > SNOW_WORLD.height - FOOT_RADIUS) return true;
  if (cliffBlocks(x, y, FOOT_RADIUS)) return true;
  return SNOW_OBSTACLES.some(rect => x + FOOT_RADIUS > rect.x && x - FOOT_RADIUS < rect.x + rect.width
    && y + FOOT_RADIUS > rect.y && y - FOOT_RADIUS < rect.y + rect.height);
}
function walkable(x: number, y: number): boolean {
  if (mode === 'interior' && activeInterior) return !interiorBlocks(activeInterior, x, y, FOOT_RADIUS);
  return !blockedExterior(x, y);
}
function cameraFor(point: Position): Position {
  const bounds = mode === 'interior' && activeInterior
    ? { width: activeInterior.width, height: activeInterior.height }
    : SNOW_WORLD;
  return {
    x: clamp(point.x - VIEW_W / 2, 0, Math.max(0, bounds.width - VIEW_W)),
    y: clamp(point.y - VIEW_H / 2, 0, Math.max(0, bounds.height - VIEW_H)),
  };
}
function nearestLandmark(): FrostgateLandmark | null {
  return FROSTGATE_LANDMARKS
    .filter(site => distance(local, site.position) <= site.radius)
    .sort((a, b) => distance(local, a.position) - distance(local, b.position))[0] ?? null;
}
function inReturnGate(): boolean { return mode === 'exterior' && distance(local, SNOW_RETURN) <= SNOW_RETURN_RADIUS; }
function inInteriorExit(): boolean { return Boolean(mode === 'interior' && activeInterior && distance(local, activeInterior.exit) <= activeInterior.exitRadius); }
function flash(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  toastUntil = performance.now() + 4200;
}
function updateHud(): void {
  const site = mode === 'exterior' ? nearestLandmark() : null;
  const door = mode === 'exterior' ? buildingAt(local.x, local.y) : null;
  positionText.textContent = `X ${Math.round(local.x)} · Y ${Math.round(local.y)}`;
  const found = FROSTGATE_LANDMARKS.filter(site => discovered.has(site.id)).length;
  landmarkText.textContent = `LANDMARKS ${found} / ${FROSTGATE_LANDMARKS.length}`;
  regionText.textContent = mode === 'interior' ? activeInterior?.label ?? 'INTERIOR' : regionAtElevation(local.y);
  canvas.dataset.player = `${Math.round(local.x)},${Math.round(local.y)}`;
  canvas.dataset.landmarks = FROSTGATE_LANDMARKS.filter(site => discovered.has(site.id)).map(site => site.id).join(',');
  canvas.dataset.nearest = site?.id ?? '';
  canvas.dataset.nearestDoor = door?.id ?? '';
  canvas.dataset.mode = mode;
  canvas.dataset.elevation = String(mode === 'interior' ? 0 : elevationAt(local.y));
  canvas.dataset.climb = String(mode === 'interior' ? 0 : climbAt(local.y));
  canvas.dataset.climbTotal = String(CLIMB_STEPS);
  canvas.dataset.fireplace = mode === 'interior' && activeInterior?.fireplace ? '1' : '0';
  canvas.dataset.region = regionText.textContent;
  canvas.dataset.return = inReturnGate() ? '1' : '0';
  if (inInteriorExit()) actionButton.textContent = 'E · EXIT';
  else if (inReturnGate()) actionButton.textContent = 'E · RETURN TO WORLD';
  else if (door) actionButton.textContent = door.enterable ? `E · ENTER ${door.label}` : 'E · INSPECT';
  else if (site) actionButton.textContent = 'E · INSPECT';
  else actionButton.textContent = 'E · LOOK';
}

function persistDiscoveries(): void { saveDiscoveries(discovered); }
function returnToWorld(): void {
  if (stopped) return;
  stopped = true;
  keyboard.destroy();
  touch.destroy();
  location.assign('/world?return=snow');
}
function enterBuilding(id: string): void {
  const building = FROSTGATE_BUILDINGS.find(value => value.id === id);
  const interior = building?.interior ? INTERIORS[building.interior] : null;
  if (!building || !interior) return;
  exteriorReturn = { ...local };
  activeDoor = building.id;
  activeInterior = interior;
  mode = 'interior';
  local = { ...interior.entry };
  moveTarget = null;
  camera = cameraFor(local);
  flash(`${interior.label} · WARM INSIDE`);
  updateHud();
}
function exitBuilding(): void {
  if (!activeInterior) return;
  if (exteriorReturn) local = { ...exteriorReturn };
  mode = 'exterior';
  activeInterior = null;
  activeDoor = null;
  exteriorReturn = null;
  moveTarget = null;
  camera = cameraFor(local);
  updateHud();
}
function interact(): void {
  if (stopped) return;
  if (inInteriorExit()) { exitBuilding(); return; }
  if (mode === 'exterior' && inReturnGate()) { returnToWorld(); return; }
  if (mode === 'exterior') {
    const door = buildingAt(local.x, local.y);
    if (door) {
      if (door.enterable && door.interior) enterBuilding(door.id);
      else flash(`${door.label} · ${door.note}`);
      return;
    }
    const site = nearestLandmark();
    if (!site) { flash('NOTHING WITHIN REACH · FOLLOW THE TRAIL NORTH'); return; }
    const first = !discovered.has(site.id);
    discovered.add(site.id);
    persistDiscoveries();
    updateHud();
    flash(`${first ? 'RECORDED · ' : ''}${site.label} · ${site.note}`);
    return;
  }
  flash('THE ROOM IS QUIET · RETURN THROUGH THE DOOR');
}

function rect(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
  c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}
interface Bounds { x: number; y: number; width: number; height: number }
function paintExteriorSurface(c: CanvasRenderingContext2D, bounds: Bounds): void {
  const paint = (x: number, y: number, w: number, h: number, color: string) => rect(c, x, y, w, h, color);
  const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height;
  // Low-contrast, world-space snow. Each terrace has its own close shades and
  // a gently waved edge, so no hard horizontal colour band appears.
  for (const terrace of TERRACES) {
    const tones = [shade(terrace.snow, -11), shade(terrace.snow, -5), terrace.snow,
      shade(terrace.snow, 5), shade(terrace.snow, 11)];
    for (let gx = Math.floor(bounds.x / 32) * 32; gx < right; gx += 32) {
      const wobble = (snowNoise(gx, terrace.minY, 190, terrace.elevation * 13 + 5) - 0.5) * 34;
      const top = terrace.minY + wobble, base = terrace.maxY + wobble;
      for (let gy = Math.max(bounds.y, Math.floor(top / 32) * 32); gy < Math.min(bottom, base); gy += 32) {
        const soft = snowNoise(gx, gy, 360, 41) * 0.65 + snowNoise(gx, gy, 120, 57) * 0.35;
        paint(gx, gy, 32, 32, tones[Math.min(4, Math.floor(soft * 5))]!);
      if (hashUnit(gx, gy, 71) < .16) paint(gx + 20, gy + 12, 5, 3, shade(terrace.snow, -14));
      }
    }
  }
  // Tiny dither marks keep the authored pixel texture without a checkerboard.
  for (let gy = Math.floor(bounds.y / 32) * 32; gy < bottom; gy += 32) {
    for (let gx = Math.floor(bounds.x / 32) * 32; gx < right; gx += 32) {
      const sample = hashUnit(gx, gy, 71);
      const terrace = terraceAt(gy + 16);
      if (sample > .72) paint(gx + 6, gy + 11, 7, 3, shade(terrace.snow, 9));
      else if (sample < .12) paint(gx + 19, gy + 20, 6, 3, shade(terrace.snow, -9));
    }
  }
  // Cliff faces, retaining walls and the ramps that cut through them.
  for (const cliff of CLIFFS) {
    for (let gx = Math.floor(bounds.x / 24) * 24; gx < right; gx += 24) {
      if (gx < bounds.x - 24 || gx > right) continue;
      const corridor = cliff.corridors.find(span => gx >= span.minX - 12 && gx <= span.maxX + 12);
      if (corridor) continue;
      const terrace = terraceAt(cliff.y - 20), lower = terraceAt(cliff.y + 20);
      const wobble = (snowNoise(gx, cliff.y, 120, 97) - 0.5) * 10;
      paint(gx, cliff.y - 16 + wobble, 24, 30, terrace.stone);
      paint(gx, cliff.y - 16 + wobble, 24, 5, '#e8f3f8');
      paint(gx, cliff.y - 6 + wobble, 24, 3, shade(terrace.stone, -14));
      paint(gx, cliff.y + 14 + wobble, 24, 6, lower.shadow);
      for (let seam = 0; seam < 3; seam++) paint(gx + 4 + seam * 7, cliff.y - 6 + wobble, 2, 12, shade(terrace.stone, -10));
    }
    for (const span of cliff.corridors) {
      if (span.maxX < bounds.x || span.minX > right) continue;
      const terrace = terraceAt(cliff.y - 20);
      paint(span.minX, cliff.y - 20, span.maxX - span.minX, 40, shade(terrace.stone, 10));
      paint(span.minX + 4, cliff.y - 20, span.maxX - span.minX - 8, 34, '#a9bec9');
      if (span.kind === 'stair') {
        for (let step = 0; step < 5; step++) paint(span.minX + 2, cliff.y - 18 + step * 8, span.maxX - span.minX - 4, 3, '#708996');
      } else if (span.kind === 'bridge') {
        for (let plank = span.minX + 4; plank < span.maxX - 4; plank += 14) paint(plank, cliff.y - 14, 8, 28, '#7f8d84');
        paint(span.minX + 2, cliff.y - 22, 8, 44, '#5f6f78');
        paint(span.maxX - 10, cliff.y - 22, 8, 44, '#5f6f78');
      } else {
        for (let step = 0; step < 4; step++) paint(span.minX + 3, cliff.y - 16 + step * 9, span.maxX - span.minX - 6, 3, '#879faa');
      }
    }
  }
  // Packed switchback trail: south gate → village → west ramp → east ramp →
  // ice bridge → summit stair. Drawn under props so footprints stay legible.
  // The packed switchback trail is a true climbing route: it crosses each
  // ridge at an alternating side, so following it covers ~82k world pixels.
  const paintLine = (a: Position, b: Position, width: number, color: string) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 14));
    for (let step = 0; step <= steps; step++) {
      const x = a.x + (b.x - a.x) * step / steps, y = a.y + (b.y - a.y) * step / steps;
      if (x < bounds.x - 24 || x > right + 24 || y < bounds.y - 24 || y > bottom + 24) continue;
      paint(x - width / 2, y - width / 2, width, width, color);
      if (step % 3 === 0) paint(x - 2, y + 2, 3, 5, '#789aad');
    }
  };
  for (let index = 0; index < SNOW_TRAIL.length - 1; index++) {
    const a = SNOW_TRAIL[index]!, b = SNOW_TRAIL[index + 1]!;
    if (Math.min(a.x, b.x) > right || Math.max(a.x, b.x) < bounds.x
      || Math.min(a.y, b.y) > bottom || Math.max(a.y, b.y) < bounds.y) continue;
    paintLine(a, b, 52, '#a9c4d2');
    paintLine(a, b, 34, '#c8dde7');
  }
  // Cairn trail markers guide the climber between switchbacks.
  for (const [index, point] of SNOW_TRAIL.entries()) {
    if (index % 3 !== 0 || point.x < bounds.x - 20 || point.x > right + 20
      || point.y < bounds.y - 20 || point.y > bottom + 20) continue;
    paint(point.x - 9, point.y - 3, 18, 11, '#6b7d86');
    paint(point.x - 6, point.y - 9, 12, 8, '#84969f');
    paint(point.x - 7, point.y - 10, 14, 3, '#e3eff4');
  }
  // Frozen ground detail.
  for (const patch of SNOW_ICE) {
    if (patch.x > right || patch.x + patch.width < bounds.x || patch.y > bottom || patch.y + patch.height < bounds.y) continue;
    paint(patch.x, patch.y, patch.width, patch.height, '#a9cbd9');
    paint(patch.x + 4, patch.y + 3, patch.width - 8, patch.height - 6, '#cfe9f2');
    paint(patch.x + 9, patch.y + 5, 10, 2, '#f0f9fc');
  }
  for (const pine of SNOW_PINES) {
    if (pine.x < bounds.x - 40 || pine.x > right + 40 || pine.y < bounds.y - 70 || pine.y > bottom + 30) continue;
    const s = pine.scale;
    paint(pine.x - 4 * s, pine.y - 8 * s, 8 * s, 18 * s, '#4a3f3a');
    paint(pine.x - 24 * s, pine.y - 30 * s, 48 * s, 13 * s, '#2c4b4a');
    paint(pine.x - 18 * s, pine.y - 46 * s, 36 * s, 17 * s, '#335955');
    paint(pine.x - 11 * s, pine.y - 62 * s, 22 * s, 16 * s, '#3c6560');
    paint(pine.x - 9 * s, pine.y - 60 * s, 18 * s, 4 * s, '#e7f2f6');
    paint(pine.x - 15 * s, pine.y - 32 * s, 30 * s, 4 * s, '#dcecf2');
  }
  for (const rock of SNOW_ROCKS) {
    if (rock.x > right || rock.x + rock.width < bounds.x || rock.y > bottom || rock.y + rock.height < bounds.y) continue;
    paint(rock.x, rock.y, rock.width, rock.height, '#667983');
    paint(rock.x + 5, rock.y - 5, rock.width - 12, 7, '#8498a2');
    paint(rock.x + 4, rock.y - 6, rock.width - 10, 3, '#e3eff4');
  }
  for (const shrub of SNOW_SHRUBS) {
    if (shrub.x < bounds.x - 20 || shrub.x > right + 20 || shrub.y < bounds.y - 24 || shrub.y > bottom + 16) continue;
    paint(shrub.x - 10, shrub.y - 6, 20, 8, '#708a88');
    paint(shrub.x - 6, shrub.y - 12, 12, 8, '#60807e');
    paint(shrub.x - 8, shrub.y - 14, 16, 3, '#e8f3f7');
    paint(shrub.x - 2, shrub.y - 8, 2, 5, '#4c6a68');
  }
  // Buildings, lamps, fences and crates.
  for (const building of FROSTGATE_BUILDINGS) {
    if (building.x > right || building.x + building.width < bounds.x || building.y > bottom || building.y + building.height < bounds.y) continue;
    paintBuilding(paint, building);
  }
  // Lampposts and fence crates make the settlement read as lived-in.
  for (const building of FROSTGATE_BUILDINGS) {
    const lx = building.x + building.width + 20, ly = building.y + building.height - 12;
    if (elevationAt(building.y) !== 1 || lx < bounds.x - 20 || lx > right + 20 || ly < bounds.y - 30 || ly > bottom + 20) continue;
    paint(lx - 3, ly - 24, 6, 26, '#4a3f3a');
    paint(lx - 8, ly - 34, 16, 12, '#3d362e');
    paint(lx - 5, ly - 31, 10, 7, building.kind === 'ruin' ? '#5d6f70' : '#f2cf81');
    paint(lx - 3, ly - 30, 6, 3, '#fff0b8');
    paint(lx - 3, ly - 8, 24, 3, '#6b5846');
    paint(lx + 18, ly - 8, 3, 12, '#6b5846');
  }
  for (const site of FROSTGATE_LANDMARKS) {
    if (site.position.x < bounds.x - 120 || site.position.x > right + 120
      || site.position.y < bounds.y - 100 || site.position.y > bottom + 80) continue;
    paintLandmark(paint, site.id, site.position);
  }
  // The carved gate and its cairns mark the only way back south.
  if (SNOW_RETURN.x + 90 > bounds.x && SNOW_RETURN.x - 90 < right && SNOW_RETURN.y + 80 > bounds.y) {
    const gx = SNOW_RETURN.x, gy = SNOW_RETURN.y;
    paint(gx - 62, gy - 6, 124, 44, '#5a6b74');
    paint(gx - 58, gy - 14, 116, 12, '#e8f3f7');
    paint(gx - 54, gy - 4, 12, 42, '#74858e');
    paint(gx + 42, gy - 4, 12, 42, '#74858e');
    paint(gx - 42, gy + 4, 84, 28, '#22333b');
    paint(gx + 36, gy - 10, 8, 16, '#d7a667');
    for (const offset of [-92, 92]) {
      paint(gx + offset - 8, gy + 18, 16, 9, '#6b7d86');
      paint(gx + offset - 5, gy + 12, 11, 7, '#84969f');
      paint(gx + offset - 6, gy + 11, 12, 3, '#e3eff4');
    }
  }
}
type Painter = (x: number, y: number, w: number, h: number, color: string) => void;
function paintBuilding(paint: Painter, building: (typeof FROSTGATE_BUILDINGS)[number]): void {
  const { x, y, width, height } = building;
  const wall = building.kind === 'shop' ? '#7c6a55' : building.kind === 'ruin' ? '#575b54' : '#715b48';
  const roof = building.kind === 'shop' ? '#5b4b43' : '#513e37';
  paint(x - 6, y + 8, width + 12, height, '#1a2a2f88');
  paint(x, y + 22, width, height - 22, wall);
  for (let plank = 0; plank < height - 22; plank += 12) paint(x, y + 22 + plank, width, 2, shade(wall, -12));
  paint(x - 10, y + 12, width + 20, 16, roof);
  paint(x - 6, y + 4, width + 12, 10, roof);
  paint(x - 8, y + 2, width + 16, 6, '#e8f3f8');
  paint(x - 4, y - 4, 16, 12, '#4a3f3a');
  paint(x - 6, y - 8, 20, 5, '#e8f3f8');
  const windowColor = building.kind === 'ruin' ? '#273a3c' : '#e7bd72';
  paint(x + 18, y + 38, 26, 22, windowColor);
  paint(x + 21, y + 41, 20, 16, building.kind === 'ruin' ? '#1c2e30' : '#fff0b8');
  paint(x + width - 44, y + 38, 26, 22, windowColor);
  paint(x + width - 41, y + 41, 20, 16, building.kind === 'ruin' ? '#1c2e30' : '#fff0b8');
  paint(building.door.x - 15, y + height - 38, 30, 38, '#2c2a26');
  paint(building.door.x - 12, y + height - 34, 24, 34, building.kind === 'ruin' ? '#1c2a2c' : '#4a382b');
  paint(building.door.x - 18, y + height - 4, 36, 5, '#dfeef5');
  if (building.kind === 'shop') {
    paint(x + 12, y + 72, width - 24, 16, '#3d2f2a');
    for (let stripe = 0; stripe < width - 24; stripe += 18) paint(x + 14 + stripe, y + 74, 8, 12, '#c9a86a');
  }
  if (building.enterable) {
    paint(building.door.x - 3, y + height - 6, 6, 5, '#d7a667');
  }
}
function paintLandmark(paint: Painter, id: string, point: Position): void {
  const { x, y } = point;
  if (id === 'frostgate-village') {
    paint(x - 46, y - 8, 92, 14, '#5c6b70'); paint(x - 42, y - 12, 84, 6, '#e6f1f6');
    paint(x - 38, y - 58, 5, 54, '#6b5846'); paint(x + 33, y - 58, 5, 54, '#6b5846');
    paint(x - 38, y - 58, 76, 20, '#9a6b58'); paint(x - 34, y - 54, 68, 12, '#c9a072');
    paint(x - 8, y - 2, 16, 8, '#d7a667');
  } else if (id === 'frozen-shrine') {
    paint(x - 22, y - 30, 42, 50, '#7d8b92'); paint(x - 16, y - 38, 30, 12, '#e8f3f7');
    paint(x - 10, y - 18, 5, 24, '#9fb6c2'); paint(x + 10, y - 22, 4, 20, '#bcd7e2');
    paint(x - 32, y + 18, 64, 8, '#a9bcc7'); paint(x - 38, y + 26, 76, 6, '#c7d8e1');
    paint(x - 18, y + 4, 36, 8, '#8fa3ae'); paint(x - 10, y + 6, 20, 4, '#d8e9f1');
  } else if (id === 'frozen-lake') {
    paint(x - 72, y - 30, 144, 62, '#93b9c9'); paint(x - 64, y - 24, 128, 50, '#b8dce9');
    paint(x - 48, y - 14, 96, 30, '#d6f0f7');
    for (let line = -52; line < 52; line += 18) paint(x + line, y - 18, 12, 3, '#e8f8fc');
    paint(x - 80, y + 30, 26, 14, '#667983'); paint(x + 56, y + 28, 24, 14, '#667983');
  } else if (id === 'high-pass') {
    paint(x - 70, y - 8, 140, 46, '#52646e'); paint(x - 66, y - 16, 56, 58, '#5d7079');
    paint(x + 12, y - 22, 62, 64, '#4f626d');
    paint(x - 62, y - 20, 56, 6, '#e8f3f8'); paint(x + 12, y - 26, 62, 6, '#e8f3f8');
    paint(x - 4, y + 12, 8, 26, '#9fbcc7');
  } else if (id === 'ice-bridge') {
    paint(x - 60, y - 16, 120, 30, '#6f818b');
    for (let plank = -54; plank < 54; plank += 14) paint(x + plank, y - 12, 10, 24, '#8d9d91');
    paint(x - 66, y - 22, 10, 40, '#5a6b74'); paint(x + 56, y - 22, 10, 40, '#5a6b74');
    paint(x - 58, y - 18, 116, 5, '#e8f3f8');
  } else if (id === 'frost-watchtower') {
    paint(x - 34, y - 70, 68, 86, '#667984'); paint(x - 40, y - 82, 80, 14, '#e6f1f6');
    paint(x - 26, y - 62, 8, 70, '#84969f'); paint(x + 18, y - 62, 8, 70, '#84969f');
    paint(x - 14, y - 48, 28, 22, '#2e4750'); paint(x - 9, y - 43, 18, 12, '#a9d4e2');
    paint(x - 42, y + 12, 84, 8, '#9fb2bc'); paint(x - 48, y + 20, 96, 6, '#c2d4dd');
  } else if (id === 'summit-beacon') {
    paint(x - 34, y - 16, 68, 40, '#5b6d78'); paint(x - 30, y - 24, 60, 10, '#e8f3f8');
    paint(x - 22, y - 60, 44, 46, '#6d808b'); paint(x - 16, y - 70, 32, 12, '#e6f1f6');
    paint(x - 12, y - 50, 24, 20, '#2e4750'); paint(x - 7, y - 45, 14, 10, '#a9d4e2');
    paint(x - 3, y - 42, 6, 5, '#e6f7fd');
  }
}

/** 600x1000 surfaces keep every backing canvas far below mobile Safari's
 * per-canvas ceiling. Only chunks near the camera are painted and cached, so
 * the tall mountain never allocates one giant surface or hundreds at once. */
const CHUNK_W = 600, CHUNK_H = 1000;
const CHUNK_CACHE_LIMIT = 12;
const exteriorSurfaces = new Map<string, HTMLCanvasElement>();
function chunkSurface(column: number, row: number): HTMLCanvasElement {
  const key = `${column},${row}`;
  const cached = exteriorSurfaces.get(key);
  if (cached) return cached;
  if (exteriorSurfaces.size >= CHUNK_CACHE_LIMIT) {
    const oldest = exteriorSurfaces.keys().next().value;
    if (oldest) exteriorSurfaces.delete(oldest);
  }
  const bounds: Bounds = { x: column * CHUNK_W, y: row * CHUNK_H,
    width: Math.min(CHUNK_W, SNOW_WORLD.width - column * CHUNK_W),
    height: Math.min(CHUNK_H, SNOW_WORLD.height - row * CHUNK_H) };
  const surface = document.createElement('canvas');
  surface.width = bounds.width; surface.height = bounds.height;
  const c = surface.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.translate(-bounds.x, -bounds.y);
  paintExteriorSurface(c, bounds);
  exteriorSurfaces.set(key, surface);
  return surface;
}
function drawExteriorChunks(): void {
  const firstColumn = Math.max(0, Math.floor(camera.x / CHUNK_W));
  const lastColumn = Math.min(Math.ceil(SNOW_WORLD.width / CHUNK_W) - 1, Math.floor((camera.x + VIEW_W) / CHUNK_W));
  const firstRow = Math.max(0, Math.floor(camera.y / CHUNK_H));
  const lastRow = Math.min(Math.ceil(SNOW_WORLD.height / CHUNK_H) - 1, Math.floor((camera.y + VIEW_H) / CHUNK_H));
  for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) {
    ctx.drawImage(chunkSurface(column, row), column * CHUNK_W, row * CHUNK_H);
  }
}
const interiorSurfaces = new Map<string, HTMLCanvasElement>();
function interiorSurface(interior: Interior): HTMLCanvasElement {
  const cached = interiorSurfaces.get(interior.id);
  if (cached) return cached;
  const surface = document.createElement('canvas');
  surface.width = interior.width; surface.height = interior.height;
  const c = surface.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const paint = (x: number, y: number, w: number, h: number, color: string) => rect(c, x, y, w, h, color);
  paint(0, 0, interior.width, interior.height, interior.wall);
  paint(16, 58, interior.width - 32, interior.height - 74, interior.floor);
  for (let plank = 58; plank < interior.height - 16; plank += 16) paint(16, plank, interior.width - 32, 2, shade(interior.floor, -12));
  paint(16, 58, interior.width - 32, 6, interior.trim);
  paint(16, interior.height - 22, interior.width - 32, 8, shade(interior.floor, -18));
  paint(0, 0, interior.width, 58, interior.wall);
  for (const prop of interior.props) paintProp(paint, prop, interior);
  interiorSurfaces.set(interior.id, surface);
  return surface;
}
function paintProp(paint: Painter, prop: InteriorProp, interior: Interior): void {
  const { x, y, width, height, kind } = prop;
  if (kind === 'rug') {
    paint(x, y, width, height, '#8c4f42'); paint(x + 6, y + 6, width - 12, height - 12, '#a96852');
    paint(x + 12, y + 12, width - 24, height - 24, '#7c463e');
  } else if (kind === 'window') {
    paint(x, y, width, height, '#2e4c57'); paint(x + 4, y + 4, width - 8, height - 8, '#a7d4e6');
    paint(x + width / 2 - 2, y, 4, height, '#5b4638'); paint(x, y + height / 2 - 2, width, 4, '#5b4638');
    paint(x + 5, y + 4, width - 12, 4, '#e8f3f8');
  } else if (kind === 'fireplace') {
    paint(x, y, width, height, '#4a423c'); paint(x + 8, y + 12, width - 16, height - 12, '#23201d');
    paint(x - 4, y - 6, width + 8, 10, interior.trim);
    paint(x + 6, y + height - 8, width - 12, 6, '#6c5a48');
  } else if (kind === 'bed') {
    paint(x, y, width, height, '#5a4638'); paint(x + 4, y + 4, width - 8, height - 8, '#c7b798');
    paint(x + 4, y + 4, width - 8, 12, '#e3dcc5'); paint(x + 4, y + height - 16, width - 8, 12, '#8d6b57');
  } else if (kind === 'shelf' || kind === 'counter') {
    paint(x, y, width, height, '#5a4332'); paint(x, y + height - 6, width, 6, '#805f43');
    for (let item = x + 6; item < x + width - 6; item += 16) {
      paint(item, y + 3, 8, height - 12, item % 32 === 0 ? '#b9a06a' : '#6f8a75');
    }
  } else if (kind === 'crate' || kind === 'barrel') {
    paint(x, y, width, height, '#6b513a'); paint(x + 3, y + 3, width - 6, height - 6, '#846746');
    paint(x, y + height / 2 - 2, width, 4, '#4d3a2a');
  } else if (kind === 'lantern') {
    paint(x, y, width, height, '#5a4636'); paint(x + 2, y + 4, width - 4, height - 7, '#f2cf81');
    paint(x + 3, y + 5, width - 6, 4, '#fff0b8');
  } else if (kind === 'table' || kind === 'stool') {
    paint(x, y + 6, width, height - 6, '#6b4f39'); paint(x - 2, y + 2, width + 4, 7, '#8a6a4a');
  } else if (kind === 'sign') {
    paint(x, y, width, height, '#4a382c'); paint(x + 5, y + 5, width - 10, height - 10, '#a98a5c');
    for (let line = x + 12; line < x + width - 12; line += 14) paint(line, y + 11, 8, 3, '#4a382c');
  } else if (kind === 'plant') {
    paint(x + 6, y + 12, width - 12, height - 12, '#5b6a42');
    paint(x + 2, y + 6, 8, 12, '#6f8450'); paint(x + width - 10, y + 2, 8, 14, '#7b9156');
  }
}

function drawFireplace(time: number): void {
  if (!activeInterior || reduced.matches) {
    if (activeInterior?.fireplace) drawFlame(0);
    return;
  }
  drawFlame(Math.floor(time / 130) % 3);
}
function drawFlame(phase: number): void {
  if (!activeInterior) return;
  const hearth = activeInterior.props.find(prop => prop.kind === 'fireplace');
  if (!hearth) return;
  const cx = hearth.x + hearth.width / 2, base = hearth.y + hearth.height - 12;
  rect(ctx, cx - 22, base - 34, 44, 34, '#f2a24a33');
  rect(ctx, cx - 14, base - 22, 28, 22, '#f8c76655');
  rect(ctx, cx - 10, base - 16, 20, 14, phase === 1 ? '#f6b34e' : '#e8873c');
  rect(ctx, cx - 6 + phase, base - 22, 12, 18, '#f9cf6a');
  rect(ctx, cx - 3 + phase, base - 16, 6, 12, '#fff2b0');
  rect(ctx, cx + 10, base - 4, 4, 4, '#d7a667');
}

function drawSnow(time: number): void {
  if (reduced.matches) {
    for (let index = 0; index < 34; index++) rect(ctx, (index * 97) % VIEW_W, (index * 53) % VIEW_H, 2, 2, '#f4fbff');
    return;
  }
  for (const flake of snowfall) rect(ctx, flake.x, flake.y, flake.size, flake.size, flake.size > 2 ? '#f4fbff' : '#dfeef5');
}
function updateSnow(dt: number, time: number): void {
  if (reduced.matches) return;
  if (!snowfall.length) {
    for (let index = 0; index < 72; index++) snowfall.push({
      x: (index * 79 + 13) % VIEW_W, y: (index * 47 + 29) % VIEW_H,
      speed: 14 + (index % 5) * 7, drift: 6 + (index % 4) * 3, size: index % 6 === 0 ? 3 : 2,
    });
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
  rect(ctx, 0, 0, VIEW_W, VIEW_H, mode === 'interior' ? '#2b211c' : '#c8dbe5');
  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  if (mode === 'interior' && activeInterior) {
    ctx.drawImage(interiorSurface(activeInterior), 0, 0);
    drawFireplace(time);
    const door = activeInterior.exit;
    if (!reduced.matches) {
      const pulse = Math.floor(time / 420) % 2;
      rect(ctx, door.x - 12, door.y - 22 - pulse, 24, 3, '#f4d69a');
    }
  } else {
    drawExteriorChunks();
    if (!reduced.matches) {
      const pulse = Math.floor(time / 420) % 2;
      rect(ctx, SNOW_RETURN.x - 14, SNOW_RETURN.y - 30 - pulse, 28, 3, '#dff4ff');
      rect(ctx, SNOW_RETURN.x - 3, SNOW_RETURN.y - 38 - pulse, 6, 4, '#9fc9d8');
    }
    const site = nearestLandmark();
    if (site) {
      const pulse = reduced.matches ? 0 : Math.floor(time / 300) % 2;
      rect(ctx, site.position.x - 3, site.position.y - 54 + pulse, 6, 4, '#f0cf75');
      rect(ctx, site.position.x - 2, site.position.y - 59 + pulse, 4, 3, '#fff0b0');
    }
    const door = buildingAt(local.x, local.y);
    if (door?.enterable && !reduced.matches) {
      const pulse = Math.floor(time / 260) % 2;
      rect(ctx, door.door.x - 10, door.door.y - 26 - pulse, 20, 3, '#f4d69a');
    }
  }
  ctx.fillStyle = '#1b2f3866';
  ctx.beginPath(); ctx.ellipse(Math.round(local.x), Math.round(local.y + 8), 14, 5, 0, 0, Math.PI * 2); ctx.fill();
  const composed = playerAppearance ? appearanceSprites.sheet(playerAppearance) ?? undefined : undefined;
  drawActorSprite(ctx, playerSprite, playerImage, { position: local, facing, movementState: moving ? 'walking' : 'idle' },
    time, reduced.matches, 44, composed);
  ctx.restore();
  if (mode === 'exterior') drawSnow(time);
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
  if (mode === 'interior') {
    const exit = activeInterior?.exit;
    if (exit && distance(point, exit) < 34) { interact(); return; }
    moveTarget = point;
    return;
  }
  if (inReturnGate() || distance(point, SNOW_RETURN) < 46) { interact(); return; }
  const door = FROSTGATE_BUILDINGS.find(value => distance(point, value.door) < 42);
  if (door) { moveTarget = { ...door.door }; return; }
  const site = FROSTGATE_LANDMARKS
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

// Deterministic lab-style hook for browser regression coverage. It only moves
// the local visitor; it cannot change discoveries, server state or other plays.
(window as Window & { __frostgateTeleport?: (x: number, y: number) => void }).__frostgateTeleport = (x, y) => {
  if (stopped) return;
  mode = 'exterior'; activeInterior = null; exteriorReturn = null; activeDoor = null; moveTarget = null;
  local = { x, y }; camera = cameraFor(local); updateHud();
};

camera = cameraFor(local);
updateHud();
document.body.dataset.snowReady = '1';
canvas.dataset.snow = 'frostgate';
canvas.dataset.snowLandmarks = FROSTGATE_LANDMARKS.map(site => site.id).join(',');
requestAnimationFrame(frame);
