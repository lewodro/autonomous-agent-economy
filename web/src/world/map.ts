import type { Interactable, Position, Rect } from './model.js';
// World coordinates retain the original plaza coordinates. The canvas extends
// around them, so saved positions and every existing entrance remain valid.
export const MAP = { minX: -896, minY: -576, width: 3584, height: 2304, tile: 32, spawn: { x: 560, y: 480 } };
export const WORLD_BOUNDS = { minX: MAP.minX + 52, minY: MAP.minY + 76,
  maxX: MAP.minX + MAP.width - 52, maxY: MAP.minY + MAP.height - 52 };
export type WorldZone = 'plaza'|'arena'|'research'|'table_area'|'forest'|'forest_edge'|'garden'|'agency'|'path_north'|'path_east'|'west_expansion'|'east_expansion'|'north_expansion'|'south_expansion'|'campfire_clearing';
export const ZONES: Record<WorldZone, Rect> = {
  plaza:{x:320,y:300,width:880,height:620}, arena:{x:780,y:96,width:300,height:620}, research:{x:680,y:96,width:300,height:230},
  forest:{x:1120,y:128,width:440,height:900}, garden:{x:1440,y:480,width:280,height:360}, agency:{x:1440,y:96,width:260,height:260},
  table_area:{x:96,y:416,width:252,height:276},forest_edge:{x:1840,y:80,width:680,height:800},
  path_north:{x:400,y:-520,width:360,height:800}, path_east:{x:960,y:400,width:1160,height:160},
  west_expansion:{x:-820,y:-360,width:800,height:1360},east_expansion:{x:1800,y:-360,width:800,height:1360},
  north_expansion:{x:0,y:-500,width:1600,height:480},south_expansion:{x:0,y:1160,width:1800,height:480},
  campfire_clearing:{x:1930,y:660,width:340,height:280},
};
export interface Building extends Rect { name: string; color: string }
export const BUILDINGS: Building[] = [
  { x: 112, y: 120, width: 256, height: 176, name: 'AGENT HOUSE', color: '#9e7154' },
  { x: 704, y: 120, width: 240, height: 176, name: 'RESEARCH HOUSE', color: '#71938b' },
  { x: 800, y: 448, width: 256, height: 192, name: 'ARENA', color: '#b18355' },
  { x: 1464, y: 128, width: 208, height: 160, name: 'AGENCY', color: '#806b80' },
];
export const TREES: Position[] = [
  {x:60,y:120},{x:65,y:280},{x:60,y:710},{x:340,y:770},{x:1060,y:180},{x:1056,y:350},{x:1030,y:770},
  {x:1160,y:190},{x:1270,y:170},{x:1375,y:230},{x:1190,y:360},{x:1330,y:410},{x:1410,y:560},{x:1160,y:650},{x:1290,y:720},{x:1380,y:760},
];
export const ROCKS: Position[] = [{x:1210,y:260},{x:1360,y:320},{x:1250,y:520},{x:1390,y:650}];
export const CAMPFIRES: Position[] = [{x:1510,y:560},{x:1640,y:760}];
const TREE_TRUNKS: Rect[] = TREES.map(({x,y})=>({x,y:y+24,width:12,height:28}));
export const WALLS: Rect[] = [...BUILDINGS,
  { x: 500, y: 340, width: 112, height: 64 }, // plaza fountain
  { x: 184, y: 530, width: 80, height: 48 }, // free table
  { x: 480, y: 720, width: 160, height: 32 }, // archive terminal
  ...TREE_TRUNKS,
  ...ROCKS.map(({x,y})=>({x:x-12,y:y-8,width:24,height:16})),
];
export const LANDMARKS: Interactable[] = [
  { id: 'arena-door', type: 'arena', position: { x: 928, y: 674 }, radius: 72, label: 'Enter Arena' },
  { id: 'plaza-table', type: 'table', position: { x: 224, y: 609 }, radius: 68, label: 'Sit · free Tic-Tac-Toe' },
  { id: 'archive', type: 'research', position: { x: 560, y: 790 }, radius: 64, label: 'Open arena statistics' },
  { id: 'forest-clearing', type: 'zone', position: { x: 1280, y: 500 }, radius: 86, label: 'Explore forest clearing' },
  { id: 'botanical-garden', type: 'zone', position: { x: 1570, y: 620 }, radius: 86, label: 'Explore botanical garden' },
  { id: 'agent-agency', type: 'zone', position: { x: 1568, y: 318 }, radius: 76, label: 'Visit agent agency' },
];
export function collides(position: Position, walls: Rect[] = WALLS, radius = 12): boolean {
  if (position.x < MAP.minX + 40 + radius || position.y < MAP.minY + 64 + radius
    || position.x > MAP.minX + MAP.width - 40 - radius || position.y > MAP.minY + MAP.height - 40 - radius) return true;
  return walls.some(w => position.x + radius > w.x && position.x - radius < w.x + w.width
    && position.y + radius > w.y && position.y - radius < w.y + w.height);
}
export function safePosition(value: unknown): Position {
  if (value && typeof value === 'object' && 'x' in value && 'y' in value
    && typeof value.x === 'number' && typeof value.y === 'number'
    && Number.isFinite(value.x) && Number.isFinite(value.y) && !collides(value as Position)) return { x: value.x, y: value.y };
  return { ...MAP.spawn };
}
