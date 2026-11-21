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
