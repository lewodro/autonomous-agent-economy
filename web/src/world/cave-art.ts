/**
 * Original pixel art for the cave encounter. Everything is painted with small
 * rectangles on the existing cave canvas: there are no per-frame sprite
 * canvases and no second asset pipeline to keep in sync.
 */
export interface CaveMonsterView {
  id: string; kind: string; boss: boolean; x: number; y: number;
  hp: number; max_hp: number; alive: boolean; state: string; hit: boolean;
}
export interface CaveChestView { id: string; x: number; y: number; opened: boolean }

const rect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void => {
  c.fillStyle = color; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

function shadow(c: CanvasRenderingContext2D, x: number, y: number, width: number): void {
  c.fillStyle = '#050a0880';
  c.beginPath(); c.ellipse(Math.round(x), Math.round(y), width, Math.max(3, Math.round(width * 0.3)), 0, 0, Math.PI * 2); c.fill();
}

function healthBar(c: CanvasRenderingContext2D, monster: CaveMonsterView): void {
  if (!monster.alive || monster.hp >= monster.max_hp) return;
  const width = monster.boss ? 30 : 22;
  const x = Math.round(monster.x - width / 2), y = Math.round(monster.y - (monster.boss ? 34 : 25));
  rect(c, x, y, width, 4, '#1b1715');
  rect(c, x + 1, y + 1, Math.max(0, Math.round((width - 2) * monster.hp / monster.max_hp)), 2, monster.hp / monster.max_hp < 0.35 ? '#d95c4a' : '#d7a45a');
}

function deadMonster(c: CanvasRenderingContext2D, monster: CaveMonsterView): void {
  const { x, y } = monster;
  rect(c, x - 9, y + 4, 18, 3, '#241c18');
  // A small skull and ribs read as a defeated creature rather than a flat box.
  rect(c, x - 5, y - 1, 10, 7, '#c9c1a1');
  rect(c, x - 3, y, 2, 2, '#2a2520'); rect(c, x + 2, y, 2, 2, '#2a2520');
  rect(c, x - 4, y + 5, 8, 2, '#b3ab8f');
  rect(c, x - 8, y + 7, 4, 2, '#9f987f'); rect(c, x + 5, y + 7, 4, 2, '#9f987f');
  rect(c, x - 2, y + 8, 5, 2, '#8d8772');
}

function crawler(c: CanvasRenderingContext2D, monster: CaveMonsterView, time: number, reduced: boolean): void {
  const { x, y } = monster;
  const step = reduced ? 0 : Math.floor(time / 190 + x) % 2;
  const lunge = monster.state === 'attack' && !reduced ? 2 : 0;
  const body = monster.hit ? '#e14b3f' : monster.state === 'attack' ? '#9c4f3c' : '#7d4f3a';
  const shell = monster.hit ? '#ff7162' : monster.state === 'attack' ? '#c26d4c' : '#a97452';
  shadow(c, x, y + 9, 16);
  // Six legs, offset each animation frame.
  for (let leg = 0; leg < 3; leg++) {
    const lx = x - 10 + leg * 7, ly = y + 2 + (leg % 2 ? step : 1 - step);
    rect(c, lx, ly, 4, 2, '#3d2a22'); rect(c, lx + 1, ly + 2, 2, 3, '#3d2a22');
    const rx = x + 4 + leg * 3, ry = y + 2 + (leg % 2 ? 1 - step : step);
    rect(c, rx, ry, 4, 2, '#3d2a22'); rect(c, rx + 1, ry + 2, 2, 3, '#3d2a22');
  }
  // Segmented shell with a lighter ridge.
  rect(c, x - 11, y - 7 + lunge, 22, 10, '#5f3a2c');
  rect(c, x - 9, y - 9 + lunge, 18, 9, body);
  rect(c, x - 5, y - 10 + lunge, 11, 7, shell);
  rect(c, x - 2, y - 8 + lunge, 5, 3, '#d7a36c');
  rect(c, x - 7, y - 3 + lunge, 14, 3, '#5f3a2c');
  // Head and mandibles.
  rect(c, x - 5, y + 4 + lunge, 10, 6, body);
  rect(c, x - 7, y + 6 + lunge, 3, 2, '#3d2a22'); rect(c, x + 4, y + 6 + lunge, 3, 2, '#3d2a22');
  rect(c, x - 3, y + 5 + lunge, 2, 2, '#f3c766'); rect(c, x + 2, y + 5 + lunge, 2, 2, '#f3c766');
  rect(c, x - 2, y + 9 + lunge, 4, 2, '#4a2c22');
  if (monster.boss) { rect(c, x - 9, y - 13 + lunge, 4, 4, '#d7a36c'); rect(c, x + 6, y - 13 + lunge, 4, 4, '#d7a36c'); }
}

function bat(c: CanvasRenderingContext2D, monster: CaveMonsterView, time: number, reduced: boolean): void {
  const { x, y } = monster;
  const hover = reduced ? 0 : Math.round(Math.sin(time / 260 + x) * 2);
  const flap = reduced ? 0 : Math.floor(time / 120 + x) % 2;
  const attack = monster.state === 'attack';
  const body = monster.hit ? '#e14b3f' : attack ? '#8e5a76' : '#6d5a8c';
  const wing = monster.hit ? '#ff7162' : attack ? '#b97791' : '#4f406b';
  shadow(c, x, y + 12, 10);
  const cy = y - 2 + hover + (attack ? 3 : 0);
  // Wide membrane wings with a two-frame flap.
  if (flap === 0) {
    rect(c, x - 16, cy - 4, 6, 3, wing); rect(c, x - 13, cy - 1, 5, 4, wing); rect(c, x - 10, cy + 2, 4, 3, wing);
    rect(c, x + 10, cy - 4, 6, 3, wing); rect(c, x + 8, cy - 1, 5, 4, wing); rect(c, x + 6, cy + 2, 4, 3, wing);
  } else {
    rect(c, x - 15, cy + 2, 6, 3, wing); rect(c, x - 12, cy - 2, 5, 4, wing); rect(c, x - 9, cy - 5, 4, 3, wing);
    rect(c, x + 9, cy + 2, 6, 3, wing); rect(c, x + 7, cy - 2, 5, 4, wing); rect(c, x + 5, cy - 5, 4, 3, wing);
  }
  // Furred body, ears and bright eyes.
  rect(c, x - 5, cy - 5, 10, 12, '#4a3a5f');
  rect(c, x - 4, cy - 7, 8, 8, body);
  rect(c, x - 6, cy - 10, 3, 5, body); rect(c, x + 3, cy - 10, 3, 5, body);
  rect(c, x - 4, cy - 9, 2, 3, '#b99fc8'); rect(c, x + 2, cy - 9, 2, 3, '#b99fc8');
  rect(c, x - 3, cy - 4, 2, 2, attack ? '#f0c05a' : '#e8d9a4');
  rect(c, x + 2, cy - 4, 2, 2, attack ? '#f0c05a' : '#e8d9a4');
  rect(c, x - 2, cy + 3, 4, 3, '#352b45');
  if (monster.boss) { rect(c, x - 7, cy - 13, 3, 4, '#d7b675'); rect(c, x + 4, cy - 13, 3, 4, '#d7b675'); }
}

function stone(c: CanvasRenderingContext2D, monster: CaveMonsterView, time: number, reduced: boolean): void {
  const { x, y } = monster;
  const size = monster.boss ? 1.3 : 1;
  const bob = reduced ? 0 : Math.round(Math.sin(time / 420 + x) * 1);
  const attack = monster.state === 'attack';
  const lift = attack ? 3 : 0;
  shadow(c, x, y + 11 * size, 16 * size);
  // Chunky legs and a broad rocky torso.
  rect(c, x - 8 * size, y + 5 * size, 5 * size, 7 * size, '#4d5750');
  rect(c, x + 3 * size, y + 5 * size, 5 * size, 7 * size, '#4d5750');
  rect(c, x - 11 * size, y - 9 * size + bob, 22 * size, 16 * size, monster.hit ? '#d43f36' : '#59635b');
  rect(c, x - 8 * size, y - 12 * size + bob, 16 * size, 15 * size, monster.hit ? '#ed6255' : '#7f8a83');
  rect(c, x - 5 * size, y - 10 * size + bob, 9 * size, 8 * size, monster.hit ? '#ff8878' : '#98a299');
  // Arms rise when the creature attacks.
  rect(c, x - 14 * size, y - 6 * size - lift + bob, 5 * size, 11 * size, '#6a746d');
  rect(c, x + 9 * size, y - 6 * size - lift + bob, 5 * size, 11 * size, '#6a746d');
  // Cracks and moss.
  rect(c, x - 2 * size, y - 9 * size + bob, 2, 8 * size, '#4d5750');
  rect(c, x + 4 * size, y - 6 * size + bob, 3, 2, '#4d5750');
  rect(c, x - 9 * size, y - 4 * size + bob, 3, 2, '#5c7d58');
  rect(c, x + 7 * size, y - 10 * size + bob, 2, 3, '#5c7d58');
  // Glowing eyes.
  const eye = attack ? '#ffb45c' : '#d9c987';
  rect(c, x - 4 * size, y - 4 * size + bob, 2, 2, eye);
  rect(c, x + 3 * size, y - 4 * size + bob, 2, 2, eye);
  if (monster.boss) {
    rect(c, x - 8 * size, y - 15 * size + bob, 4, 5, '#8c968a');
    rect(c, x + 5 * size, y - 15 * size + bob, 4, 5, '#8c968a');
  }
}

function grizzly(c: CanvasRenderingContext2D, monster: CaveMonsterView, time: number, reduced: boolean): void {
  const { x, y } = monster;
  const bob = reduced ? 0 : Math.round(Math.sin(time / 360 + x) * 1);
  const lunge = monster.state === 'attack' ? 3 : 0;
  const fur = monster.hit ? '#e14b3f' : '#6f4932';
  const light = monster.hit ? '#ff7868' : '#9a6845';
  shadow(c, x, y + 15, 20);
  rect(c, x - 15, y - 11 + bob + lunge, 30, 23, fur);
  rect(c, x - 11, y - 20 + bob + lunge, 22, 15, light);
  rect(c, x - 13, y - 23 + bob + lunge, 6, 6, fur);
  rect(c, x + 7, y - 23 + bob + lunge, 6, 6, fur);
  rect(c, x - 8, y - 16 + bob + lunge, 4, 3, '#211814');
  rect(c, x + 4, y - 16 + bob + lunge, 4, 3, '#211814');
  rect(c, x - 5, y - 10 + bob + lunge, 10, 6, '#c18d63');
  rect(c, x - 2, y - 9 + bob + lunge, 4, 3, '#241916');
  rect(c, x - 16, y + 6 + bob, 7, 13, fur);
  rect(c, x + 9, y + 6 + bob, 7, 13, fur);
  rect(c, x - 12, y + 10 + bob, 8, 11, '#513526');
  rect(c, x + 4, y + 10 + bob, 8, 11, '#513526');
}

export function drawCaveMonster(c: CanvasRenderingContext2D, monster: CaveMonsterView, time: number, reduced: boolean): void {
  if (!monster.alive) { deadMonster(c, monster); return; }
  if (monster.kind === 'grizzly') grizzly(c, monster, time, reduced);
  else if (monster.kind === 'bat') bat(c, monster, time, reduced);
  else if (monster.kind === 'stone') stone(c, monster, time, reduced);
  else crawler(c, monster, time, reduced);
  healthBar(c, monster);
}

export function drawCaveChest(c: CanvasRenderingContext2D, chest: CaveChestView, time: number, reduced: boolean): void {
  const { x, y } = chest;
  shadow(c, x, y + 9, 13);
  if (chest.opened) {
    rect(c, x - 11, y - 2, 22, 12, '#5d4631');
    rect(c, x - 9, y, 18, 8, '#1a1410');
    rect(c, x - 11, y - 7, 22, 5, '#8b6b46');
    rect(c, x - 11, y - 9, 22, 3, '#d4a94e');
    rect(c, x - 3, y - 4, 6, 2, '#d4a94e');
    return;
  }
  const glint = !reduced && Math.floor(time / 420 + x) % 3 === 0;
  rect(c, x - 11, y - 3, 22, 13, '#5d4631');
  rect(c, x - 10, y - 1, 20, 10, '#8b6b46');
  rect(c, x - 10, y - 8, 20, 6, '#a47d50');
  rect(c, x - 11, y - 10, 22, 3, '#d4a94e');
  rect(c, x - 11, y - 2, 22, 2, '#d4a94e');
  rect(c, x - 2, y - 1, 5, 6, '#d4a94e');
  rect(c, x, y + 1, 2, 2, '#4a3626');
  if (glint) { rect(c, x + 8, y - 14, 2, 2, '#f5dfa0'); rect(c, x + 11, y - 11, 1, 1, '#f5dfa0'); }
}

/* ------------------------------------------------------------------------- *
 * Static cave scenery. One deterministic painting per floor keeps the rooms
 * rich without per-frame noise or heavy asset loading. Everything is built
 * from small rects so the cave shares the overworld's restrained pixel look.
 * ------------------------------------------------------------------------- */

export interface CaveFloorLayout {
  level: number;
  bounds: { x: number; y: number; width: number; height: number };
  rooms: ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
  torches: ReadonlyArray<{ x: number; y: number }>;
  props: ReadonlyArray<{ kind: string; x: number; y: number }>;
  descent?: { x: number; y: number } | null;
  exit?: { x: number; y: number } | null;
}

interface CavePalette {
  rock: string; floor: string; light: string; dark: string; edge: string;
  wood: string; metal: string; bone: string; crystal: string; water: string; moss: string;
}

const CAVE_PALETTES: Record<number, CavePalette> = {
  1: { rock: '#131d18', floor: '#2f3c34', light: '#39483d', dark: '#26332c', edge: '#4d5c4c',
    wood: '#6c5137', metal: '#8a8a78', bone: '#c9c1a1', crystal: '#8fd0dc', water: '#3f6f70', moss: '#5b7b52' },
  2: { rock: '#101815', floor: '#29352f', light: '#324038', dark: '#212d27', edge: '#42534a',
    wood: '#5e4833', metal: '#7d847b', bone: '#bdb99d', crystal: '#87c5d4', water: '#365e63', moss: '#4d6b47' },
  3: { rock: '#0c1311', floor: '#23302c', light: '#2b3a34', dark: '#1b2723', edge: '#3b4e44',
    wood: '#503c2c', metal: '#6f7871', bone: '#b3ae93', crystal: '#9adbe6', water: '#2e5057', moss: '#456043' },
};

/** Small deterministic hash. The same floor always paints the same scenery. */
function hash(seed: number, x: number, y: number): number {
  let value = Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263) ^ Math.imul(seed, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function cluster(c: CanvasRenderingContext2D, kind: string, x: number, y: number, pal: CavePalette, seed: number): void {
  const r = hash(seed, x, y);
  if (kind === 'stones') {
    rect(c, x - 10, y + 2, 8, 5, pal.light); rect(c, x - 8, y, 5, 4, pal.edge);
    rect(c, x + 1, y + 3, 7, 4, pal.dark); rect(c, x + 4, y + 1, 5, 4, pal.light);
    rect(c, x - 3, y + 6, 4, 2, pal.edge);
  } else if (kind === 'crack') {
    rect(c, x - 12, y, 9, 2, pal.rock); rect(c, x - 4, y + 1, 3, 6, pal.rock);
    rect(c, x - 2, y + 6, 8, 2, pal.rock); rect(c, x + 5, y + 7, 3, 5, pal.rock);
    rect(c, x - 11, y - 1, 8, 1, pal.edge);
  } else if (kind === 'rubble') {
    for (let index = 0; index < 6; index++) {
      const ox = Math.round((hash(seed + index, x, y) - 0.5) * 22);
      const oy = Math.round((hash(seed + index, y, x) - 0.5) * 14);
      rect(c, x + ox, y + oy, 3 + index % 3, 3, index % 2 ? pal.light : pal.edge);
    }
    rect(c, x - 8, y + 5, 16, 2, pal.dark);
  } else if (kind === 'bones') {
    rect(c, x - 8, y + 1, 14, 3, pal.bone); rect(c, x - 10, y, 4, 5, pal.bone);
    rect(c, x + 5, y, 4, 5, pal.bone); rect(c, x - 3, y + 4, 7, 2, pal.bone);
    rect(c, x - 5, y - 2, 3, 3, pal.bone);
  } else if (kind === 'crystal') {
    rect(c, x - 5, y - 10, 4, 12, pal.crystal); rect(c, x + 1, y - 14, 5, 16, pal.crystal);
    rect(c, x - 4, y - 8, 2, 7, '#e0f5f7'); rect(c, x + 2, y - 12, 2, 9, '#e0f5f7');
    rect(c, x - 7, y + 2, 16, 3, pal.dark);
  } else if (kind === 'moss') {
    rect(c, x - 10, y + 3, 7, 3, pal.moss); rect(c, x - 4, y + 1, 9, 4, pal.moss);
    rect(c, x + 2, y + 4, 8, 3, pal.moss); rect(c, x - 2, y, 3, 3, '#6f925b');
  } else if (kind === 'pit') {
    rect(c, x - 15, y - 7, 30, 16, pal.rock); rect(c, x - 12, y - 4, 24, 10, '#070b09');
    rect(c, x - 16, y - 8, 32, 2, pal.edge); rect(c, x - 16, y + 8, 32, 2, pal.light);
  } else if (kind === 'water') {
    rect(c, x - 12, y - 5, 24, 12, pal.dark); rect(c, x - 10, y - 3, 20, 8, pal.water);
    rect(c, x - 7, y - 2, 8, 2, '#7fb6b4'); rect(c, x + 3, y + 2, 5, 1, '#7fb6b4');
  } else if (kind === 'support') {
    rect(c, x - 4, y - 24, 8, 52, pal.wood); rect(c, x - 12, y - 22, 24, 5, pal.wood);
    rect(c, x - 11, y + 16, 22, 5, pal.wood); rect(c, x - 3, y - 22, 2, 48, '#4a3828');
    rect(c, x - 12, y - 21, 3, 3, pal.metal); rect(c, x + 9, y - 21, 3, 3, pal.metal);
  } else if (kind === 'tools') {
    rect(c, x - 8, y + 4, 16, 2, pal.wood); rect(c, x - 2, y - 8, 4, 13, pal.wood);
    rect(c, x - 8, y - 9, 16, 3, pal.metal); rect(c, x - 10, y - 8, 3, 4, pal.metal);
    rect(c, x + 7, y - 8, 3, 4, pal.metal);
  } else if (kind === 'stalagmite') {
    rect(c, x - 5, y + 2, 10, 10, pal.edge); rect(c, x - 3, y - 6, 6, 9, pal.light);
    rect(c, x - 1, y - 12, 2, 7, pal.edge); rect(c, x - 8, y + 10, 16, 2, pal.dark);
  } else {
    // Broken mine cart.
    rect(c, x - 12, y - 6, 24, 12, pal.wood); rect(c, x - 10, y - 3, 20, 7, pal.dark);
    rect(c, x - 9, y + 7, 4, 4, pal.metal); rect(c, x + 6, y + 7, 4, 4, pal.metal);
    rect(c, x - 14, y - 8, 6, 3, pal.metal);
  }
  if (r > 0.9) rect(c, x + 12, y - 6, 2, 2, pal.edge);
}

const CLUSTER_KINDS = ['stones', 'crack', 'rubble', 'bones', 'crystal', 'moss', 'pit', 'water', 'support', 'tools', 'stalagmite', 'cart'];

/** Paints floors, rough walls and clustered props. Monsters and torches stay dynamic. */
export function paintCaveFloor(c: CanvasRenderingContext2D, layout: CaveFloorLayout): void {
  // Generated depths keep the deepest palette instead of falling back to the bright entrance.
  const pal = CAVE_PALETTES[Math.min(layout.level, 3)] ?? CAVE_PALETTES[3]!;
  rect(c, layout.bounds.x, layout.bounds.y, layout.bounds.width, layout.bounds.height, pal.rock);
  for (let index = 0; index < layout.rooms.length; index++) {
    const room = layout.rooms[index]!;
    for (let y = room.y; y < room.y + room.height; y += 12) {
      for (let x = room.x; x < room.x + room.width; x += 12) {
        const value = hash(index + layout.level * 17, x, y);
        rect(c, x, y, 12, 12, value < 0.12 ? pal.dark : value > 0.9 ? pal.light : pal.floor);
        if (value > 0.96) rect(c, x + 5, y + 6, 2, 2, pal.edge);
      }
    }
    // Stepped rock border rather than one smooth rectangle outline.
    for (let x = room.x; x < room.x + room.width; x += 8) {
      const top = hash(index + 31, x, room.y) > 0.4 ? 6 : 10;
      const bottom = hash(index + 47, x, room.y + room.height) > 0.4 ? 6 : 10;
      rect(c, x, room.y, 8, top, pal.edge);
      rect(c, x, room.y + room.height - bottom, 8, bottom, pal.dark);
    }
    for (let y = room.y; y < room.y + room.height; y += 8) {
      const left = hash(index + 61, room.x, y) > 0.4 ? 5 : 9;
      const right = hash(index + 79, room.x + room.width, y) > 0.4 ? 5 : 9;
      rect(c, room.x, y, left, 8, pal.edge);
      rect(c, room.x + room.width - right, y, right, 8, pal.dark);
    }
    // Stalactites hang from the upper wall in deeper rooms.
    if (layout.level >= 2) {
      for (let x = room.x + 20; x < room.x + room.width - 12; x += 34) {
        if (hash(index + 97, x, room.y) < 0.5) continue;
        const length = 8 + Math.floor(hash(index + 113, x, room.y) * 10);
        rect(c, x, room.y + 6, 5, length, pal.light);
        rect(c, x + 1, room.y + 6, 2, Math.max(3, length - 4), pal.edge);
      }
    }
    const clusterCount = 4 + Math.min(5, Math.floor(room.width * room.height / 14_000));
    for (let i = 0; i < clusterCount; i++) {
      const cx = room.x + 24 + Math.floor(hash(index * 13 + i, room.x, room.y) * Math.max(1, room.width - 48));
      const cy = room.y + 22 + Math.floor(hash(index * 17 + i, room.y, room.x) * Math.max(1, room.height - 44));
      const kind = CLUSTER_KINDS[Math.floor(hash(index * 19 + i, cx, cy) * CLUSTER_KINDS.length)]!;
      cluster(c, kind, cx, cy, pal, index * 29 + i);
    }
  }
  // Layout props get a richer silhouette than the old four-pixel blocks.
  for (const prop of layout.props) {
    if (prop.kind === 'crystal') cluster(c, 'crystal', prop.x, prop.y, pal, 211);
    else if (prop.kind === 'bones') cluster(c, 'bones', prop.x, prop.y, pal, 223);
    else if (prop.kind === 'rubble') cluster(c, 'rubble', prop.x, prop.y, pal, 227);
    else if (prop.kind === 'crate') {
      rect(c, prop.x - 11, prop.y - 8, 22, 16, pal.wood);
      rect(c, prop.x - 9, prop.y - 6, 18, 12, '#8b6b46');
      rect(c, prop.x - 9, prop.y - 6, 18, 2, '#4a3828');
      rect(c, prop.x - 2, prop.y - 6, 3, 12, '#4a3828');
    } else {
      rect(c, prop.x - 7, prop.y - 12, 14, 26, pal.edge);
      rect(c, prop.x - 4, prop.y - 10, 8, 22, pal.light);
      rect(c, prop.x - 8, prop.y - 3, 16, 4, pal.dark);
    }
  }
  for (const torch of layout.torches) {
    rect(c, torch.x - 5, torch.y - 2, 10, 4, pal.metal);
    rect(c, torch.x - 2, torch.y + 1, 4, 9, pal.wood);
    rect(c, torch.x - 7, torch.y - 3, 3, 6, pal.metal);
    rect(c, torch.x + 4, torch.y - 3, 3, 6, pal.metal);
  }
  if (layout.exit) {
    const { x, y } = layout.exit;
    rect(c, x - 20, y - 14, 40, 28, pal.edge);
    rect(c, x - 14, y - 10, 28, 22, pal.rock);
    rect(c, x - 11, y - 8, 22, 18, pal.wood);
    rect(c, x - 11, y - 8, 22, 3, '#4a3828');
    rect(c, x + 6, y + 2, 3, 3, pal.metal);
  }
  if (layout.descent) {
    const { x, y } = layout.descent;
    rect(c, x - 20, y - 13, 40, 26, pal.edge);
    rect(c, x - 15, y - 9, 30, 19, '#080d0b');
    for (let step = 0; step < 4; step++) rect(c, x - 12 + step * 2, y - 6 + step * 5, 24 - step * 4, 3, pal.light);
  }
}

const floorCache = new Map<number, HTMLCanvasElement>();

/** Browser-side cache. The floor is painted once per level, not every frame. */
export function caveFloorCanvas(layout: CaveFloorLayout): HTMLCanvasElement {
  const cached = floorCache.get(layout.level);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = layout.bounds.width; canvas.height = layout.bounds.height;
  const context = canvas.getContext('2d');
  if (context) { context.imageSmoothingEnabled = false; paintCaveFloor(context, layout); }
  floorCache.set(layout.level, canvas);
  return canvas;
}
