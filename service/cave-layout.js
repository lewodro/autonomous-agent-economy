/**
 * The single source of truth for the first cave system. The server uses the
 * same geometry for collision/range validation and serves it read-only to the
 * browser, so there is no second hand-maintained client map.
 *
 * Coordinates are level-local. Nothing here is persisted or randomly
 * generated: a reset simply recreates the base monsters from these anchors.
 */
export const CAVE_RESET_MS = 7 * 60 * 1000;
export const CAVE_PLAYER_SPEED = 150;
export const CAVE_MAX_HP = 100;
export const CAVE_ATTACK_DAMAGE = 12;
export const CAVE_ATTACK_RANGE = 62;
export const CAVE_PLAYER_RADIUS = 12;

const rect = (x, y, width, height) => ({ x, y, width, height });

export const CAVE_LEVELS = [
  {
    level: 1, name: 'ENTRANCE', ambient: 0.18,
    bounds: rect(0, 0, 960, 720),
    entry: { x: 140, y: 340 }, exit: { x: 112, y: 168 }, descent: { x: 420, y: 590 },
    rooms: [
      rect(80, 80, 360, 280), rect(440, 200, 180, 64), rect(620, 120, 260, 260),
      rect(200, 360, 64, 160), rect(120, 520, 360, 140),
    ],
    torches: [
      { x: 128, y: 132, radius: 170 }, { x: 380, y: 132, radius: 150 },
      { x: 668, y: 172, radius: 140 }, { x: 846, y: 344, radius: 140 },
      { x: 164, y: 566, radius: 130 },
    ],
    props: [
      { kind: 'rubble', x: 300, y: 250 }, { kind: 'bones', x: 210, y: 190 },
      { kind: 'crate', x: 700, y: 250 }, { kind: 'crystal', x: 820, y: 180 },
      { kind: 'pillar', x: 740, y: 330 }, { kind: 'crystal', x: 300, y: 612 },
    ],
    monsters: [
      { id: 'crawler-1', kind: 'crawler', x: 340, y: 170, hp: 24, damage: 5, speed: 62, aggro: 210, range: 42, cooldownMs: 1200, reward: 2 },
      { id: 'crawler-2', kind: 'crawler', x: 250, y: 610, hp: 24, damage: 5, speed: 62, aggro: 210, range: 42, cooldownMs: 1200, reward: 2 },
    ],
  },
  {
    level: 2, name: 'NARROW WAYS', ambient: 0.1,
    bounds: rect(0, 0, 960, 720),
    entry: { x: 140, y: 360 }, exit: null, descent: { x: 780, y: 650 },
    rooms: [
      rect(80, 260, 280, 240), rect(360, 350, 200, 56),
      rect(560, 180, 300, 260), rect(680, 440, 56, 160), rect(520, 600, 300, 100),
    ],
    torches: [
      { x: 120, y: 300, radius: 130 }, { x: 600, y: 220, radius: 120 }, { x: 820, y: 620, radius: 110 },
    ],
    props: [
      { kind: 'bones', x: 180, y: 440 }, { kind: 'rubble', x: 310, y: 320 },
      { kind: 'crystal', x: 790, y: 250 }, { kind: 'crate', x: 640, y: 380 },
      { kind: 'pillar', x: 860, y: 400 }, { kind: 'bones', x: 600, y: 640 },
    ],
    monsters: [
      { id: 'bat-2-1', kind: 'bat', x: 260, y: 320, hp: 18, damage: 4, speed: 88, aggro: 240, range: 38, cooldownMs: 1000, reward: 2 },
      { id: 'crawler-2-1', kind: 'crawler', x: 700, y: 260, hp: 28, damage: 6, speed: 66, aggro: 220, range: 42, cooldownMs: 1100, reward: 3 },
      { id: 'stone-2', kind: 'stone', x: 820, y: 380, hp: 40, damage: 8, speed: 48, aggro: 200, range: 46, cooldownMs: 1500, reward: 4 },
      { id: 'bat-2-2', kind: 'bat', x: 620, y: 640, hp: 18, damage: 4, speed: 88, aggro: 240, range: 38, cooldownMs: 1000, reward: 2 },
    ],
  },
  {
    level: 3, name: 'DEEP CHAMBER', ambient: 0.05,
    bounds: rect(0, 0, 960, 720),
    entry: { x: 140, y: 360 }, exit: null, descent: null,
    rooms: [
      rect(80, 260, 240, 220), rect(320, 340, 220, 56), rect(540, 160, 340, 420),
    ],
    torches: [
      { x: 120, y: 300, radius: 110 }, { x: 600, y: 210, radius: 105 }, { x: 820, y: 540, radius: 95 },
    ],
    props: [
      { kind: 'bones', x: 180, y: 420 }, { kind: 'rubble', x: 390, y: 350 },
      { kind: 'crystal', x: 640, y: 480 }, { kind: 'crystal', x: 800, y: 220 },
      { kind: 'pillar', x: 700, y: 320 }, { kind: 'crate', x: 600, y: 540 },
    ],
    monsters: [
      { id: 'bat-3-1', kind: 'bat', x: 660, y: 260, hp: 22, damage: 5, speed: 92, aggro: 250, range: 38, cooldownMs: 950, reward: 3 },
      { id: 'stone-3-1', kind: 'stone', x: 790, y: 470, hp: 46, damage: 9, speed: 50, aggro: 220, range: 46, cooldownMs: 1400, reward: 5 },
      { id: 'warden', kind: 'stone', x: 780, y: 320, hp: 66, damage: 12, speed: 44, aggro: 280, range: 52, cooldownMs: 1300, reward: 10, boss: true },
    ],
  },
];

export function caveLevel(level) {
  return CAVE_LEVELS.find(value => value.level === level) ?? null;
}

/** Walkable space is the union of chambers and passages, shrunk by the actor radius. */
export function isCaveWalkable(level, point, radius = CAVE_PLAYER_RADIUS) {
  const config = caveLevel(level);
  if (!config || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return config.rooms.some(room => point.x >= room.x + radius && point.x <= room.x + room.width - radius
    && point.y >= room.y + radius && point.y <= room.y + room.height - radius);
}

/** Public copy the browser can cache; no monster health or encounter state. */
export function publicCaveLayout() {
  return {
    reset_ms: CAVE_RESET_MS,
    player_speed: CAVE_PLAYER_SPEED,
    attack_damage: CAVE_ATTACK_DAMAGE,
    attack_range: CAVE_ATTACK_RANGE,
    max_hp: CAVE_MAX_HP,
    levels: CAVE_LEVELS.map(level => ({
      level: level.level, name: level.name, ambient: level.ambient, bounds: level.bounds,
      entry: level.entry, exit: level.exit, descent: level.descent,
      rooms: level.rooms.map(room => ({ ...room })),
      torches: level.torches.map(torch => ({ ...torch })),
      props: level.props.map(prop => ({ ...prop })),
      monster_kinds: level.monsters.map(monster => ({ id: monster.id, kind: monster.kind, boss: Boolean(monster.boss) })),
    })),
  };
}
