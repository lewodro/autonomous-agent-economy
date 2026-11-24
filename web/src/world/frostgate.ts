/**
 * Frostgate mountain data. Pure geometry and content definitions shared by the
 * snow renderer and its unit tests; no DOM access lives here.
 *
 * The region reads as a climb: south (large y) is the gate, north (small y) is
 * the summit. Five authored terraces are separated by cliff faces that can only
 * be crossed through ramps and switchback corridors.
 */
import type { Position, Rect } from './model.js';
import type { DiscoveryKind } from './explore.js';

export const SNOW_WORLD = { width: 3600, height: 20000 } as const;
export const SNOW_SPAWN: Position = { x: 1500, y: 19620 };
export const SNOW_RETURN: Position = { x: 1500, y: 19840 };
export const SNOW_RETURN_RADIUS = 58;
/** Mountain pace matches the green overworld's 150 px/s so walk times are real. */
export const SNOW_WALK_SPEED = 150;
export const SNOW_FOOT_RADIUS = 12;

export interface Terrace {
  id: string; elevation: number; name: string; minY: number; maxY: number;
  snow: string; shadow: string; stone: string; accent: string;
}
/** Ordered south-to-north. Elevation rises as you travel north. */
export const TERRACES: readonly Terrace[] = [
  { id: 'gate', elevation: 0, name: 'LOWER FROSTGATE', minY: 16800, maxY: 20000, snow: '#d7e6ee', shadow: '#b8cfdb', stone: '#5d7079', accent: '#a9c6d4' },
  { id: 'village', elevation: 1, name: 'FROSTGATE VILLAGE', minY: 11900, maxY: 16800, snow: '#d2e2eb', shadow: '#b3c9d6', stone: '#566973', accent: '#9fc3d1' },
  { id: 'trail', elevation: 2, name: 'MOUNTAIN TRAIL', minY: 7000, maxY: 11900, snow: '#c9dce6', shadow: '#a9c1cf', stone: '#4f626d', accent: '#93b8c8' },
  { id: 'snowfield', elevation: 3, name: 'UPPER SNOWFIELD', minY: 2100, maxY: 7000, snow: '#c1d6e1', shadow: '#9eb9c8', stone: '#485b66', accent: '#87aec0' },
  { id: 'summit', elevation: 4, name: 'SUMMIT OUTPOST', minY: 0, maxY: 2100, snow: '#b9d0dc', shadow: '#94b0c1', stone: '#41535e', accent: '#7ba4b8' },
];
export const ELEVATION_LEVELS = TERRACES.length;

export function terraceAt(y: number): Terrace {
  return TERRACES.find(terrace => y >= terrace.minY && y < terrace.maxY) ?? TERRACES[TERRACES.length - 1]!;
}
export function elevationAt(y: number): number { return terraceAt(y).elevation; }
export function regionAtElevation(y: number): string { return terraceAt(y).name; }

/** Ridges between terraces; each has one or two walkable crossings. The route
 * alternates west and east so the climb is a real switchback, not a straight
 * road. Every fourth ridge also opens a central stair at a biome boundary. */
export interface Cliff {
  y: number;
  corridors: ReadonlyArray<{ minX: number; maxX: number; kind: 'ramp' | 'stair' | 'bridge' | 'switchback' }>;
}
const RIDGE_STEP = 700;
export const CLIFFS: readonly Cliff[] = Array.from({ length: 28 }, (_, index) => {
  const y = 19600 - index * RIDGE_STEP;
  const west = index % 2 === 0;
  const side = west
    ? { minX: 430, maxX: 610, kind: 'ramp' as const }
    : { minX: 2990, maxX: 3170, kind: 'switchback' as const };
  const boundary = [4, 11, 18, 25].includes(index);
  return { y, corridors: boundary
    ? [side, { minX: 430, maxX: 610, kind: 'ramp' as const }, { minX: 1710, maxX: 1890, kind: 'stair' as const }]
    : [side] };
});
export const CLIMB_STEPS = CLIFFS.length;
export function climbAt(y: number): number { return CLIFFS.filter(cliff => y < cliff.y).length; }
const CLIFF_HALF_HEIGHT = 16;
function onCorridor(cliff: Cliff, x: number): boolean {
  return cliff.corridors.some(corridor => x >= corridor.minX && x <= corridor.maxX);
}
/** Cliff faces are solid except at their authored ramps, bridges and stairs. */
export function cliffBlocks(x: number, y: number, radius = SNOW_FOOT_RADIUS): boolean {
  return CLIFFS.some(cliff => y + radius > cliff.y - CLIFF_HALF_HEIGHT
    && y - radius < cliff.y + CLIFF_HALF_HEIGHT && !onCorridor(cliff, x));
}

/** The authored switchback trail. Rendered as packed snow and measured by the
 * browser tests to confirm the real end-to-end walking time. */
export const SNOW_TRAIL: readonly Position[] = (() => {
  const points: Position[] = [{ x: 1500, y: 19900 }];
  for (const cliff of CLIFFS) {
    const crossing = cliff.corridors[0]!;
    const x = (crossing.minX + crossing.maxX) / 2;
    points.push({ x, y: cliff.y + 170 }, { x, y: cliff.y - 170 });
  }
  points.push({ x: 1500, y: 620 });
  return points;
})();
export function trailLength(): number {
  let total = 0;
  for (let index = 1; index < SNOW_TRAIL.length; index++) {
    const a = SNOW_TRAIL[index - 1]!, b = SNOW_TRAIL[index]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export interface FrostgateLandmark {
  id: string; label: string; position: Position; radius: number; note: string; kind: DiscoveryKind;
}
export const FROSTGATE_LANDMARKS: readonly FrostgateLandmark[] = [
  { id: 'frostgate-village', label: 'FROSTGATE VILLAGE', kind: 'camp', position: { x: 1500, y: 15050 }, radius: 92,
    note: 'A handful of lamplit roofs huddle below the cliff. Smoke rises from every chimney.' },
  { id: 'frozen-shrine', label: 'FROZEN SHRINE', kind: 'shrine', position: { x: 600, y: 10500 }, radius: 78,
    note: 'A rune-cut stone stands clear of the drift. Its offering bowl is filled with clear ice.' },
  { id: 'frozen-lake', label: 'FROZEN LAKE', kind: 'ruin', position: { x: 2900, y: 9400 }, radius: 82,
    note: 'The lake is frozen solid. Wind has carved long pale lines across its surface.' },
  { id: 'ice-bridge', label: 'ICE BRIDGE', kind: 'ruin', position: { x: 520, y: 6900 }, radius: 76,
    note: 'A narrow span of packed ice crosses the ravine. The wood beneath it is still sound.' },
  { id: 'high-pass', label: 'HIGH PASS', kind: 'pass', position: { x: 3000, y: 5300 }, radius: 80,
    note: 'A wind-cut notch between two stone walls. Beyond it the air is thin and very still.' },
  { id: 'frost-watchtower', label: 'OLD WATCHTOWER', kind: 'ruin', position: { x: 1500, y: 3500 }, radius: 80,
    note: 'The tower leans with the wind, but its upper window still watches the pass below.' },
  { id: 'summit-beacon', label: 'SUMMIT BEACON', kind: 'shrine', position: { x: 1500, y: 900 }, radius: 86,
    note: 'The beacon is cold. Its clean lens faces the whole mountain, and the sky feels close.' },
];

function spread(count: number, seed: number): Position[] {
  const points: Position[] = [];
  for (let index = 0; index < count; index++) {
    let value = (Math.imul(index + 1, 374761393) + Math.imul(seed, 668265263)) >>> 0;
    value = (value ^ (value >>> 13)) >>> 0; value = Math.imul(value, 1274126177) >>> 0;
    const unit = ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    const band = Math.floor(unit * TERRACES.length);
    const terrace = TERRACES[Math.min(TERRACES.length - 1, band)]!;
    const along = (unit * 977 + index * 173) % 1;
    points.push({
      x: 160 + ((index * 613 + seed * 97) % (SNOW_WORLD.width - 320)),
      y: Math.round(terrace.minY + 80 + along * (terrace.maxY - terrace.minY - 160)),
    });
  }
  return points;
}
/** Authored vegetation and stone. Art and collision share these coordinates. */
export const SNOW_PINES: ReadonlyArray<{ x: number; y: number; scale: number }> = spread(240, 11).map((point, index) => ({
  x: point.x, y: point.y, scale: 0.7 + (index % 4) * 0.12,
}));
export const SNOW_ROCKS: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = spread(180, 23).map(point => ({
  x: point.x, y: point.y, width: 30 + (point.x % 18), height: 12 + (point.y % 9),
}));
export const SNOW_SHRUBS: ReadonlyArray<{ x: number; y: number }> = spread(260, 37);
export const SNOW_ICE: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = spread(140, 53).map(point => ({
  x: point.x, y: point.y, width: 34 + (point.x % 22), height: 10 + (point.y % 8),
}));

export interface FrostgateBuilding {
  id: string; label: string; kind: 'house' | 'shop' | 'ruin';
  x: number; y: number; width: number; height: number;
  door: Position; interior?: string; enterable: boolean; note: string;
}
export const FROSTGATE_BUILDINGS: readonly FrostgateBuilding[] = [
  { id: 'frostgate-hall', label: 'HEARTH HALL', kind: 'house', x: 1250, y: 14920, width: 160, height: 112,
    door: { x: 1330, y: 15032 }, interior: 'hall', enterable: true, note: 'The village hearth burns through the long night.' },
  { id: 'hearth-cottage', label: 'EMBER COTTAGE', kind: 'house', x: 1080, y: 15120, width: 132, height: 100,
    door: { x: 1146, y: 15220 }, interior: 'cottage', enterable: true, note: 'A low roof and a warm little stove.' },
  { id: 'lantern-house', label: 'LANTERN HOUSE', kind: 'house', x: 1560, y: 15060, width: 134, height: 102,
    door: { x: 1627, y: 15162 }, interior: 'lantern', enterable: true, note: 'Shelves of oil and glass, always ready for a traveller.' },
  { id: 'winter-supply', label: 'WINTER SUPPLY', kind: 'shop', x: 1750, y: 14840, width: 144, height: 104,
    door: { x: 1822, y: 14944 }, interior: 'supply', enterable: true, note: 'Rope, wax, iron and dried herbs for the climb.' },
  { id: 'frost-traders', label: 'FROST TRADERS', kind: 'shop', x: 1900, y: 15040, width: 138, height: 100,
    door: { x: 1969, y: 15140 }, enterable: false, note: 'The shutters are down. A painted board lists winter goods.' },
  { id: 'watch-cabin', label: 'WATCH CABIN', kind: 'house', x: 2020, y: 3300, width: 134, height: 100,
    door: { x: 2087, y: 3400 }, interior: 'watch', enterable: true, note: 'A lonely bunk below the old watchtower.' },
  { id: 'abandoned-cabin', label: 'ABANDONED CABIN', kind: 'ruin', x: 470, y: 8800, width: 118, height: 90,
    door: { x: 529, y: 8890 }, enterable: false, note: 'The door hangs open. Snow has drifted across the floor.' },
];

/** Structures that stop walking. Cliff faces are handled separately. */
export const SNOW_OBSTACLES: readonly Rect[] = [
  ...FROSTGATE_BUILDINGS.map(building => ({ x: building.x, y: building.y, width: building.width, height: building.height })),
  ...SNOW_ROCKS,
  ...SNOW_PINES.map(pine => ({ x: pine.x - 6 * pine.scale, y: pine.y - 4 * pine.scale, width: 12 * pine.scale, height: 20 * pine.scale })),
  { x: 560, y: 10450, width: 80, height: 52 },   // frozen shrine stone
  { x: 1430, y: 3420, width: 100, height: 86 },  // old watchtower base
  { x: 1420, y: 840, width: 80, height: 80 },    // summit beacon plinth
];

export interface InteriorProp {
  kind: 'rug' | 'bed' | 'shelf' | 'table' | 'crate' | 'window' | 'lantern' | 'fireplace' | 'barrel' | 'sign' | 'counter' | 'stool' | 'plant';
  x: number; y: number; width: number; height: number; solid?: boolean;
}
export interface Interior {
  id: string; label: string; width: number; height: number;
  entry: Position; exit: Position; exitRadius: number;
  floor: string; wall: string; trim: string; fireplace: boolean; props: readonly InteriorProp[];
}
const INTERIOR_W = 440, INTERIOR_H = 300;
const SHARED_PROPS: readonly InteriorProp[] = [
  { kind: 'window', x: 40, y: 36, width: 34, height: 26 },
  { kind: 'window', x: INTERIOR_W - 74, y: 36, width: 34, height: 26 },
  { kind: 'rug', x: 150, y: 150, width: 140, height: 74 },
  { kind: 'table', x: 200, y: 168, width: 44, height: 30, solid: true },
  { kind: 'crate', x: 56, y: 226, width: 28, height: 26, solid: true },
  { kind: 'lantern', x: 74, y: 92, width: 12, height: 18 },
  { kind: 'lantern', x: INTERIOR_W - 86, y: 92, width: 12, height: 18 },
];
export const INTERIORS: Readonly<Record<string, Interior>> = {
  hall: {
    id: 'hall', label: 'HEARTH HALL', width: INTERIOR_W, height: INTERIOR_H,
    entry: { x: 220, y: 248 }, exit: { x: 220, y: 254 }, exitRadius: 36,
    floor: '#6b4c35', wall: '#4a3529', trim: '#8d6b45', fireplace: true,
    props: [
      ...SHARED_PROPS,
      { kind: 'fireplace', x: 170, y: 34, width: 100, height: 74, solid: true },
      { kind: 'shelf', x: 24, y: 112, width: 66, height: 16, solid: true },
      { kind: 'shelf', x: INTERIOR_W - 90, y: 112, width: 66, height: 16, solid: true },
      { kind: 'stool', x: 178, y: 214, width: 18, height: 14, solid: true },
      { kind: 'stool', x: 246, y: 214, width: 18, height: 14, solid: true },
      { kind: 'plant', x: 384, y: 224, width: 22, height: 30 },
    ],
  },
  cottage: {
    id: 'cottage', label: 'EMBER COTTAGE', width: INTERIOR_W, height: INTERIOR_H,
    entry: { x: 220, y: 248 }, exit: { x: 220, y: 254 }, exitRadius: 36,
    floor: '#745138', wall: '#4d382b', trim: '#96734b', fireplace: true,
    props: [
      ...SHARED_PROPS,
      { kind: 'fireplace', x: 186, y: 36, width: 68, height: 68, solid: true },
      { kind: 'bed', x: 34, y: 132, width: 86, height: 60, solid: true },
      { kind: 'shelf', x: INTERIOR_W - 108, y: 120, width: 74, height: 16, solid: true },
      { kind: 'barrel', x: INTERIOR_W - 60, y: 232, width: 30, height: 34, solid: true },
    ],
  },
  lantern: {
    id: 'lantern', label: 'LANTERN HOUSE', width: INTERIOR_W, height: INTERIOR_H,
    entry: { x: 220, y: 248 }, exit: { x: 220, y: 254 }, exitRadius: 36,
    floor: '#6d5038', wall: '#47362b', trim: '#8f7449', fireplace: false,
    props: [
      ...SHARED_PROPS,
      { kind: 'shelf', x: 24, y: 108, width: 92, height: 16, solid: true },
      { kind: 'shelf', x: 24, y: 150, width: 92, height: 16, solid: true },
      { kind: 'shelf', x: INTERIOR_W - 116, y: 108, width: 92, height: 16, solid: true },
      { kind: 'bed', x: INTERIOR_W - 120, y: 184, width: 88, height: 58, solid: true },
      { kind: 'lantern', x: 130, y: 104, width: 12, height: 18 },
      { kind: 'lantern', x: 296, y: 104, width: 12, height: 18 },
    ],
  },
  supply: {
    id: 'supply', label: 'WINTER SUPPLY', width: INTERIOR_W, height: INTERIOR_H,
    entry: { x: 220, y: 248 }, exit: { x: 220, y: 254 }, exitRadius: 36,
    floor: '#5f4a36', wall: '#3f3228', trim: '#887149', fireplace: false,
    props: [
      ...SHARED_PROPS,
      { kind: 'counter', x: 130, y: 150, width: 180, height: 40, solid: true },
      { kind: 'sign', x: 168, y: 40, width: 104, height: 30 },
      { kind: 'crate', x: 42, y: 176, width: 34, height: 30, solid: true },
      { kind: 'crate', x: 366, y: 176, width: 34, height: 30, solid: true },
      { kind: 'barrel', x: 60, y: 226, width: 30, height: 34, solid: true },
      { kind: 'barrel', x: 350, y: 226, width: 30, height: 34, solid: true },
    ],
  },
  watch: {
    id: 'watch', label: 'WATCH CABIN', width: INTERIOR_W, height: INTERIOR_H,
    entry: { x: 220, y: 248 }, exit: { x: 220, y: 254 }, exitRadius: 36,
    floor: '#604b39', wall: '#3d332e', trim: '#7f6d53', fireplace: true,
    props: [
      ...SHARED_PROPS,
      { kind: 'fireplace', x: 190, y: 38, width: 60, height: 64, solid: true },
      { kind: 'bed', x: 34, y: 140, width: 84, height: 58, solid: true },
      { kind: 'shelf', x: INTERIOR_W - 106, y: 120, width: 72, height: 16, solid: true },
      { kind: 'crate', x: INTERIOR_W - 78, y: 226, width: 30, height: 28, solid: true },
    ],
  },
};

export function interiorBlocks(interior: Interior, x: number, y: number, radius = SNOW_FOOT_RADIUS): boolean {
  if (x - radius < 16 || x + radius > interior.width - 16 || y - radius < 16 || y + radius > interior.height - 16) return true;
  return interior.props.some(prop => prop.solid && x + radius > prop.x && x - radius < prop.x + prop.width
    && y + radius > prop.y && y - radius < prop.y + prop.height);
}
export function buildingAt(x: number, y: number): FrostgateBuilding | null {
  return FROSTGATE_BUILDINGS.find(building => Math.hypot(building.door.x - x, building.door.y - y) <= 58) ?? null;
}
