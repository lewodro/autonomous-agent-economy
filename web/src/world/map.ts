import type { Interactable, Position, Rect } from './model.js';
export const MAP = { width: 1152, height: 864, tile: 32, spawn: { x: 560, y: 480 } };
export interface Building extends Rect { name: string; color: string }
export const BUILDINGS: Building[] = [
  { x: 112, y: 120, width: 256, height: 176, name: 'AGENT HOUSE', color: '#9e7154' },
  { x: 704, y: 120, width: 240, height: 176, name: 'RESEARCH LAB', color: '#71938b' },
  { x: 800, y: 448, width: 256, height: 192, name: 'ARENA', color: '#b18355' },
];
export const TREES: Position[] = [
  {x:60,y:120},{x:65,y:280},{x:60,y:710},{x:340,y:770},{x:1060,y:180},{x:1056,y:350},{x:1030,y:770},
];
const TREE_TRUNKS: Rect[] = TREES.map(({x,y})=>({x,y:y+24,width:12,height:28}));
export const WALLS: Rect[] = [...BUILDINGS,
  { x: 500, y: 340, width: 112, height: 64 }, // plaza fountain
  { x: 184, y: 530, width: 80, height: 48 }, // free table
  { x: 480, y: 720, width: 160, height: 32 }, // archive terminal
  ...TREE_TRUNKS,
];
export const LANDMARKS: Interactable[] = [
  { id: 'arena-door', type: 'arena', position: { x: 928, y: 674 }, radius: 72, label: 'Enter Arena' },
  { id: 'plaza-table', type: 'table', position: { x: 224, y: 609 }, radius: 68, label: 'Sit · free Tic-Tac-Toe' },
  { id: 'archive', type: 'research', position: { x: 560, y: 790 }, radius: 64, label: 'Open research archive' },
];
export function collides(position: Position, walls: Rect[] = WALLS, radius = 12): boolean {
  if (position.x < 40 + radius || position.y < 64 + radius || position.x > MAP.width - 40 - radius || position.y > MAP.height - 40 - radius) return true;
  return walls.some(w => position.x + radius > w.x && position.x - radius < w.x + w.width
    && position.y + radius > w.y && position.y - radius < w.y + w.height);
}
export function safePosition(value: unknown): Position {
  if (value && typeof value === 'object' && 'x' in value && 'y' in value
    && typeof value.x === 'number' && typeof value.y === 'number'
    && Number.isFinite(value.x) && Number.isFinite(value.y) && !collides(value as Position)) return { x: value.x, y: value.y };
  return { ...MAP.spawn };
}
