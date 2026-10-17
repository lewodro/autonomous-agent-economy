import type { Interactable, Position, Rect } from './model.js';
// World coordinates retain the original plaza coordinates. The canvas extends
// around them, so saved positions and every existing entrance remain valid.
export const MAP = { minX: -896, minY: -576, width: 3584, height: 2304, tile: 32, spawn: { x: 560, y: 480 } };
export const WORLD_BOUNDS = { minX: MAP.minX + 52, minY: MAP.minY + 76,
  maxX: MAP.minX + MAP.width - 52, maxY: MAP.minY + MAP.height - 52 };
export type WorldZone = 'plaza'|'arena'|'research'|'table_area'|'forest'|'forest_edge'|'garden'|'agency'|'path_north'|'path_east'|'west_expansion'|'east_expansion'|'north_expansion'|'south_expansion'|'campfire_clearing';
export const ZONES: Record<WorldZone, Rect> = {
  plaza:{x:320,y:300,width:880,height:620}, arena:{x:780,y:96,width:300,height:620}, research:{x:680,y:96,width:300,height:230},
  forest:{x:1120,y:128,width:440,height:900}, garden:{x:1440,y:460,width:760,height:680}, agency:{x:1440,y:96,width:260,height:260},
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
export interface WorldTree extends Position { scale?: number; tint?: 0|1|2 }
export const TREES: WorldTree[] = [
  {x:60,y:120},{x:65,y:280},{x:60,y:710},{x:340,y:770},{x:1060,y:180},{x:1056,y:350},{x:1030,y:770},
  {x:1160,y:190},{x:1270,y:170},{x:1375,y:230},{x:1190,y:360},{x:1330,y:410},{x:1410,y:560},{x:1160,y:650},{x:1290,y:720},{x:1380,y:760},
  {x:-720,y:-360,scale:1.2,tint:1},{x:-650,y:80,scale:.85,tint:2},{x:-760,y:390,scale:1.15},{x:-540,y:840,scale:.9,tint:1},
  {x:-250,y:1310,scale:1.1,tint:2},{x:240,y:1460,scale:.85},{x:1080,y:1490,scale:1.2,tint:1},
  {x:130,y:-420,scale:.9,tint:2},{x:570,y:-310,scale:1.15},{x:1100,y:-400,scale:.85,tint:1},
  {x:1920,y:-280,scale:1.1,tint:2},{x:2380,y:100,scale:.9},{x:2470,y:690,scale:1.2,tint:1},{x:2330,y:1250,scale:.85,tint:2},
  {x:1520,y:960,scale:1.1,tint:1},{x:1680,y:1060,scale:.85,tint:2},{x:1830,y:990,scale:1.2},
  {x:2020,y:940,scale:.9,tint:1},{x:2140,y:660,scale:1.1,tint:2},{x:2040,y:400,scale:.85},
];
export interface WorldBush extends Position { size: number; solid?: boolean; tint?: 0|1|2 }
export const BUSHES: WorldBush[] = [
  {x:1460,y:680,size:28,solid:true},{x:1520,y:790,size:20,tint:1},{x:1580,y:900,size:26,solid:true,tint:2},
  {x:1690,y:550,size:22,tint:1},{x:1810,y:510,size:30,solid:true},{x:1940,y:590,size:20,tint:2},
  {x:2080,y:780,size:28,solid:true,tint:1},{x:1950,y:1040,size:24,tint:2},
  {x:-580,y:700,size:24,tint:1},{x:-420,y:-180,size:30,solid:true},{x:360,y:-300,size:22,tint:2},
  {x:950,y:1420,size:28,solid:true},{x:2250,y:360,size:24,tint:1},{x:2280,y:1060,size:30,solid:true},
];
export const FLOWER_BEDS: Rect[] = [
  {x:1510,y:600,width:90,height:42},{x:1620,y:830,width:98,height:46},{x:1770,y:570,width:96,height:40},
  {x:1900,y:845,width:102,height:44},{x:2050,y:970,width:94,height:40},
];
export const ROCKS: Position[] = [{x:1210,y:260},{x:1360,y:320},{x:1250,y:520},{x:1390,y:650},{x:2240,y:540},{x:-620,y:1180}];
export const CAMPFIRES: Position[] = [{x:1760,y:740},{x:2180,y:1060},{x:-470,y:970},{x:1040,y:1320}];
// Ordered, collision-free targets provide a cheap loop through every district.
// The NPC controller still uses the existing movement/collision code.
export const NPC_WAYPOINTS: Position[] = [
  {x:430,y:310},{x:640,y:320},{x:740,y:350},{x:660,y:430},{x:430,y:510},
  {x:340,y:430},{x:0,y:430},{x:-300,y:430},{x:-650,y:430},{x:-650,y:760},
  {x:-400,y:900},{x:-200,y:1300},{x:200,y:1370},{x:700,y:1450},
  {x:1050,y:1400},{x:1300,y:1100},{x:1480,y:950},{x:1580,y:860},
  {x:1700,y:780},{x:1870,y:760},{x:2030,y:820},{x:2250,y:880},
  {x:2450,y:600},{x:2420,y:200},{x:2200,y:240},{x:1900,y:400},
  {x:1700,y:400},{x:1500,y:420},{x:1280,y:500},{x:1100,y:500},
  {x:900,y:760},{x:700,y:760},{x:430,y:730},{x:430,y:510},
  {x:480,y:0},{x:480,y:-250},{x:700,y:-350},{x:1100,y:-300},
  {x:1400,y:-180},{x:1200,y:0},{x:800,y:0},{x:480,y:0},
];
/** Developer-only browser probes start just inside the former map edges. */
export const EXPLORATION_PROBES = {
  west:{x:90,y:430},east:{x:1720,y:430},north:{x:600,y:100},south:{x:700,y:1060},
  garden:{x:1830,y:750},campfire:{x:1760,y:680},
} satisfies Record<string,Position>;
const TREE_TRUNKS: Rect[] = TREES.map(({x,y,scale=1})=>({x,y:y+24*scale,width:12*scale,height:28*scale}));
export const WALLS: Rect[] = [...BUILDINGS,
  { x: 500, y: 340, width: 112, height: 64 }, // plaza fountain
  { x: 184, y: 530, width: 80, height: 48 }, // free table
  { x: 480, y: 720, width: 160, height: 32 }, // archive terminal
  ...TREE_TRUNKS,
  ...BUSHES.filter(bush=>bush.solid).map(({x,y,size})=>({x:x-size/2,y:y-size/3,width:size,height:size/2})),
  ...ROCKS.map(({x,y})=>({x:x-12,y:y-8,width:24,height:16})),
  ...CAMPFIRES.map(({x,y})=>({x:x-12,y:y-8,width:24,height:20})),
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
