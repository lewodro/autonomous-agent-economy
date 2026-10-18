import type { Interactable, Position, Rect } from './model.js';
// World coordinates retain the original plaza coordinates. The canvas extends
// around them, so saved positions and every existing entrance remain valid.
export const MAP = { minX: -896, minY: -576, width: 3584, height: 2304, tile: 32, spawn: { x: 560, y: 480 } };
export const WORLD_BOUNDS = { minX: MAP.minX + 52, minY: MAP.minY + 76,
  maxX: MAP.minX + MAP.width - 52, maxY: MAP.minY + MAP.height - 52 };
export type WorldZone = 'plaza'|'arena'|'research'|'table_area'|'forest'|'forest_edge'|'garden'|'agency'|'market'|'path_north'|'path_east'|'west_expansion'|'east_expansion'|'north_expansion'|'south_expansion'|'campfire_clearing';
export const ZONES: Record<WorldZone, Rect> = {
  plaza:{x:320,y:300,width:880,height:620}, arena:{x:780,y:96,width:300,height:620}, research:{x:680,y:96,width:300,height:230},
  forest:{x:1120,y:128,width:440,height:900}, garden:{x:1440,y:460,width:760,height:680}, agency:{x:1440,y:96,width:260,height:260},
  table_area:{x:96,y:416,width:252,height:276},forest_edge:{x:1840,y:80,width:680,height:800},
  path_north:{x:400,y:-520,width:360,height:800}, path_east:{x:1056,y:420,width:704,height:300},
  west_expansion:{x:-820,y:-360,width:800,height:1360},east_expansion:{x:1800,y:-360,width:800,height:1360},
  north_expansion:{x:0,y:-500,width:1600,height:480},south_expansion:{x:0,y:1160,width:1800,height:480},
  campfire_clearing:{x:1930,y:660,width:340,height:280},
  market:{x:280,y:1120,width:1240,height:530},
};
export type BuildingKind = 'major'|'house'|'stall';
export interface Building extends Rect { name:string;color:string;roof?:string;accent?:string;kind?:BuildingKind }
export const BUILDINGS: Building[] = [
  { x:112,y:120,width:256,height:176,name:'AGENT HOUSE',color:'#9e7154',roof:'#493d3a',kind:'major' },
  { x:704,y:120,width:240,height:176,name:'RESEARCH HOUSE',color:'#71938b',roof:'#344845',kind:'major' },
  { x:800,y:448,width:256,height:192,name:'ARENA',color:'#b18355',roof:'#493d36',kind:'major' },
  { x:1464,y:128,width:208,height:160,name:'AGENCY',color:'#806b80',roof:'#443b4a',kind:'major' },
  { x:-340,y:1010,width:236,height:156,name:'DETENTION COMPOUND',color:'#6f7070',roof:'#343d45',kind:'major' },
  // Compact background buildings break up the expanded districts without
  // competing with the four major landmarks.
  {x:-690,y:170,width:142,height:112,name:'WEST COTTAGE',color:'#8f7559',roof:'#4d5c46',accent:'#d1bd86',kind:'house'},
  {x:-410,y:610,width:164,height:120,name:'TRAIL HOUSE',color:'#7f7861',roof:'#604842',accent:'#b7c796',kind:'house'},
  {x:-170,y:-270,width:148,height:110,name:'NORTH LODGE',color:'#8a6f58',roof:'#465a62',accent:'#d5bd88',kind:'house'},
  {x:920,y:-330,width:170,height:120,name:'LOOKOUT',color:'#7b7968',roof:'#6f4c43',accent:'#b9d0a0',kind:'house'},
  {x:2210,y:160,width:158,height:116,name:'GARDEN HOME',color:'#8c795b',roof:'#495f4b',accent:'#d4c787',kind:'house'},
  {x:2290,y:1160,width:176,height:124,name:'EAST WORKSHOP',color:'#727b72',roof:'#514c61',accent:'#d6b578',kind:'house'},
  {x:110,y:1210,width:166,height:126,name:'MARKET HOME',color:'#907359',roof:'#5e493e',accent:'#d8bd83',kind:'house'},
  {x:1370,y:1450,width:164,height:126,name:'STORE HOUSE',color:'#777a66',roof:'#405b58',accent:'#c8bd85',kind:'house'},
  {x:790,y:-440,width:150,height:108,name:'NORTH COTTAGE',color:'#8b735b',roof:'#4d5968',accent:'#d7c48c',kind:'house'},
  {x:1120,y:880,width:150,height:112,name:'FOREST CABIN',color:'#786c54',roof:'#425643',accent:'#c6b97e',kind:'house'},
  {x:800,y:1570,width:170,height:90,name:'SOUTH COTTAGE',color:'#89745e',roof:'#6b4943',accent:'#d8c08a',kind:'house'},
  // The bazaar is decorative world building. Its exchange stall deliberately
  // uses fictional signage and never presents live balances or execution.
  {x:390,y:1200,width:136,height:88,name:'FOOD',color:'#8f6248',roof:'#a65f4e',accent:'#f0c36f',kind:'stall'},
  {x:610,y:1168,width:142,height:92,name:'EXCHANGE',color:'#343a37',roof:'#252a29',accent:'#e1b94d',kind:'stall'},
  {x:1030,y:1185,width:150,height:92,name:'DATA',color:'#526b70',roof:'#40515e',accent:'#a7d5c2',kind:'stall'},
  {x:1210,y:1308,width:142,height:90,name:'TOOLS',color:'#6f6659',roof:'#4e5352',accent:'#c7a86f',kind:'stall'},
  {x:470,y:1490,width:150,height:90,name:'GOODS',color:'#77634f',roof:'#59624b',accent:'#d7c38b',kind:'stall'},
];
export interface GroundArea extends Rect {color:string}
// Blocky overlapping terrain areas replace the old long polygon diagonals.
export const TERRAIN_AREAS: GroundArea[] = [
  {x:-830,y:-490,width:410,height:650,color:'#34513f'},{x:-620,y:-390,width:360,height:400,color:'#34513f'},{x:-830,y:840,width:470,height:780,color:'#355240'},
  {x:-610,y:760,width:320,height:520,color:'#355240'},{x:-100,y:-500,width:510,height:340,color:'#35513e'},{x:180,y:-390,width:380,height:270,color:'#35513e'},
  {x:1900,y:-490,width:660,height:1580,color:'#2d4c39'},{x:1810,y:240,width:420,height:620,color:'#2d4c39'},
  // The garden approaches in short steps so the biome edge reads as pixel
  // terrain instead of one tall vector-like seam.
  {x:1460,y:470,width:690,height:170,color:'#3d6047'},{x:1510,y:640,width:640,height:180,color:'#3d6047'},
  {x:1570,y:820,width:580,height:220,color:'#3d6047'},{x:1660,y:1040,width:490,height:150,color:'#3d6047'},
  {x:1780,y:530,width:440,height:520,color:'#3d6047'},
];
export interface WorldPath extends Rect {color?:string}
export const PATHS: WorldPath[] = [
  {x:392,y:300,width:760,height:560},{x:72,y:420,width:1024,height:84},{x:860,y:300,width:112,height:400},
  {x:140,y:494,width:148,height:152},{x:480,y:688,width:160,height:140},{x:-730,y:420,width:802,height:84},
  {x:392,y:-420,width:364,height:720},{x:392,y:860,width:364,height:620},
  // Match the established 84 px town road at the plaza edge, then turn into
  // the east district instead of ending as the previous narrow 56 px strip.
  {x:1056,y:420,width:704,height:84},{x:1696,y:420,width:64,height:280},
  // West streets form a loose loop around the table and cottage cluster.
  {x:-650,y:260,width:72,height:160},{x:-650,y:260,width:520,height:64},{x:-190,y:260,width:64,height:244},
  {x:-500,y:650,width:254,height:62},{x:-500,y:500,width:62,height:212},{x:-246,y:650,width:318,height:62},
  {x:740,y:-360,width:82,height:64},{x:1040,y:556,width:64,height:406},{x:1040,y:914,width:100,height:64},
  // South road widens into a market loop and small cross streets.
  {x:392,y:1040,width:364,height:500},{x:300,y:1100,width:1150,height:72},{x:300,y:1172,width:72,height:390},
  {x:300,y:1490,width:1150,height:72},{x:1378,y:1100,width:72,height:462},{x:760,y:1172,width:92,height:318},
  {x:372,y:1360,width:1006,height:72},{x:980,y:1172,width:68,height:188},
  {x:836,y:1490,width:96,height:128},
  // A consistent-width orthogonal trail crosses the botanical district. It
  // participates in the same union outline as every other path, so internal
  // rectangle seams never appear as stripes through the trail.
  {x:1520,y:520,width:180,height:64,color:'#786b55'},{x:1636,y:520,width:64,height:180,color:'#786b55'},
  {x:1636,y:636,width:260,height:64,color:'#786b55'},{x:1832,y:636,width:64,height:230,color:'#786b55'},
  {x:1832,y:802,width:210,height:64,color:'#786b55'},{x:1978,y:802,width:64,height:178,color:'#786b55'},
];
export interface GroundDetail extends Position {kind:'stone'|'crack'|'gravel';tone:0|1|2}
const detailAreas=[{x:400,y:310,width:740,height:530},{x:-710,y:425,width:760,height:72},{x:310,y:1110,width:1120,height:440}];
export const GROUND_DETAILS: GroundDetail[] = Array.from({length:170},(_,index)=>{
  const area=detailAreas[index%detailAreas.length]!;
  const seed=(Math.imul(index+19,1103515245)+12345)>>>0;
  return {x:area.x+8+seed%Math.max(1,area.width-16),y:area.y+8+((seed>>>9)+(index*37))%Math.max(1,area.height-16),
    kind:(['stone','crack','gravel'] as const)[index%3]!,tone:(index%3) as 0|1|2};
});
export interface MarketProp extends Position {kind:'well'|'sign'|'crates'|'barrels'}
export const MARKET_PROPS: MarketProp[] = [
  {x:900,y:1392,kind:'well'},{x:710,y:1090,kind:'sign'},{x:548,y:1268,kind:'crates'},
  {x:1190,y:1465,kind:'barrels'},{x:1080,y:1290,kind:'crates'},{x:665,y:1460,kind:'barrels'},
];
function overlaps(rect:Rect,point:Position,radius:number):boolean {
  return point.x+radius>rect.x&&point.x-radius<rect.x+rect.width&&point.y+radius>rect.y&&point.y-radius<rect.y+rect.height;
}
function decorationAllowed(point:Position,radius:number):boolean {
  if(point.x-radius<MAP.minX+48||point.y-radius<MAP.minY+72||point.x+radius>MAP.minX+MAP.width-48||point.y+radius>MAP.minY+MAP.height-48)return false;
  return !PATHS.some(path=>overlaps(path,point,radius))&&!BUILDINGS.some(building=>overlaps(building,point,radius));
}
/** Natural-ground placement rules keep future decoration off roads and plazas. */
export function canPlaceTree(point:Position):boolean { return decorationAllowed(point,28); }
export function canPlaceBush(point:Position):boolean { return decorationAllowed(point,12); }
export function canPlaceFlower(point:Position):boolean { return decorationAllowed(point,6); }
export function canPlaceRock(point:Position):boolean { return decorationAllowed(point,10); }

export interface WorldTree extends Position { scale?: number; tint?: 0|1|2 }
export interface WorldBush extends Position { size: number; solid?: boolean; tint?: 0|1|2 }
export interface VegetationGroup { district:'north'|'south'|'west'|'east'; trees:WorldTree[]; bushes:WorldBush[]; flowers:Rect[]; rocks:Position[] }
export const VEGETATION_GROUPS: VegetationGroup[] = [
  {district:'north',trees:[{x:-520,y:-360,scale:.9,tint:1}],bushes:[{x:-475,y:-325,size:22,tint:2},{x:-555,y:-305,size:18}],flowers:[{x:-480,y:-285,width:54,height:24}],rocks:[]},
  {district:'north',trees:[{x:120,y:-350,scale:1.05,tint:2}],bushes:[{x:170,y:-315,size:24,tint:1}],flowers:[],rocks:[{x:78,y:-305}]},
  {district:'north',trees:[{x:1320,y:-330,scale:.9}],bushes:[{x:1280,y:-290,size:20,tint:2},{x:1370,y:-280,size:18,tint:1}],flowers:[{x:1288,y:-250,width:58,height:24}],rocks:[]},
  {district:'south',trees:[{x:-710,y:1290,scale:1.05,tint:2}],bushes:[{x:-655,y:1325,size:22,tint:1}],flowers:[{x:-650,y:1360,width:56,height:24}],rocks:[]},
  {district:'south',trees:[{x:-350,y:1480,scale:.9,tint:1}],bushes:[{x:-300,y:1510,size:20,tint:2}],flowers:[],rocks:[{x:-395,y:1530}]},
  {district:'south',trees:[{x:1660,y:1450,scale:1.1}],bushes:[{x:1715,y:1490,size:24,tint:1},{x:1620,y:1510,size:18,tint:2}],flowers:[{x:1690,y:1530,width:62,height:25}],rocks:[]},
  {district:'west',trees:[{x:-790,y:40,scale:.9}],bushes:[{x:-745,y:78,size:20,tint:1}],flowers:[],rocks:[{x:-730,y:120}]},
  {district:'west',trees:[{x:-770,y:650,scale:1.1,tint:1}],bushes:[{x:-720,y:690,size:22,tint:2},{x:-810,y:710,size:18}],flowers:[{x:-710,y:730,width:58,height:25}],rocks:[]},
  {district:'west',trees:[{x:-220,y:980,scale:.95,tint:2}],bushes:[{x:-170,y:1020,size:24,tint:1}],flowers:[],rocks:[{x:-260,y:1040}]},
  {district:'east',trees:[{x:2180,y:-250,scale:1.05,tint:1}],bushes:[{x:2235,y:-210,size:20,tint:2}],flowers:[{x:2220,y:-175,width:58,height:24}],rocks:[]},
  {district:'east',trees:[{x:2490,y:400,scale:.9,tint:2}],bushes:[{x:2440,y:445,size:22,tint:1}],flowers:[],rocks:[{x:2520,y:470}]},
  {district:'east',trees:[{x:2470,y:1210,scale:1.1}],bushes:[{x:2415,y:1250,size:24,tint:2},{x:2520,y:1270,size:18,tint:1}],flowers:[{x:2390,y:1290,width:64,height:26}],rocks:[]},
];
const TREE_CANDIDATES: WorldTree[] = [
  {x:60,y:120},{x:65,y:280},{x:60,y:710},{x:340,y:770},{x:1060,y:180},{x:1056,y:350},{x:1030,y:770},
  {x:1160,y:190},{x:1270,y:170},{x:1375,y:230},{x:1190,y:360},{x:1330,y:410},{x:1410,y:560},{x:1160,y:650},{x:1290,y:720},{x:1380,y:760},
  {x:-720,y:-360,scale:1.2,tint:1},{x:-650,y:80,scale:.85,tint:2},{x:-760,y:390,scale:1.15},{x:-540,y:840,scale:.9,tint:1},
  {x:-250,y:1310,scale:1.1,tint:2},{x:240,y:1460,scale:.85},{x:1080,y:1490,scale:1.2,tint:1},
  {x:130,y:-420,scale:.9,tint:2},{x:570,y:-310,scale:1.15},{x:1100,y:-400,scale:.85,tint:1},
  {x:1920,y:-280,scale:1.1,tint:2},{x:2380,y:100,scale:.9},{x:2470,y:690,scale:1.2,tint:1},{x:2330,y:1250,scale:.85,tint:2},
  {x:1520,y:960,scale:1.1,tint:1},{x:1680,y:1060,scale:.85,tint:2},{x:1830,y:990,scale:1.2},
  {x:2020,y:940,scale:.9,tint:1},{x:2140,y:660,scale:1.1,tint:2},{x:2040,y:400,scale:.85},
  ...VEGETATION_GROUPS.flatMap(group=>group.trees),
];
export const TREES: WorldTree[] = TREE_CANDIDATES.filter(tree=>canPlaceTree({x:tree.x+6*(tree.scale||1),y:tree.y+38*(tree.scale||1)}));
const BUSH_CANDIDATES: WorldBush[] = [
  {x:1460,y:680,size:28,solid:true},{x:1520,y:790,size:20,tint:1},{x:1580,y:900,size:26,solid:true,tint:2},
  {x:1690,y:550,size:22,tint:1},{x:1810,y:510,size:30,solid:true},{x:1940,y:590,size:20,tint:2},
  {x:2080,y:780,size:28,solid:true,tint:1},{x:1950,y:1040,size:24,tint:2},
  {x:-580,y:700,size:24,tint:1},{x:-420,y:-180,size:30,solid:true},{x:360,y:-300,size:22,tint:2},
  {x:950,y:1420,size:28,solid:true},{x:2250,y:360,size:24,tint:1},{x:2280,y:1060,size:30,solid:true},
  {x:-745,y:210,size:22,tint:2},{x:-525,y:180,size:30,solid:true,tint:1},{x:-350,y:790,size:20,tint:2},
  {x:-120,y:590,size:26,tint:1},{x:330,y:260,size:20,tint:2},{x:650,y:82,size:28,solid:true,tint:1},
  {x:1090,y:360,size:22,tint:2},{x:1435,y:330,size:24,tint:1},{x:1700,y:250,size:20,tint:2},
  {x:2180,y:120,size:28,solid:true,tint:1},{x:2410,y:870,size:22,tint:2},{x:2180,y:1310,size:24,tint:1},
  {x:70,y:1150,size:26,tint:2},{x:290,y:1250,size:20,tint:1},{x:370,y:1580,size:28,solid:true},
  {x:780,y:1595,size:22,tint:2},{x:1190,y:1580,size:30,solid:true,tint:1},{x:1570,y:1320,size:24,tint:2},
  {x:1480,y:1110,size:20,tint:1},{x:1870,y:1180,size:28,solid:true,tint:2},
  {x:-700,y:545,size:20,tint:1},{x:-330,y:345,size:22,tint:2},{x:-95,y:745,size:18,tint:1},
  ...VEGETATION_GROUPS.flatMap(group=>group.bushes),
];
export const BUSHES: WorldBush[] = BUSH_CANDIDATES.filter(canPlaceBush);
const FLOWER_CANDIDATES: Rect[] = [
  {x:1510,y:600,width:90,height:42},{x:1620,y:830,width:98,height:46},{x:1770,y:570,width:96,height:40},
  {x:1900,y:845,width:102,height:44},{x:2050,y:970,width:94,height:40},
  {x:-742,y:315,width:74,height:32},{x:-410,y:750,width:76,height:30},{x:1480,y:305,width:88,height:32},
  {x:2220,y:290,width:86,height:32},{x:180,y:1360,width:76,height:30},{x:1260,y:1440,width:82,height:30},
  {x:-715,y:550,width:62,height:26},{x:-355,y:350,width:58,height:24},
  ...VEGETATION_GROUPS.flatMap(group=>group.flowers),
];
export const FLOWER_BEDS: Rect[] = FLOWER_CANDIDATES.filter(bed=>canPlaceFlower({x:bed.x+bed.width/2,y:bed.y+bed.height/2}));
const ROCK_CANDIDATES: Position[] = [{x:1210,y:260},{x:1360,y:320},{x:1250,y:520},{x:1390,y:650},{x:2240,y:540},{x:-620,y:1180},{x:-760,y:720},{x:1760,y:1200},{x:2380,y:1420},...VEGETATION_GROUPS.flatMap(group=>group.rocks)];
export const ROCKS: Position[] = ROCK_CANDIDATES.filter(canPlaceRock);
export const CAMPFIRES: Position[] = [{x:1760,y:740},{x:2180,y:1060},{x:-470,y:970},{x:1040,y:1320}];
// Ordered, collision-free targets provide a cheap loop through every district.
// The NPC controller still uses the existing movement/collision code.
export const NPC_WAYPOINTS: Position[] = [
  {x:430,y:310},{x:640,y:320},{x:740,y:350},{x:660,y:430},{x:430,y:510},
  {x:340,y:430},{x:0,y:430},{x:-300,y:430},{x:-650,y:430},{x:-650,y:760},
  {x:-400,y:900},{x:-200,y:1300},{x:200,y:1370},{x:700,y:1450},
  {x:700,y:1320},{x:1000,y:1320},{x:1000,y:1100},{x:1660,y:1100},{x:1660,y:1052},{x:1780,y:1052},
  {x:1780,y:820},{x:2050,y:820},{x:2300,y:820},{x:2448,y:820},{x:2448,y:608},
  {x:2450,y:600},{x:2420,y:100},{x:2100,y:100},{x:1900,y:200},{x:1900,y:400},
  {x:1700,y:400},{x:1500,y:420},{x:1280,y:500},{x:1100,y:500},
  {x:900,y:760},{x:700,y:760},{x:430,y:730},{x:430,y:510},
  {x:480,y:0},{x:480,y:-250},{x:700,y:-350},{x:1140,y:-300},
  {x:1400,y:-180},{x:1200,y:0},{x:800,y:0},{x:480,y:0},
  {x:-580,y:350},{x:-350,y:350},{x:-210,y:780},{x:-100,y:680},{x:220,y:1120},
  {x:420,y:1390},{x:700,y:1390},{x:820,y:1280},{x:980,y:1390},{x:1160,y:1410},{x:1500,y:1230},
  {x:1560,y:340},{x:1730,y:420},{x:1870,y:650},
];
export const ARENA_LOUNGE_WAYPOINT = NPC_WAYPOINTS.findIndex(point=>point.x===900&&point.y===760);
/** Developer-only browser probes start just inside the former map edges. */
export const EXPLORATION_PROBES = {
  west:{x:90,y:430},east:{x:1720,y:430},north:{x:600,y:100},south:{x:700,y:1060},
  garden:{x:1830,y:750},campfire:{x:1760,y:680},market:{x:820,y:1320},agency:{x:1568,y:340},eastRoad:{x:1300,y:460},
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
  ...MARKET_PROPS.filter(prop=>prop.kind==='well').map(({x,y})=>({x:x-22,y:y-14,width:44,height:28})),
];
export const LANDMARKS: Interactable[] = [
  { id: 'arena-door', type: 'arena', position: { x: 928, y: 674 }, radius: 72, label: 'Enter Arena' },
  { id: 'plaza-table', type: 'table', position: { x: 224, y: 609 }, radius: 68, label: 'Sit · free Tic-Tac-Toe' },
  { id: 'archive', type: 'research', position: { x: 560, y: 790 }, radius: 64, label: 'Open arena statistics' },
  { id: 'forest-clearing', type: 'zone', position: { x: 1280, y: 500 }, radius: 86, label: 'Explore forest clearing' },
  { id: 'botanical-garden', type: 'zone', position: { x: 1570, y: 620 }, radius: 86, label: 'Explore botanical garden' },
  { id: 'agent-agency', type: 'zone', position: { x: 1568, y: 318 }, radius: 76, label: 'Visit agent agency' },
  { id: 'south-market', type: 'zone', position: { x: 900, y: 1392 }, radius: 90, label: 'Visit south market' },
  { id: 'compound-entrance', type: 'zone', position: { x: -220, y: 1170 }, radius: 88, label: 'Enter detention compound' },
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
