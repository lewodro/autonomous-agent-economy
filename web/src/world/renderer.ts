import { MAP, BUILDINGS, BUSHES, CAMPFIRES, EXPLORATION_SITES, FLOWER_BEDS, FOUNTAIN, GROUND_DETAILS, MARKET_PROPS, OUTER_LOOP, PATHS, PLAZA_BENCHES, PLAZA_FLOOR, PLAZA_LAMPS, PLAZA_PLANTERS, ROCKS, TERRAIN_AREAS, TREES } from './map.js';
import { SPRITES, type SpriteDefinition } from './sprites.js';
import { appearanceSprites } from './appearance.js';
import type { Position, WorldActor, Interactable, WorldParticle, WorldResource } from './model.js';
import type { FarmTile } from './farm.js';
/** Available body, depleted body, and glinting accent for each ore variant. */
const ORE_COLORS:Record<string,[string,string,string]> = {
  copper:['#a86434','#5f432c','#e0a15a'],
  iron:['#8d9288','#4f5952','#c8b66d'],
  silver:['#c3ccd4','#737d85','#f0f4f7'],
  gold:['#c8b66d','#8a7a3f','#f6df94'],
  obsidian:['#4a3f5c','#2b2436','#9c86c9'],
  crystal:['#7fc7d9','#3f7d8c','#d3f4fb'],
};
const DEFAULT_ORE_COLORS:[string,string,string]=['#8d9288','#4f5952','#c8b66d'];
/** Rune identities keep neighbouring shrines visually distinct. */
const RUNE_ACCENTS:Record<string,[string,string]>={
  moss:['#7fae6a','#cfe2a8'],
  amber:['#d98f45','#f6d99a'],
  violet:['#a885d6','#dcc4f2'],
  frost:['#8fc8dd','#dff4ff'],
};
const DEFAULT_RUNES:[string,string]=['#d29dbb','#dce4a0'];
/** Shift a hex colour by a fixed amount per channel, clamped to 0..255. */
function shiftColor(hex:string,amount:number):string {
  const value=parseInt(hex.slice(1),16);
  const r=Math.max(0,Math.min(255,((value>>16)&255)+amount));
  const g=Math.max(0,Math.min(255,((value>>8)&255)+amount));
  const b=Math.max(0,Math.min(255,(value&255)+amount));
  return `#${((r<<16)|(g<<8)|b).toString(16).padStart(6,'0')}`;
}
/** Deterministic 0..1 hash used by the one-time grass painter. */
function hashUnit(x:number,y:number,seed=0):number {
  let value=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(seed,1597334677))>>>0;
  value=(value^(value>>>13))>>>0;value=Math.imul(value,1274126177)>>>0;
  return ((value^(value>>>16))>>>0)/4294967295;
}
/** Smooth value noise. Neighbouring tiles share a tone, so variation reads as patches. */
function grassNoise(x:number,y:number,scale:number,seed:number):number {
  const nx=x/scale,ny=y/scale,gx=Math.floor(nx),gy=Math.floor(ny);
  const fx=nx-gx,fy=ny-gy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=hashUnit(gx,gy,seed),b=hashUnit(gx+1,gy,seed),c=hashUnit(gx,gy+1,seed),d=hashUnit(gx+1,gy+1,seed);
  return (a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy;
}
function clamp01(value:number):number { return Math.max(0,Math.min(1,value)); }
/** Crisp, pixel-stepped ellipse fill. Canvas path ellipses anti-alias; this keeps
 * the plaza medallion and fountain water in the same hard-edged pixel language
 * as the rest of the world. */
function fillPixelEllipse(c:CanvasRenderingContext2D,cx:number,cy:number,rx:number,ry:number,color:string,step=2):void {
  c.fillStyle=color;
  for(let y=-ry;y<ry;y+=step){
    const t=Math.max(0,1-(y/ry)*(y/ry));
    const half=Math.round(rx*Math.sqrt(t));
    if(half>0)c.fillRect(Math.round(cx-half),Math.round(cy+y),half*2,Math.min(step,ry-y));
  }
}
/** A hard-edged diamond used for inlaid floor tiles and corner ornaments. */
function fillDiamond(c:CanvasRenderingContext2D,cx:number,cy:number,radius:number,color:string):void {
  c.fillStyle=color;
  for(let y=-radius;y<=radius;y++){
    const half=radius-Math.abs(y);
    if(half>=0)c.fillRect(Math.round(cx-half),Math.round(cy+y),half*2+1,1);
  }
}
/** Broad, softly blended tint field: a large region plus a smaller detail wave. */
function tintField(x:number,y:number):number {
  return grassNoise(x,y,460,11)*0.62 + grassNoise(x,y,190,29)*0.38;
}
/**
 * How strongly the broad field is mixed in. Zero through the authored core so
 * the plaza keeps its original tile grain, then a noise-driven envelope that
 * breathes in and out instead of climbing steadily with distance.
 */
function tintEnvelope(x:number,y:number):number {
  const distance=Math.hypot(x-MAP.spawn.x,y-MAP.spawn.y);
  const gate=clamp01((distance-760)/900);
  const pulse=grassNoise(x,y,1250,71)*0.62 + grassNoise(x,y,560,83)*0.38;
  // The authored grain fades out toward the wilderness; the remaining breathing
  // comes from the tint field's own value, not from tile-level alternation.
  return clamp01(gate*(0.78+pulse*0.34));
}
/**
 * Continuous 0..4 grass tone: the authored per-tile grain through the plaza,
 * blending into the smooth tint field outside it. All inputs are world
 * coordinates, never chunk-local, so chunk seams cannot appear.
 */
export function grassTone(x:number,y:number,tileSeed:number):number {
  const soft=tintField(x,y)*4;
  const mix=tintEnvelope(x,y);
  // The old rule snapped each tile to one of five authored tones near the
  // plaza and only blended the smooth field in past ~760 units, which produced
  // the high-contrast checkerboard band north of the Agent House. The authored
  // grain is now a low-amplitude jitter and the field amplitude simply breathes
  // with the envelope, so the same grass reads calm near the plaza and livelier
  // farther out without any palette cutoff.
  const amplitude=0.55+0.45*mix;
  const grain=((tileSeed%5)-2)*0.16+(hashUnit(x>>5,y>>5,17)-0.5)*0.45;
  return Math.max(0,Math.min(4,2+(soft-2)*amplitude+grain));
}
export interface WorldFrame { actors:WorldActor[];camera:Position;nearby?:Interactable;time:number;resources?:WorldResource[];particles?:WorldParticle[];farmTiles?:FarmTile[];guide?:{target:Position;label:string}|null;moveTarget?:Position|null }
export interface WorldRenderer {
  viewport():{width:number;height:number};
  render(frame:WorldFrame):void;
  destroy():void;
}
export function isActorNearVisitor(actor:WorldActor,visitor:WorldActor|undefined,distance=150):boolean {
  return actor.type==='human'||!!visitor&&Math.hypot(actor.position.x-visitor.position.x,actor.position.y-visitor.position.y)<distance;
}
/** Shared world sprite frame selection for the plaza and the read-only Arena. */
export function drawActorSprite(c:CanvasRenderingContext2D,sprite:SpriteDefinition|undefined,image:HTMLImageElement|undefined,actor:Pick<WorldActor,'position'|'facing'|'movementState'>,time:number,reduced:boolean,size=48,composed?:HTMLCanvasElement):number {
  const {x,y}=actor.position;
  const animation=sprite?.animations[`${actor.movementState==='walking'?'walk':'idle'}_${actor.facing}`]||[0];
  const frame=animation[Math.floor(time/150)%animation.length]||0;
  const bob=actor.movementState==='walking'&&!reduced?Math.floor(time/140)%2*2:0;
  if(composed){
    const column=((frame%3)+3)%3,row=Math.max(0,Math.floor(frame/3))%4;
    c.drawImage(composed,column*32,row*32,32,32,Math.round(x-size/2),Math.round(y-size*5/6-bob),size,size);
  }else if(image?.complete&&image.naturalWidth&&sprite){
    const columns=Math.max(1,Math.floor(image.naturalWidth/sprite.frameWidth));
    c.drawImage(image,frame%columns*sprite.frameWidth,Math.floor(frame/columns)*sprite.frameHeight,sprite.frameWidth,sprite.frameHeight,Math.round(x-size/2),Math.round(y-size*5/6-bob),size,size);
  }else{c.fillStyle='#d5b882';c.fillRect(x-size*5/24,y-size*7/12,size*5/12,size*7/12);}
  return bob;
}
/** One pre-rendered surface of the static map. Four chunks keep every backing
 * canvas below the per-canvas pixel ceiling used by mobile Safari. */
interface MapChunk { canvas:HTMLCanvasElement; x:number; y:number; width:number; height:number }
/** Rendering accepts presence snapshots only; it cannot advance or settle a game. */
export class CanvasWorldRenderer implements WorldRenderer {
  private ctx:CanvasRenderingContext2D;
  private chunks:MapChunk[]=[];
  private images=new Map<string,HTMLImageElement>();
  private scale=1;
  constructor(private canvas:HTMLCanvasElement) {
    const context=canvas.getContext('2d');if(!context)throw new Error('Your browser does not support the world renderer.');this.ctx=context;
    // Two columns and two rows: each surface is about 8.8M pixels, comfortably
    // under the 16.7M ceiling. Boundaries fall in open ground so labels and
    // landmark art never straddle a seam.
    const columns=[MAP.minX,950,MAP.maxX],rows=[MAP.minY,200,MAP.maxY];
    for(let row=0;row<rows.length-1;row++)for(let column=0;column<columns.length-1;column++){
      const x=columns[column]!,y=rows[row]!,width=columns[column+1]!-x,height=rows[row+1]!-y;
      const surface=document.createElement('canvas');surface.width=width;surface.height=height;
      this.chunks.push({canvas:surface,x,y,width,height});
    }
    this.paintMap();
    for(const sprite of SPRITES){const image=new Image();image.src=sprite.sheet;this.images.set(sprite.id,image);}
  }
  viewport():{width:number;height:number} {
    const width=Math.max(1,this.canvas.clientWidth),height=Math.max(1,this.canvas.clientHeight);
    this.scale=Math.min(1.5,width/400);
    return {width:Math.min(MAP.width,width/this.scale),height:Math.min(MAP.height,height/this.scale)};
  }
  private paintMap():void {
    for(const chunk of this.chunks){
      const c=chunk.canvas.getContext('2d');if(!c)continue;
      c.imageSmoothingEnabled=false;
      c.translate(-chunk.x,-chunk.y);
      this.paintSurface(c);
    }
  }
  private paintSurface(c:CanvasRenderingContext2D):void {
    const rect=(x:number,y:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    // Terrain areas keep the shared 32px dither pattern, retinted from their
    // own base colour so biomes never collapse into one flat solid fill.
    const hash=(x:number,y:number):number=>{
      let value=(Math.imul(x,374761393)+Math.imul(y,668265263))>>>0;
      value=(value^(value>>>13))>>>0;value=Math.imul(value,1274126177)>>>0;
      return (value^(value>>>16))>>>0;
    };
    /**
     * Paint one biome patch. Every patch feathers into its surroundings with a
     * noise-warped falloff, so no region reads as a giant hard rectangle.
     */
    // Dithered two-tone fill: where the field sits between two tones the tile
    // is split into pixel quadrants instead of snapping to one shade, so tone
    // contours read as soft speckled edges rather than hard rectangular bands.
    const paintGrass=(px:number,py:number,pw:number,ph:number,value:number,tones:string[])=>{
      const low=Math.floor(value),frac=value-low;
      if(frac<0.02||low>=tones.length-1){c.fillStyle=tones[low]!;c.fillRect(px,py,pw,ph);return;}
      const halfW=Math.ceil(pw/2),halfH=Math.ceil(ph/2);
      for(let qy=0;qy<2;qy++)for(let qx=0;qx<2;qx++){
        const qx0=px+qx*halfW,qy0=py+qy*halfH;
        const qw=Math.min(halfW,px+pw-qx0),qh=Math.min(halfH,py+ph-qy0);
        if(qw<=0||qh<=0)continue;
        // A little fine noise keeps the quadrants from forming a visible grid.
        const jitter=(grassNoise(qx0,qy0,72,131)-0.5)*0.34;
        const pick=Math.abs(frac+jitter)>0.5?low+1:low;
        c.fillStyle=tones[Math.min(tones.length-1,pick)]!;
        c.fillRect(qx0,qy0,qw,qh);
      }
    };
    const ground=(x:number,y:number,w:number,h:number,base:string,feather=0)=>{
      // The original authored five-tone grain is restored. The tint field only
      // decides which tone a tile takes, so the plaza keeps its familiar look.
      const tones=[shiftColor(base,-10),shiftColor(base,-5),base,shiftColor(base,5),shiftColor(base,12)];
      const blade=shiftColor(base,-16),speck=shiftColor(base,20);
      const right=x+w,bottom=y+h,startX=Math.floor(x/32)*32,startY=Math.floor(y/32)*32;
      for(let gy=startY;gy<bottom;gy+=32)for(let gx=startX;gx<right;gx+=32){
        const px=Math.max(x,gx),py=Math.max(y,gy);
        const pw=Math.min(right,gx+32)-px,ph=Math.min(bottom,gy+32)-py;
        if(pw<=0||ph<=0)continue;
        const sample=hash(gx,gy);
        if(feather>0){
          // The falloff edge is warped by world-space noise, so a patch
          // boundary is an irregular soft edge instead of a straight cutoff.
          const edge=Math.min(gx-x,x+w-(gx+32),gy-y,y+h-(gy+32));
          const warp=(grassNoise(gx,gy,96,97)-0.5)*feather*1.1;
          const t=clamp01((edge+warp)/feather);
          const alpha=t*t*(3-2*t);
          if(alpha<=0){c.globalAlpha=1;continue;}
          c.globalAlpha=alpha;
        }
        paintGrass(px,py,pw,ph,grassTone(gx,gy,sample),tones);
        if(pw>20&&ph>20){
          if(sample%7===0){c.fillStyle=blade;c.fillRect(px+5,py+9,2,5);c.fillRect(px+9,py+13,1,4);c.fillRect(px+13,py+8,2,3);}
          if(sample%13===0){c.fillStyle=speck;c.fillRect(px+22,py+18,2,2);c.fillRect(px+25,py+21,1,1);}
          if(sample%41===0){c.fillStyle='#c9b76e';c.fillRect(px+17,py+6,2,2);c.fillRect(px+20,py+8,1,1);}
        }
        if(feather>0)c.globalAlpha=1;
      }
    };
    rect(MAP.minX,MAP.minY,MAP.width,MAP.height,'#253c36');
    // Unclaimed ground keeps the original five greens and little grass marks.
    // The same world-space tint field blends them into broader soft regions.
    const grassTones=['#2b4537','#2e493a','#30483c','#334d3e','#294334'];
    for(let y=MAP.minY+64;y<MAP.minY+MAP.height-40;y+=32)for(let x=MAP.minX+40;x<MAP.minX+MAP.width-40;x+=32){
      const sample=hash(x,y);
      paintGrass(x,y,32,32,grassTone(x,y,sample),grassTones);
      if(sample%6===0){rect(x+7,y+10,2,5,'#3f5c45');rect(x+11,y+14,1,4,'#3f5c45');}
      if(sample%10===0)rect(x+22,y+19,2,2,'#48654c');
      if(sample%47===0){rect(x+17,y+7,2,2,'#c9b76e');rect(x+20,y+9,1,1,'#b9a45f');}
    }
    // Large vegetation regions use stepped, overlapping pixel blocks. This
    // avoids the vector-like diagonal wedges created by arbitrary polygons.
    for(const area of TERRAIN_AREAS){
      // Every patch feathers, including the authored core: hard rectangular
      // cutoffs were the last visible artifact of the biome rectangles. A wide,
      // noise-warped falloff turns each one into an irregular soft patch.
      ground(area.x,area.y,area.width,area.height,area.color,320);
    }
    ground(1088,128,360,780,'#294b3a',320);ground(1160,220,350,780,'#294b3a',320);ground(1260,340,290,620,'#294b3a',320);
    for(const path of PATHS)rect(path.x,path.y,path.width,path.height,path.color||'#6b6150');
    // Widen the four city-to-loop junctions with a lighter gravel cap so the
    // connection reads as an intentional crossing rather than two path seams.
    for(const junction of [{x:576,y:OUTER_LOOP.top},{x:OUTER_LOOP.left,y:460},{x:1250,y:OUTER_LOOP.bottom},{x:OUTER_LOOP.right,y:900}]){
      rect(junction.x-38,junction.y-38,76,76,'#7c6f58');
      rect(junction.x-28,junction.y-28,56,56,'#897b62');
    }
    // Draw depth only on the exposed boundary of the combined road network.
    // Outlining each overlapping rectangle separately created chaotic seams
    // through the middle of the plaza and market.
    const onPath=(x:number,y:number)=>PATHS.some(path=>x>=path.x&&x<path.x+path.width&&y>=path.y&&y<path.y+path.height);
    const edgeStep=4;
    for(const path of PATHS){
      for(let x=path.x;x<path.x+path.width;x+=edgeStep){
        if(!onPath(x+2,path.y-2))rect(x,path.y,Math.min(edgeStep,path.x+path.width-x),3,'#81745c');
        if(!onPath(x+2,path.y+path.height+1))rect(x,path.y+path.height-4,Math.min(edgeStep,path.x+path.width-x),4,'#504a40');
      }
      for(let y=path.y;y<path.y+path.height;y+=edgeStep){
        if(!onPath(path.x-2,y+2))rect(path.x,y,3,Math.min(edgeStep,path.y+path.height-y),'#81745c');
        if(!onPath(path.x+path.width+1,y+2))rect(path.x+path.width-4,y,4,Math.min(edgeStep,path.y+path.height-y),'#504a40');
      }
    }
    // The plaza gets a designed stone floor after the roads so its borders,
    // medallion and thresholds sit on top of the shared path network.
    this.paintPlazaFloor(c);
    // Stable, visual-only texture. Coordinates are generated once from the
    // central map data rather than changing on every frame or browser. The
    // plaza carries its own authored wear, so random path specks skip it.
    const groundTones=['#5f574a','#807361','#91816a'];
    const plazaRight=PLAZA_FLOOR.x+PLAZA_FLOOR.width,plazaBottom=PLAZA_FLOOR.y+PLAZA_FLOOR.height;
    for(const detail of GROUND_DETAILS){
      if(detail.x>=PLAZA_FLOOR.x&&detail.x<plazaRight&&detail.y>=PLAZA_FLOOR.y&&detail.y<plazaBottom)continue;
      const color=groundTones[detail.tone]!;
      if(detail.kind==='stone'){rect(detail.x,detail.y,3,2,color);rect(detail.x+3,detail.y+1,2,2,'#514c42');}
      else if(detail.kind==='crack'){rect(detail.x,detail.y,5,1,color);rect(detail.x+3,detail.y+1,1,3,color);}
      else{rect(detail.x,detail.y,2,2,color);rect(detail.x+5,detail.y+2,2,1,color);rect(detail.x+9,detail.y-1,1,2,color);}
    }
    for(const b of BUILDINGS){
      rect(b.x+8,b.y+9,b.width,b.height,'#172a25');
      if(b.kind==='stall'){
        rect(b.x,b.y+26,b.width,b.height-26,b.color);rect(b.x+7,b.y+34,7,b.height-34,'#4d4034');rect(b.x+b.width-14,b.y+34,7,b.height-34,'#4d4034');
        rect(b.x-5,b.y+18,b.width+10,26,b.roof||'#5d4a42');
        for(let stripe=0;stripe<b.width+10;stripe+=24)rect(b.x-5+stripe,b.y+18,12,26,b.accent||'#d1bb7d');
        rect(b.x+7,b.y+b.height-28,b.width-14,18,'#4c4035');rect(b.x+14,b.y+b.height-34,b.width-28,8,'#8b7457');
        rect(b.x+b.width/2-24,b.y+48,48,18,'#252f2c');
        c.font='bold 9px monospace';c.textAlign='center';c.fillStyle=b.accent||'#f0d394';c.fillText(b.name,b.x+b.width/2,b.y+60);
        if(b.name==='EXCHANGE'){rect(b.x+b.width/2-5,b.y+72,10,10,b.accent||'#e1b94d');rect(b.x+b.width/2-2,b.y+75,4,4,'#343a37');}
        if(b.name==='FOOD'){rect(b.x+24,b.y+69,7,5,'#d18445');rect(b.x+34,b.y+66,6,8,'#8ba45b');rect(b.x+44,b.y+70,8,4,'#c7654f');}
        if(b.name==='TREASURY'){rect(b.x+22,b.y+68,32,15,'#243d43');rect(b.x+26,b.y+72,24,3,b.accent||'#d8b865');}
      }else if(b.kind==='house'){
        rect(b.x,b.y+34,b.width,b.height-34,b.color);rect(b.x-7,b.y+24,b.width+14,18,b.roof||'#4c5148');
        rect(b.x+2,b.y+15,b.width-4,20,b.roof||'#4c5148');rect(b.x+11,b.y+9,b.width-22,9,b.roof||'#4c5148');
        rect(b.x+10,b.y+42,b.width-20,4,'#ffffff18');rect(b.x+b.width/2-14,b.y+b.height-38,28,38,'#303631');
        rect(b.x+22,b.y+58,24,19,'#294341');rect(b.x+b.width-46,b.y+58,24,19,'#294341');
        rect(b.x+25,b.y+61,18,3,b.accent||'#c5c18f');rect(b.x+b.width-43,b.y+61,18,3,b.accent||'#c5c18f');
        rect(b.x+b.width/2+6,b.y+b.height-20,3,3,b.accent||'#d4bc7d');
      }else{
        rect(b.x,b.y,b.width,b.height,b.color);rect(b.x+8,b.y+8,b.width-16,80,b.roof||'#403838');
        for(let line=12;line<80;line+=12)rect(b.x+8,b.y+line,b.width-16,3,'#65524a');
        rect(b.x-8,b.y+80,b.width+16,10,'#281f26');rect(b.x+b.width/2-20,b.y+b.height-42,40,42,'#282d2b');
        rect(b.x+28,b.y+110,32,24,'#243c3a');rect(b.x+b.width-60,b.y+110,32,24,'#243c3a');
        rect(b.x+32,b.y+114,24,3,'#b2c28b');rect(b.x+b.width-56,b.y+114,24,3,'#b2c28b');
        c.font='bold 14px monospace';c.textAlign='center';c.fillStyle='#f4dfaf';c.fillText(b.name,b.x+b.width/2,b.y+105);
        if(b.name==='DETENTION COMPOUND'){
          // Original industrial gate language makes this public activity read
          // as a destination rather than another house in the west district.
          rect(b.x+b.width/2-34,b.y-12,68,20,'#25332f');rect(b.x+b.width/2-28,b.y-8,56,4,'#d0a65f');
          for(let fence=b.x-34;fence<b.x+b.width+34;fence+=14)rect(fence,b.y-24,3,24,'#839084');
          rect(b.x-36,b.y-26,b.width+72,3,'#839084');rect(b.x+b.width/2-22,b.y-18,44,20,'#1d2926');
          c.font='bold 9px monospace';c.fillStyle='#f0d79c';c.fillText('PUBLIC GATE',b.x+b.width/2,b.y-5);
        }
      }
    }
    // Fountain, table and archive use the same footprint as collision rectangles.
    this.paintFountainBase(c);
    for(const lamp of PLAZA_LAMPS)this.paintLamp(c,lamp.x,lamp.y);
    for(const bench of PLAZA_BENCHES)this.paintPlazaBench(c,bench.x,bench.y,bench.facing);
    for(const planter of PLAZA_PLANTERS)this.paintPlanter(c,planter);
    rect(184,530,80,48,'#916d4e');rect(192,538,64,32,'#b29261');
    for(let n=1;n<3;n++){rect(204+n*12,542,2,24,'#493f38');rect(200,538+n*10,44,2,'#493f38');}
    rect(208,590,30,10,'#946f52');rect(208,511,30,10,'#946f52');
    rect(480,720,160,32,'#776951');rect(492,701,136,43,'#243f3e');rect(501,711,118,18,'#83a98b');
    for(const prop of MARKET_PROPS){
      const {x,y}=prop;
      if(prop.kind==='well'){rect(x-24,y+8,48,8,'#172a25');rect(x-22,y-8,44,25,'#777363');rect(x-16,y-4,32,15,'#263f3c');rect(x-24,y-13,6,23,'#554838');rect(x+18,y-13,6,23,'#554838');rect(x-27,y-18,54,7,'#76594a');}
      else if(prop.kind==='sign'){rect(x-3,y-14,6,34,'#5b4938');rect(x-24,y-23,48,18,'#796047');rect(x-18,y-18,36,3,'#d2ba7c');}
      else if(prop.kind==='crates'){rect(x-18,y-12,22,20,'#76583d');rect(x+3,y-6,19,17,'#8b6946');rect(x-15,y-8,16,2,'#b08a5b');}
      else{rect(x-18,y-12,14,22,'#655044');rect(x+2,y-12,14,22,'#705548');rect(x-20,y-9,18,3,'#9a795b');rect(x,y-9,18,3,'#9a795b');}
    }
    c.fillStyle='#e5dfab';c.font='bold 12px monospace';c.textAlign='center';c.fillText('ARENA STATISTICS',560,770);
    c.fillText('FREE TABLE',224,655);c.fillText('PLAZA',558,415);
    c.fillStyle='#b89a5a';c.fillRect(534,419,44,2);
    // Trees share trunk collision; varied crowns keep the garden organic.
    const treePalettes=[['#496345','#56734b'],['#3e6145','#638052'],['#4d6440','#71804c']];
    for(const {x,y,scale=1,tint=0} of TREES){
      const [dark,light]=treePalettes[tint]!;
      c.fillStyle='#172b2866';c.beginPath();c.ellipse(x+7*scale,y+50*scale,25*scale,8*scale,0,0,Math.PI*2);c.fill();
      rect(x,y+24*scale,12*scale,28*scale,'#675542');
      rect(x-18*scale,y,48*scale,34*scale,dark!);
      rect(x-10*scale,y-12*scale,32*scale,26*scale,light!);
      rect(x+3*scale,y-8*scale,10*scale,6*scale,dark!);
    }
    const bushPalettes=[['#355940','#4e744b'],['#3d6045','#608052'],['#456040','#70814e']];
    for(const {x,y,size,tint=0} of BUSHES){
      const [dark,light]=bushPalettes[tint]!;
      c.fillStyle='#172b2855';c.beginPath();c.ellipse(x,y+size/5,size*.55,size*.18,0,0,Math.PI*2);c.fill();
      rect(x-size/2,y-size/3,size,size/2,dark!);
      rect(x-size/3,y-size/2,size*2/3,size/2,light!);
      rect(x-size/2+3,y-size/2-3,size/3,size/3,dark!);
      rect(x+size/6,y-size/2+2,size/3,size/3,light!);
    }
    for(const [bedIndex,bed] of FLOWER_BEDS.entries()){
      rect(bed.x+5,bed.y,bed.width-10,bed.height,'#35513c');
      rect(bed.x,bed.y+7,bed.width*2/3,bed.height-13,'#35513c');
      rect(bed.x+bed.width*2/3,bed.y+3,bed.width/3,bed.height-8,'#35513c');
      for(let n=0;n<Math.floor(bed.width*bed.height/190);n++){
        const x=bed.x+5+(n*37+n*n*11+bedIndex*17)%(bed.width-12);
        const y=bed.y+6+(n*29+n*n*7+bedIndex*13)%(bed.height-12);
        const flower=['#f2c982','#d29dbb','#dce4a0'][(n+bedIndex)%3]!;
        rect(x,y+3,2,5,'#597d48');rect(x-2,y,5,4,flower);
      }
    }
    for(const {x,y} of ROCKS){rect(x-12,y-8,24,16,'#696b60');rect(x-6,y-13,12,7,'#858474');}
    for(const {x,y} of CAMPFIRES){
      // A worn ash circle, stone ring and split-log seats make every seeded
      // clearing read as a deliberate rest point rather than a lone flame.
      c.fillStyle='#2d352b88';c.beginPath();c.ellipse(x,y+8,37,16,0,0,Math.PI*2);c.fill();
      c.fillStyle='#423f32';c.beginPath();c.ellipse(x,y+5,24,10,0,0,Math.PI*2);c.fill();
      for(const [dx,dy] of [[-19,0],[-13,-9],[-2,-12],[10,-9],[17,0],[10,10],[-2,12],[-13,10]] as [number,number][])rect(x+dx-4,y+dy-3,8,6,'#8a8673');
      rect(x-14,y+4,28,6,'#604934');rect(x-11,y-2,22,6,'#795639');
      rect(x-14,y+1,5,4,'#a17b4f');rect(x+8,y-4,5,4,'#a17b4f');
      // Three small split-log benches face the fire so every clearing, including
      // the path-end camp spurs, reads as a place to sit.
      this.paintBench(c,x-48,y-4,'left');
      this.paintBench(c,x+28,y-4,'right');
      this.paintBench(c,x-11,y+24,'down');
      rect(x-22,y-19,3,3,'#6a6f5c');rect(x+19,y-17,2,2,'#6a6f5c');
    }
    // Generated caves and stone landmarks are painted into the same static map;
    // only their small ambient glints animate per frame.
    for(const [index,site] of EXPLORATION_SITES.entries()){
      const {x,y}=site.position;
      if(site.kind==='cave')this.paintCave(c,x,y,index,site.facing);
      else if(site.kind==='pass')this.paintPass(c,x,y,index);
      else this.paintRuin(c,x,y,index,site.kind,site.accent);
    }
    // Junction signposts give the four city-to-loop connectors a readable
    // landmark without adding collision geometry or another UI surface.
    this.paintSignpost(c,576,OUTER_LOOP.top-76,'right');
    this.paintSignpost(c,OUTER_LOOP.left-78,560,'right');
    this.paintSignpost(c,1320,OUTER_LOOP.bottom+78,'left');
    this.paintSignpost(c,OUTER_LOOP.right+70,980,'left');
    c.font='bold 9px monospace';c.textAlign='center';
    for(const site of EXPLORATION_SITES){
      const label=site.label.toUpperCase(),labelWidth=label.length*5.4+8;
      rect(site.position.x-labelWidth/2,site.position.y+32,labelWidth,12,'#172823bb');
      c.fillStyle='#d8cf9f';c.fillText(label,site.position.x,site.position.y+41);
    }
    c.fillStyle='#e5dfab';c.font='bold 12px monospace';c.textAlign='center';c.fillText('FOREST TRAIL',1280,180);c.fillText('CLEARING',1280,540);c.fillText('BOTANICAL GARDEN',1870,490);c.fillText('WORLD BAZAAR',900,1088);
    // Sparse outer-region lettering supports the short region badge without
    // turning the map into a debug overlay.
    c.fillStyle='#96a486';c.font='bold 10px monospace';c.globalAlpha=.72;
    c.fillText('FROSTLINE PASS',576,MAP.minY+154);c.fillText('NORTH OUTCROP',-700,-1100);
    c.fillText('SOUTH PERIMETER',1500,MAP.maxY-104);
    c.fillText('WEST WOODS',MAP.minX+140,1200);c.fillText('EAST INDUSTRIAL',MAP.maxX-170,1100);
    c.globalAlpha=1;
    rect(MAP.minX+32,MAP.minY+56,MAP.width-64,8,'#77705b');rect(MAP.minX+32,MAP.minY+MAP.height-40,MAP.width-64,8,'#77705b');
    rect(MAP.minX+32,MAP.minY+56,8,MAP.height-88,'#77705b');rect(MAP.minX+MAP.width-40,MAP.minY+56,8,MAP.height-88,'#77705b');
  }
  /**
   * The plaza is the first constructed surface every visitor sees, so it gets
   * authored stonework instead of one flat path fill: a running-bond flagstone
   * field, a wide fountain medallion, a raised curb with road thresholds, and
   * three decorative corner tiles. Everything is deterministic in world space.
   */
  private paintPlazaFloor(c:CanvasRenderingContext2D):void {
    const {x,y,width,height}=PLAZA_FLOOR,right=x+width,bottom=y+height;
    // A soft drop shadow outside the slab communicates a low raised platform.
    c.fillStyle='#172a2544';
    c.fillRect(x-4,y-4,width+8,4);c.fillRect(x-4,y-4,4,height+8);
    c.fillRect(right,y-4,4,height+8);c.fillRect(x-4,bottom,width+8,4);
    c.save();c.beginPath();c.rect(x,y,width,height);c.clip();
    // Dark joints sit under every flagstone.
    c.fillStyle='#4b453b';c.fillRect(x,y,width,height);
    const tw=48,th=32,joint=2;
    const tones=['#6b6254','#72695a','#665d50','#776d5e','#6e6556'];
    for(let row=0;row<Math.ceil(height/th);row++){
      const offset=(row%2)*tw/2;
      for(let col=-1;col<Math.ceil(width/tw)+1;col++){
        const tx=x+col*tw+offset,ty=y+row*th;
        const left=Math.max(x,tx),top=Math.max(y,ty);
        const edgeRight=Math.min(right,tx+tw),edgeBottom=Math.min(bottom,ty+th);
        if(edgeRight<=left||edgeBottom<=top)continue;
        const seed=hashUnit(col,row,101);
        const base=tones[Math.floor(seed*tones.length)%tones.length]!;
        c.fillStyle=base;c.fillRect(left+joint/2,top+joint/2,edgeRight-left-joint,edgeBottom-top-joint);
        // A one-pixel bevel keeps every stone readable without adding noise.
        c.fillStyle=shiftColor(base,12);
        c.fillRect(left+joint/2,top+joint/2,edgeRight-left-joint,1);
        c.fillRect(left+joint/2,top+joint/2,1,edgeBottom-top-joint);
        c.fillStyle=shiftColor(base,-14);
        c.fillRect(left+joint/2,edgeBottom-joint,edgeRight-left-joint,1);
        c.fillRect(edgeRight-joint,top+joint/2,1,edgeBottom-top-joint);
        const wear=hashUnit(col,row,131);
        if(wear>0.9){
          const wx=left+6+Math.floor(hashUnit(col,row,151)*Math.max(1,edgeRight-left-14));
          const wy=top+6+Math.floor(hashUnit(col,row,167)*Math.max(1,edgeBottom-top-14));
          c.fillStyle=shiftColor(base,8);c.fillRect(wx,wy,7,2);c.fillRect(wx+3,wy+2,5,1);
        }else if(wear<0.06){
          const cx2=left+8+Math.floor(hashUnit(col,row,181)*Math.max(1,edgeRight-left-18));
          const cy2=top+7+Math.floor(hashUnit(col,row,193)*Math.max(1,edgeBottom-top-16));
          c.fillStyle='#4a443a';c.fillRect(cx2,cy2,5,1);c.fillRect(cx2+4,cy2+1,1,3);c.fillRect(cx2+5,cy2+4,3,1);
        }
      }
    }
    // A wide architectural medallion centred on the fountain. Filled rings keep
    // the edge hard and pixel-stepped instead of a smooth vector ellipse.
    const mcx=FOUNTAIN.x+FOUNTAIN.width/2,mcy=FOUNTAIN.y+52;
    for(const [rx,ry,color] of [[158,92,'#514b40'],[152,87,'#7b7160'],[146,82,'#5c5549'],
      [132,74,'#6a6153'],[124,68,'#7b7160'],[116,62,'#61594c']] as [number,number,string][])fillPixelEllipse(c,mcx,mcy,rx,ry,color,2);
    // Gold cardinal inlays and eight alternating diamonds mark the approaches.
    c.fillStyle='#b89a5a';
    for(const [dx,dy] of [[0,-84],[0,84],[-140,0],[140,0]] as [number,number][]){c.fillRect(mcx+dx-3,mcy+dy-1,6,3);c.fillRect(mcx+dx-1,mcy+dy-3,3,6);}
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4;
      fillDiamond(c,Math.round(mcx+Math.cos(angle)*138),Math.round(mcy+Math.sin(angle)*84),5,i%2?'#a99d83':'#4e483d');
      for(let r=82;r<=126;r+=11){
        const px=Math.round(mcx+Math.cos(angle)*r),py=Math.round(mcy+Math.sin(angle)*(r*0.6));
        c.fillStyle=i%2?'#857a66':'#6d6455';c.fillRect(px-1,py-1,3,3);
      }
    }
    // Moss gathers in a few sheltered joints at the medallion edge.
    for(const [mx,my] of [[430,340],[680,450],[470,470],[650,320]] as [number,number][]){
      c.fillStyle='#4c6548';c.fillRect(mx,my,4,2);c.fillRect(mx+2,my-1,2,2);
    }
    // Raised curb. Road entries keep deliberate gaps so the plaza never reads
    // as a sealed box: north, west, east and the wide southern market road.
    const band=(bx:number,by:number,bw:number,bh:number)=>{
      if(bw<=0||bh<=0)return;
      c.fillStyle='#3f3a33';c.fillRect(bx,by,bw,bh);
      c.fillStyle='#857a66';c.fillRect(bx+2,by+2,Math.max(0,bw-4),Math.max(0,bh-4));
      c.fillStyle='#575044';c.fillRect(bx+4,by+4,Math.max(0,bw-8),Math.max(0,bh-8));
      c.fillStyle='#3f3a33';
      if(bw>=bh)for(let jx=bx+24;jx<bx+bw;jx+=24)c.fillRect(jx,by+1,1,bh-2);
      else for(let jy=by+24;jy<by+bh;jy+=24)c.fillRect(bx+1,jy,bw-2,1);
    };
    const topGap=[520,632] as const,sideGap=[420,504] as const,bottomGapEnd=756;
    band(x,y,topGap[0]-x,10);band(topGap[1],y,right-topGap[1],10);
    band(x,y,10,sideGap[0]-y);band(x,sideGap[1],10,bottom-sideGap[1]);
    band(right-10,y,10,sideGap[0]-y);band(right-10,sideGap[1],10,bottom-sideGap[1]);
    band(bottomGapEnd,bottom-10,right-bottomGapEnd,10);
    // Cobbled thresholds soften the change from dirt road to plaza stone.
    const cobble=(bx:number,by:number,bw:number,bh:number)=>{
      c.fillStyle='#544d42';c.fillRect(bx,by,bw,bh);
      for(let jy=0;jy<bh;jy+=8)for(let jx=0;jx<bw;jx+=8){
        const tone=['#6e6556','#776d5e','#655c4f'][(jx/8+jy/8)%3]!;
        c.fillStyle=tone;c.fillRect(bx+jx+1,by+jy+1,Math.max(0,Math.min(6,bw-jx-1)),Math.max(0,Math.min(6,bh-jy-1)));
      }
    };
    cobble(520,300,112,12);cobble(392,420,12,84);cobble(1140,420,12,84);cobble(392,848,364,12);
    // Three decorated corner tiles. The south-west corner is the market road
    // mouth, so it stays open instead of growing a decorative block.
    for(const [cx,cy] of [[x+16,y+16],[right-16,y+16],[right-16,bottom-16]] as [number,number][]){
      c.fillStyle='#4b453b';c.fillRect(cx-16,cy-16,32,32);
      c.fillStyle='#7b7160';c.fillRect(cx-13,cy-13,26,26);
      fillDiamond(c,cx,cy,9,'#a99d83');fillDiamond(c,cx,cy,4,'#5c5549');
      c.fillStyle='#b89a5a';c.fillRect(cx-12,cy-12,2,2);c.fillRect(cx+10,cy-12,2,2);c.fillRect(cx-12,cy+10,2,2);c.fillRect(cx+10,cy+10,2,2);
    }
    c.restore();
  }
  /**
   * A three-tier stone fountain inside the original 112x64 collision footprint.
   * The static body is painted once; falling water, ripples and glints animate
   * in render() only while the fountain is on screen.
   */
  private paintFountainBase(c:CanvasRenderingContext2D):void {
    const {x,y,width,height}=FOUNTAIN;
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    c.fillStyle='#172a2555';c.beginPath();c.ellipse(x+width/2,y+height+6,66,13,0,0,Math.PI*2);c.fill();
    // Octagonal basin: top, shoulders, sides and a shadowed bottom lip.
    rect(8,0,96,8,'#7d7361');rect(4,4,4,4,'#746b5b');rect(104,4,4,4,'#746b5b');
    rect(0,8,8,48,'#6f6657');rect(104,8,8,48,'#6f6657');
    rect(4,56,4,4,'#655c4f');rect(104,56,4,4,'#655c4f');rect(8,56,96,8,'#5f574a');
    // Rim light and underside shadow.
    rect(8,0,96,2,'#9a907b');rect(0,8,3,48,'#8a806d');rect(105,8,3,48,'#5a5347');rect(8,59,96,3,'#4a443a');
    // Cut stone joints around the rim.
    for(let bx=12;bx<104;bx+=12){rect(bx,2,1,5,'#5c5549');rect(bx+1,1,10,1,'#8f8570');}
    for(let by=12;by<56;by+=10){rect(1,by,4,1,'#5c5549');rect(107,by,4,1,'#4e483d');}
    // Inner shadow and the basin water.
    rect(10,10,92,44,'#4b453b');
    rect(12,12,88,40,'#2f5557');rect(14,14,84,36,'#356164');
    rect(16,18,80,3,'#3f7273');rect(16,30,80,2,'#3f7273');rect(16,40,80,3,'#4d8583');
    rect(22,16,30,1,'#5d9690');rect(58,26,34,1,'#5d9690');
    rect(52,14,8,36,'#4d8583');
    // Moss on the sheltered north-west rim and the south-east foot.
    rect(10,4,10,3,'#4c6548');rect(14,2,6,2,'#55704b');rect(98,50,8,3,'#4c6548');rect(6,34,2,6,'#55704b');rect(104,22,2,5,'#55704b');
    // Middle tier: pedestal, bowl and the shadow it throws into the water.
    rect(34,48,44,6,'#24484a');
    rect(38,30,36,22,'#6f6657');rect(36,28,40,4,'#8a806d');rect(38,26,36,3,'#9a907b');
    rect(40,32,32,16,'#7a7161');
    rect(44,34,2,12,'#5a5347');rect(54,34,2,12,'#5a5347');rect(64,34,2,12,'#5a5347');
    rect(36,20,40,8,'#7d7361');rect(38,19,36,3,'#9a907b');
    rect(40,23,32,5,'#3f7273');rect(42,24,28,2,'#4d8583');
    // Upper tier: narrower pedestal, bowl and carved finial.
    rect(44,14,24,6,'#2c4c4d');
    rect(46,12,20,12,'#7a7161');rect(44,10,24,3,'#948a75');
    rect(50,14,2,8,'#5a5347');rect(58,14,2,8,'#5a5347');
    rect(44,6,24,7,'#8a806d');rect(46,4,20,3,'#a99d83');
    rect(48,7,16,4,'#3f7273');rect(50,8,12,2,'#5d9690');
    rect(52,0,8,5,'#948a75');rect(50,-1,12,2,'#a99d83');rect(54,1,4,2,'#d8b865');
    // Carved gold inlay and small stone studs around the base.
    rect(30,1,6,2,'#b89a5a');rect(76,1,6,2,'#b89a5a');
    for(const [dx,dy] of [[14,54],[26,54],[74,54],[86,54]] as [number,number][])rect(dx,dy,6,4,'#857a66');
    // Fine weathering and cracks keep the stone from reading as a clean box.
    rect(18,46,4,1,'#4b453b');rect(21,47,1,3,'#4b453b');rect(90,14,3,1,'#4b453b');
  }
  /** Animated fountain water: four falling sheets, expanding ripples, glints. */
  private paintFountainWater(c:CanvasRenderingContext2D,time:number,reduced:boolean):void {
    const cx=FOUNTAIN.x+FOUNTAIN.width/2,top=FOUNTAIN.y;
    const phase=reduced?0:Math.floor(time/90)%8;
    const streams:Array<[number,number,number,string]>=[
      [cx-12,top+10,top+22,'#7fc0b7'],[cx+12,top+10,top+22,'#5d9690'],
      [cx-18,top+30,top+50,'#7fc0b7'],[cx+18,top+30,top+50,'#5d9690'],
    ];
    for(const [sx,sy,ey,color] of streams){
      for(let sy2=sy;sy2<ey;sy2+=4){
        c.fillStyle=(sy2+phase*3)%8<4?color:'#3f7273';
        c.fillRect(sx,Math.round(sy2),2,3);
      }
      c.fillStyle='#cfe9df';c.fillRect(sx-1,ey,4,1);
      if(!reduced){c.fillStyle='#8fc4bb';c.fillRect(sx+(phase%3)-1,ey+1,1,1);}
    }
    // Slow, low-alpha ripples on the basin surface.
    const ripples=reduced?[0.5]:[0,0.33,0.66];
    c.strokeStyle='#9fd6cb';c.lineWidth=1;
    for(const ripple of ripples){
      const t=((time/2600)+ripple)%1,r=8+t*34;
      c.globalAlpha=Math.max(0,0.28*(1-t));
      c.beginPath();c.ellipse(cx,FOUNTAIN.y+40,r,r*0.3,0,0,Math.PI*2);c.stroke();
    }
    c.globalAlpha=1;
    // Small reflections and glints that move a little more slowly than the water.
    const glint=reduced?0:Math.floor(time/420)%3;
    c.fillStyle='#cfe9df';c.fillRect(cx-22+glint*7,FOUNTAIN.y+38,2,1);c.fillRect(cx+12-glint*5,FOUNTAIN.y+30,3,1);
    c.fillStyle='#8fc4bb';c.fillRect(cx-4,FOUNTAIN.y+46,2,2);
    if(!reduced){
      const jet=Math.floor(time/120)%4;
      c.fillStyle='#cfe9df';c.fillRect(cx-1,top-2-jet,2,2);
      c.fillStyle='#8fc4bb';c.fillRect(cx-3,top-4-jet,1,1);c.fillRect(cx+2,top-3-jet,1,1);
    }
  }
  /** Decorative iron lamp with a warm lantern and a mossy stone foot. */
  private paintLamp(c:CanvasRenderingContext2D,x:number,y:number):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    c.fillStyle='#172a2555';c.beginPath();c.ellipse(x,y+4,10,4,0,0,Math.PI*2);c.fill();
    rect(-7,-2,14,6,'#6f6657');rect(-5,-5,10,4,'#857a66');rect(-6,-4,12,2,'#9a907b');
    rect(-2,-34,4,30,'#3a403d');rect(-1,-34,2,30,'#59635c');rect(-4,-36,8,3,'#4a514b');
    rect(-7,-50,14,14,'#3a403d');rect(-5,-48,10,10,'#f0c36f');rect(-4,-47,8,8,'#f6d99a');
    rect(-6,-52,12,3,'#59635c');rect(-3,-54,6,2,'#857a66');rect(-2,-45,4,4,'#fff0b8');
    rect(-1,-57,2,3,'#b89a5a');rect(-8,-40,2,5,'#4a514b');rect(6,-40,2,5,'#4a514b');
    rect(-7,-1,4,2,'#4c6548');rect(4,-2,3,2,'#55704b');
  }
  /** Plaza bench with slatted wood, iron legs and a backrest facing the plaza. */
  private paintPlazaBench(c:CanvasRenderingContext2D,x:number,y:number,facing:'left'|'right'|'down'):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    c.fillStyle='#172a2555';c.beginPath();c.ellipse(x,y+6,16,5,0,0,Math.PI*2);c.fill();
    if(facing==='down'){
      rect(-13,-6,26,8,'#6b4f36');rect(-11,-7,22,3,'#8a6847');
      rect(-13,2,3,5,'#3d3c30');rect(10,2,3,5,'#3d3c30');
      rect(-13,-12,26,3,'#5a402b');rect(-11,-14,22,3,'#7d5c40');
      rect(-9,-4,4,2,'#a17b4f');rect(0,-4,4,2,'#a17b4f');rect(8,-4,3,2,'#a17b4f');
    }else{
      const back=facing==='left'?1:-1;
      rect(-14,-5,28,8,'#6b4f36');rect(-12,-6,24,3,'#8a6847');
      rect(-14,3,3,4,'#3d3c30');rect(11,3,3,4,'#3d3c30');
      rect(back*13,-14,3,14,'#5a402b');rect(back*13,-14,3,3,'#7d5c40');
      rect(-12,-11,24,3,'#7d5c40');
      rect(back*13,-2,3,4,'#3d3c30');
      rect(-10,-4,4,2,'#a17b4f');rect(-2,-4,4,2,'#a17b4f');rect(6,-4,3,2,'#a17b4f');
    }
  }
  /** Stone flower planter with a soil bed and a small, deterministic bloom. */
  private paintPlanter(c:CanvasRenderingContext2D,planter:{x:number;y:number;width:number;height:number;tone:0|1|2}):void {
    const {x,y,width,height,tone}=planter;
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    c.fillStyle='#172a2555';c.beginPath();c.ellipse(x+width/2,y+height+2,width/2+3,4,0,0,Math.PI*2);c.fill();
    const stone=['#6f6657','#756b5b','#685f51'][tone]!;
    rect(0,0,width,height,stone);
    rect(0,0,width,3,'#8a806d');rect(0,height-2,width,2,'#4f483e');
    rect(2,3,width-4,height-5,'#4a3a2c');
    for(let i=0;i<5;i++){
      const fx=4+i*4,fy=5+(i%2)*3;
      rect(fx,fy,2,4,'#597d48');
      rect(fx-1,fy-2,4,3,['#f2c982','#d29dbb','#dce4a0'][(i+tone)%3]!);
      if(i%2===0)rect(fx+1,fy+1,1,1,'#f6e6b0');
    }
    rect(2,0,2,2,'#9a907b');rect(width-4,0,2,2,'#9a907b');
  }
  private paintCave(c:CanvasRenderingContext2D,x:number,y:number,index:number,facing:'north'|'south'|'east'|'west'):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    const [fx,fy]=facing==='south'?[0,4]:facing==='north'?[0,-4]:facing==='west'?[-4,0]:[4,0];
    c.fillStyle='#172b2866';c.beginPath();c.ellipse(x,y+24,54,15,0,0,Math.PI*2);c.fill();
    // Taller, irregular shoulders make the outcrop read before the dark mouth.
    const stones:Array<[number,number,number,number]>=[
      [-44,6,14,24],[-37,-9,17,22],[-30,-24,18,14],[-16,-31,20,12],[4,-31,20,12],
      [21,-24,18,15],[31,-10,18,21],[42,6,15,24],[49,-2,10,18],
      [-24,14,12,12],[14,16,13,11],
    ];
    for(const [stoneIndex,[dx,dy,w,h]] of stones.entries()){
      const stone=stoneIndex%4===index%4?'#666d5e':'#585f53';
      rect(dx-w/2,dy-h/2,w,h,stone);
      rect(dx-w/2+2,dy-h/2,w-4,3,'#84836d');
      if(stoneIndex%2===0)rect(dx-w/2+3,dy+h/2-4,5,4,'#4c6548');
    }
    // Layered thresholds create depth; the interior is unlit rock, not a portal.
    c.fillStyle='#465246';c.beginPath();c.ellipse(x+fx*.4,y+3+fy*.4,28,19,0,0,Math.PI*2);c.fill();
    c.fillStyle='#101b18';c.beginPath();c.ellipse(x+fx,y+3+fy,25,17,0,0,Math.PI*2);c.fill();
    c.fillStyle='#050b09';c.beginPath();c.ellipse(x+fx*1.6,y+4+fy*1.6,17,12,0,0,Math.PI*2);c.fill();
    rect(-23,fy>0?17:15,46,4,'#3f4a3e');rect(-17,7+fy,6,4,'#35463b');rect(11,9+fy,4,3,'#35463b');
    rect(-31,18,7,4,'#706f5d');rect(26,20,6,3,'#706f5d');
    rect(-33,-20,3,5,'#4c6548');rect(28,-18,3,4,'#4c6548');
  }
  private paintSignpost(c:CanvasRenderingContext2D,x:number,y:number,direction:'left'|'right'):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    c.fillStyle='#172b2855';c.beginPath();c.ellipse(x,y+30,17,6,0,0,Math.PI*2);c.fill();
    rect(-3,-2,6,34,'#5b4938');rect(-2,-2,3,34,'#7a6047');
    rect(-16,-34,32,12,'#796047');rect(-13,-31,26,3,'#d2ba7c');
    if(direction==='right'){rect(16,-34,5,4,'#796047');rect(21,-33,3,2,'#796047');}
    else{rect(-21,-34,5,4,'#796047');rect(-24,-33,3,2,'#796047');}
    rect(-8,12,5,4,'#3f3d31');rect(4,20,4,4,'#3f3d31');
  }
  /** Small split-log bench with legs and a backrest, oriented around a fire. */
  private paintBench(c:CanvasRenderingContext2D,x:number,y:number,facing:'left'|'right'|'down'):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    if(facing==='down'){
      rect(0,0,22,8,'#5c4634');rect(2,-1,18,3,'#7d5c40');
      rect(2,8,3,3,'#3d3c30');rect(17,8,3,3,'#3d3c30');
      rect(0,11,22,3,'#6b5138');rect(2,12,18,2,'#7d5c40');
    }else{
      rect(0,0,20,8,'#5c4634');rect(2,-1,16,3,'#7d5c40');
      rect(2,8,3,3,'#3d3c30');rect(15,8,3,3,'#3d3c30');
      rect(4,2,12,2,'#6b5138');
      if(facing==='left'){rect(-2,-2,3,12,'#6b5138');rect(-2,-2,2,3,'#7d5c40');}
      else{rect(19,-2,3,12,'#6b5138');rect(20,-2,2,3,'#7d5c40');}
    }
  }
  private paintRuin(c:CanvasRenderingContext2D,x:number,y:number,index:number,kind:'ruin'|'shrine',accent?:'moss'|'amber'|'violet'|'frost'):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    const [rune,runeLight]=(accent?RUNE_ACCENTS[accent]:undefined)??DEFAULT_RUNES;
    c.fillStyle='#172b2866';c.beginPath();c.ellipse(x,y+21,50,14,0,0,Math.PI*2);c.fill();
    const stones:Array<[number,number,number,number,number]>=[
      [-36,6,13,22,1],[-22,-8,15,12,0],[0,-16,12,28,0],[22,-6,16,14,1],
      [36,8,12,20,0],[-30,22,18,9,1],[14,24,20,8,0],
    ];
    for(const [stoneIndex,[dx,dy,w,h,fallen]] of stones.entries()){
      if((stoneIndex+index)%6===0)continue;
      rect(dx-w/2,fallen?dy:dy-h/2,w,fallen?Math.max(7,Math.round(h/3)):h,stoneIndex%2?'#777a67':'#686f5f');
      if(!fallen)rect(dx-w/2+2,dy-h/2,w-4,3,'#8a8971');
      if(stoneIndex%2===0)rect(dx-w/2+2,fallen?dy+3:dy+h/2-4,4,4,'#55704b');
    }
    rect(-20,8,40,7,'#464f46');
    if(kind==='shrine'){
      rect(-7,-16,14,28,'#7e806b');rect(-4,-13,8,4,'#a29d7b');rect(-2,-5,4,11,'#4c5e4b');
      rect(-1,-9,2,2,runeLight);
      c.fillStyle='#5f6654';c.beginPath();c.ellipse(x,y+15,20,7,0,0,Math.PI*2);c.fill();
      rect(-9,13,18,5,'#777a67');rect(-7,11,14,2,'#8e8d74');
      rect(-28,-6,6,4,rune);rect(24,2,5,4,runeLight);rect(29,-12,3,4,'#55704b');
    }else{
      rect(-17,2,34,6,'#565d50');rect(-8,-6,17,10,'#6c7161');rect(9,-2,5,5,'#8a8971');
      rect(-30,14,6,4,runeLight);rect(27,14,5,4,rune);
      rect(-45,20,12,5,'#5c6455');rect(36,18,10,5,'#5c6455');
      rect(12,-21,4,5,'#55704b');rect(-25,-18,3,4,'#55704b');
    }
    rect(-41,27,9,3,'#4c574a');rect(30,27,8,3,'#4c574a');
  }
  /**
   * The northern pass is a real threshold, not a doorway: stepped cliff
   * shoulders, a carved lintel, snow on the high stone and a dark passage.
   */
  private paintPass(c:CanvasRenderingContext2D,x:number,y:number,index:number):void {
    const rect=(dx:number,dy:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x+dx,y+dy,w,h);};
    c.fillStyle='#172b2866';c.beginPath();c.ellipse(x,y+34,90,20,0,0,Math.PI*2);c.fill();
    // Left and right cliff shoulders step upward toward the gate.
    for(const side of [-1,1]){
      const ox=side*1;
      rect(ox*(side<0?92:38),-18,54,72,'#4b5650');
      rect(ox*(side<0?82:40),-44,42,40,'#56615a');
      rect(ox*(side<0?72:42),-70,30,32,'#616d64');
      rect(ox*(side<0?62:40),-92,22,26,'#6c7870');
      rect(ox*(side<0?70:42),-74,28,5,'#c7d7d2');
      rect(ox*(side<0?60:40),-96,20,4,'#e2efea');
      rect(ox*(side<0?88:38),-22,4,64,'#5f6a62');
      rect(ox*(side<0?78:40),-46,4,38,'#6d786f');
      rect(ox*(side<0?68:42),-72,4,30,'#7a857b');
    }
    // Carved gate: two pillars, a lintel and a dark arched passage.
    rect(-38,-66,76,14,'#727c72');rect(-36,-70,72,5,'#d7e6e2');rect(-20,-74,40,4,'#e8f4f1');
    rect(-32,-54,14,80,'#6b746b');rect(18,-54,14,80,'#6b746b');
    rect(-30,-52,4,74,'#7d877c');rect(20,-52,4,74,'#7d877c');
    c.beginPath();c.moveTo(-18,26);c.lineTo(-18,-24);c.quadraticCurveTo(0,-54,18,-24);c.lineTo(18,26);c.closePath();
    c.fillStyle='#0b1415';c.fill();
    c.beginPath();c.moveTo(-14,26);c.lineTo(-14,-22);c.quadraticCurveTo(0,-48,14,-22);c.lineTo(14,26);c.closePath();
    c.fillStyle='#050b0c';c.fill();
    // Rune-cut keystone and cold glints on the inner faces.
    rect(-8,-62,16,10,'#8f9a8e');rect(-4,-59,8,3,'#dff4ff');
    rect(-24,-10,3,5,'#8fc8dd');rect(21,-4,3,5,'#8fc8dd');
    rect(-16,-38,3,3,index%2?'#dff4ff':'#8fc8dd');rect(12,-32,2,4,'#8fc8dd');
    // Snow drifts and a worn threshold lead into the pass.
    rect(-70,20,140,8,'#c7d7d2');rect(-52,27,104,6,'#b8cac4');
    rect(-46,24,92,7,'#5c675f');rect(-30,29,60,4,'#4f5a53');
    rect(-54,10,8,6,'#7d877c');rect(46,12,7,5,'#7d877c');
    rect(-42,-88,3,5,'#8fc8dd');rect(39,-84,3,4,'#8fc8dd');
  }
  render(frame:WorldFrame):void {
    const {width,height}=this.viewport();const ratio=Math.min(2,window.devicePixelRatio||1);
    const pixelWidth=Math.round(this.canvas.clientWidth*ratio),pixelHeight=Math.round(this.canvas.clientHeight*ratio);
    if(this.canvas.width!==pixelWidth||this.canvas.height!==pixelHeight){this.canvas.width=pixelWidth;this.canvas.height=pixelHeight;}
    const c=this.ctx;c.setTransform(ratio*this.scale,0,0,ratio*this.scale,0,0);c.imageSmoothingEnabled=false;
    c.fillStyle='#1c2b28';c.fillRect(0,0,width,height);c.translate(-Math.round(frame.camera.x),-Math.round(frame.camera.y));
    for(const chunk of this.chunks){
      const sx=Math.max(0,Math.floor(frame.camera.x-chunk.x)),sy=Math.max(0,Math.floor(frame.camera.y-chunk.y));
      const sw=Math.min(chunk.width-sx,Math.ceil(width)+2),sh=Math.min(chunk.height-sy,Math.ceil(height)+2);
      if(sw>0&&sh>0)c.drawImage(chunk.canvas,sx,sy,sw,sh,chunk.x+sx,chunk.y+sy,sw,sh);
    }
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flameFrames:[number,number,number,number][]=[[-7,-12,14,18],[-9,-9,14,16],[-6,-16,13,22],[-5,-10,15,17]];
    const flame=flameFrames[reduced?0:Math.floor(frame.time/190)%flameFrames.length]!;
    for(const {x,y} of CAMPFIRES){
      if(x<frame.camera.x-60||x>frame.camera.x+width+60||y<frame.camera.y-60||y>frame.camera.y+height+60)continue;
      const glow=c.createRadialGradient(x,y,4,x,y,42);glow.addColorStop(0,'#f5b75a25');glow.addColorStop(1,'#f5b75a00');
      c.fillStyle=glow;c.fillRect(x-42,y-42,84,84);
      c.fillStyle='#8b3e2c';c.fillRect(x-9,y-3,18,11);
      c.fillStyle='#e68039';c.fillRect(x+flame[0],y+flame[1],flame[2],flame[3]);
      c.fillStyle='#f3c46b';c.fillRect(x-3,y-9,6,12);c.fillRect(x-1,y-14,3,8);
      if(!reduced){
        const emberPhase=Math.floor((frame.time+x*5+y*3)/380)%4;
        for(let ember=0;ember<3;ember++){
          const rise=emberPhase*3+ember*4;
          const drift=((ember+emberPhase)%3-1)*3;
          c.fillStyle=ember===1?'#f3c46b':'#df8b4a';
          c.fillRect(x-7+drift,y-15-rise,ember===2?1:2,1+(ember%2));
        }
      }
    }
    // Fountain water is painted per frame so the fall, ripples and glints can
    // move without repainting the whole offscreen surface.
    if(FOUNTAIN.x+FOUNTAIN.width>frame.camera.x-48&&FOUNTAIN.x<frame.camera.x+width+48
      &&FOUNTAIN.y+FOUNTAIN.height>frame.camera.y-48&&FOUNTAIN.y<frame.camera.y+height+48)
      this.paintFountainWater(c,frame.time,reduced);
    // Lamps cast a soft warm pool of light. The body is baked into the chunk;
    // only the light and a slow flicker live here.
    for(const {x,y} of PLAZA_LAMPS){
      if(x<frame.camera.x-70||x>frame.camera.x+width+70||y<frame.camera.y-70||y>frame.camera.y+height+70)continue;
      const flicker=reduced?0:Math.round(Math.sin((frame.time+x*7+y*3)/520)*2);
      const glow=c.createRadialGradient(x,y-44,2,x,y-44,30+flicker);
      glow.addColorStop(0,'#f6d99a30');glow.addColorStop(0.5,'#f0c36f18');glow.addColorStop(1,'#f0c36f00');
      c.fillStyle=glow;c.fillRect(x-34,y-78,68,68);
    }
    if(!reduced)for(const site of EXPLORATION_SITES){
      if(site.kind!=='cave')continue;
      const {x,y}=site.position;
      if(x<frame.camera.x-60||x>frame.camera.x+width+60||y<frame.camera.y-60||y>frame.camera.y+height+60)continue;
      const pulse=Math.floor((frame.time+x*3)/520)%3;
      // Faint mineral catches at the rim, never a glowing portal.
      if(pulse===0){c.fillStyle='#9fcabd';c.fillRect(x-2,y+2,2,2);c.fillRect(x+9,y+3,2,2);}
      else if(pulse===1){c.fillStyle='#7fb9ad';c.fillRect(x-11,y+4,2,2);c.fillRect(x+4,y-1,2,2);}
      else{c.fillStyle='#74958c';c.fillRect(x+13,y+7,2,1);}
    }
    for(const resource of frame.resources||[]){
      const {x,y}=resource.position;c.fillStyle='#172b2877';c.fillRect(x-15,y+8,30,6);
      if(resource.kind==='ore'){const [body,depleted,accent]=ORE_COLORS[resource.variant??'iron']??DEFAULT_ORE_COLORS;c.fillStyle=resource.available?body:depleted;c.fillRect(x-13,y-2,26,13);c.fillRect(x-7,y-9,15,9);c.fillStyle=resource.available?accent:'#697069';c.fillRect(x-4,y-6,6,5);c.fillRect(x+6,y+1,4,4);}
      else{c.fillStyle=resource.available?'#548057':'#3c5542';c.fillRect(x-2,y-11,4,22);c.fillRect(x-12,y-7,10,7);c.fillRect(x+2,y-3,12,7);c.fillStyle=resource.available?'#d8c06e':'#71806a';c.fillRect(x-8,y-10,5,5);c.fillRect(x+6,y-7,5,5);}
      if(resource.available&&resource.rarity!=='common'){const color=resource.rarity==='uncommon'?'#a9c889':resource.rarity==='rare'?'#80b9c8':'#d9a8df';c.strokeStyle=color;c.lineWidth=2;c.strokeRect(x-17,y-14,34,28);}
      if(resource.available&&!reduced&&Math.floor((frame.time+x)/420)%2===0){c.fillStyle=resource.rarity==='very_rare'?'#efc8f2':'#f2d88a';c.fillRect(x+13,y-12,3,3);}
    }
    for(const particle of frame.particles||[]){const life=particle.life??650;const remaining=Math.max(0,particle.expiresAt-frame.time),age=1-Math.min(1,remaining/life),size=particle.size??3;c.fillStyle=particle.color;c.fillRect(Math.round(particle.position.x+particle.velocity.x*age),Math.round(particle.position.y+particle.velocity.y*age),size,size);}
    for(const tile of frame.farmTiles||[]){
      const {x,y}=tile.position;
      if(x<frame.camera.x-70||x>frame.camera.x+width+70||y<frame.camera.y-70||y>frame.camera.y+height+70)continue;
      c.fillStyle='#5d3f2c';c.fillRect(x-18,y-4,36,20);
      c.fillStyle='#7a5438';c.fillRect(x-16,y-2,32,15);
      c.fillStyle='#8b6242';for(let furrow=0;furrow<3;furrow++)c.fillRect(x-14,y+1+furrow*4,28,2);
      c.fillStyle='#4a3426';c.fillRect(x-18,y+14,4,4);c.fillRect(x+14,y+14,4,4);
      if(tile.stage==='wild'){
        c.fillStyle='#51684a';c.fillRect(x-4,y-6,2,4);c.fillRect(x+2,y-5,2,3);
      }else{
        const growth=tile.stage==='ready'?1:tile.growth;
        const stem=5+Math.round(growth*15);
        const leaf=tile.crop==='carrot'?'#6fa15c':tile.crop==='pumpkin'?'#5e8a4f':'#9aa85e';
        c.fillStyle='#4c6b45';for(let blade=-1;blade<=1;blade++)c.fillRect(x+blade*7-1,y-stem,2,stem+4);
        c.fillStyle=leaf;c.fillRect(x-9,y-stem+2,6,4);c.fillRect(x+3,y-stem+4,6,4);
        if(tile.stage==='ready'){
          if(tile.crop==='pumpkin'){c.fillStyle='#d98336';c.fillRect(x-7,y-9,14,9);c.fillRect(x-4,y-12,8,4);c.fillStyle='#8a4f27';c.fillRect(x-7,y-6,14,1);}
          else if(tile.crop==='carrot'){c.fillStyle='#d8843f';c.fillRect(x-5,y-6,10,7);c.fillStyle='#7ea55b';c.fillRect(x-4,y-11,3,6);c.fillRect(x+1,y-12,3,7);}
          else{c.fillStyle='#b8944d';c.fillRect(x-3,y-9,6,10);c.fillStyle='#dcc46f';c.fillRect(x-6,y-12,12,3);c.fillRect(x-4,y-15,8,3);}
        }
      }
      const actionable=tile.stage==='wild'||(tile.mine&&tile.stage==='ready');
      if(actionable&&!reduced&&Math.floor((frame.time+x)/380)%2===0){c.fillStyle='#f2d88a';c.fillRect(x+16,y-14,3,3);c.fillRect(x-19,y-10,2,2);}
    }
    c.fillStyle=!reduced&&Math.floor(frame.time/800)%2?'#edbb69':'#ac8859';
    c.fillRect(880,645,8,10);c.fillRect(968,645,8,10);
    if(frame.moveTarget){
      const {x,y}=frame.moveTarget,pulse=reduced?0:Math.round(Math.sin(frame.time/150)*2);
      c.strokeStyle='#f0cf75cc';c.lineWidth=2;c.beginPath();c.ellipse(x,y+8,14+pulse,6+pulse,0,0,Math.PI*2);c.stroke();
      c.fillStyle='#f0cf75';c.fillRect(x-2,y-2,4,4);
    }
    const labels:{x:number;y:number;width:number;height:number}[]=[];
    const visitor=frame.actors.find(actor=>actor.type==='human');
    for(const actor of [...frame.actors].sort((a,b)=>a.position.y-b.position.y)) {
      if(actor.position.x<frame.camera.x-64||actor.position.x>frame.camera.x+width+64||actor.position.y<frame.camera.y-64||actor.position.y>frame.camera.y+height+64)continue;
      const nameWidth=actor.name.length*6.4+10,label={x:actor.position.x-nameWidth/2,y:actor.position.y-57,width:nameWidth,height:14};
      const nearby=isActorNearVisitor(actor,visitor);
      const showName=nearby&&!labels.some(other=>label.x<other.x+other.width&&label.x+label.width>other.x&&label.y<other.y+other.height&&label.y+label.height>other.y);
      if(showName)labels.push(label);
      this.renderActor(actor,frame.time,reduced,showName);
    }
    if(frame.nearby){c.strokeStyle='#e4bc73';c.lineWidth=2;c.beginPath();c.ellipse(frame.nearby.position.x,frame.nearby.position.y+8,22,9,0,0,Math.PI*2);c.stroke();}
    if(frame.guide)this.drawGuide(frame.guide,frame.camera,width,height,frame.time,reduced);
  }
  private drawGuide(guide:{target:Position;label:string},camera:Position,width:number,height:number,time:number,reduced:boolean):void {
    const c=this.ctx,{target,label}=guide,margin=28;
    const inside=target.x>=camera.x+margin&&target.x<=camera.x+width-margin&&target.y>=camera.y+margin&&target.y<=camera.y+height-margin;
    // Keep edge labels inside the viewport on narrow phones instead of
    // clipping the first or last letters.
    const labelX=(text:string,x:number)=>{const half=(text.toUpperCase().length*5.8+8)/2;return Math.max(camera.x+8+half,Math.min(camera.x+width-8-half,x));};
    c.save();
    if(inside){
      const bob=reduced?0:Math.round(Math.sin(time/220)*3),x=target.x,y=target.y-46+bob;
      c.fillStyle='#f0cf75';c.beginPath();c.moveTo(x-9,y-12);c.lineTo(x+9,y-12);c.lineTo(x,y);c.closePath();c.fill();
      c.strokeStyle='#1a2928';c.lineWidth=2;c.stroke();
      this.guideLabel(label,labelX(label,x),y-20);
    }else{
      const cx=camera.x+width/2,cy=camera.y+height/2,angle=Math.atan2(target.y-cy,target.x-cx);
      const rx=width/2-margin-8,ry=height/2-margin-8;
      const scale=Math.min(Math.abs(rx/(Math.cos(angle)||1e-6)),Math.abs(ry/(Math.sin(angle)||1e-6)));
      const x=cx+Math.cos(angle)*scale,y=cy+Math.sin(angle)*scale;
      c.translate(x,y);c.rotate(angle);
      c.fillStyle='#f0cf75';c.beginPath();c.moveTo(13,0);c.lineTo(-8,-9);c.lineTo(-3,0);c.lineTo(-8,9);c.closePath();c.fill();
      c.strokeStyle='#1a2928';c.lineWidth=2;c.stroke();
      c.rotate(-angle);
      const metres=Math.round(Math.hypot(target.x-cx,target.y-cy)/32),text=`${label} · ${metres}m`;
      // The context is translated to the arrow, so draw the label in local space.
      this.guideLabel(text,labelX(text,x)-x,y>camera.y+height-46?-20:16);
    }
    c.restore();
  }
  private guideLabel(label:string,x:number,y:number):void {
    const c=this.ctx,text=label.toUpperCase();
    c.textAlign='center';c.font='bold 9px monospace';
    const width=text.length*5.8+8;
    c.fillStyle='#1a2928e6';c.fillRect(x-width/2,y,width,13);
    c.fillStyle='#f0cf75';c.fillText(text,x,y+10);
  }
  private renderActor(actor:WorldActor,time:number,reduced:boolean,showName:boolean):void {
    const c=this.ctx,{x,y}=actor.position;const sprite=SPRITES.find(s=>s.id===actor.spriteId);const image=this.images.get(actor.spriteId);
    const composed=actor.appearance?appearanceSprites.sheet(actor.appearance)??undefined:undefined;
    c.fillStyle='#172b2880';c.beginPath();c.ellipse(x,y+7,18,7,0,0,Math.PI*2);c.fill();
    const bob=drawActorSprite(c,sprite,image,actor,time,reduced,48,composed);
    if(actor.type==='human'){c.strokeStyle='#c4dfbd';c.lineWidth=2;c.beginPath();c.ellipse(x,y+9,20,8,0,0,Math.PI*2);c.stroke();}
    if(showName){c.textAlign='center';c.font='bold 10px monospace';const name=actor.name.toUpperCase();
      c.fillStyle='#1a2928e0';c.fillRect(x-name.length*3.2-5,y-57-bob,name.length*6.4+10,14);
      c.fillStyle=actor.type==='human'?'#cce4bf':'#e8d3a6';c.fillText(name,x,y-47-bob);}
    if(actor.recentWinner){c.fillStyle='#edbe66';c.fillRect(x-6,y-68,12,5);c.fillRect(x-6,y-73,3,5);c.fillRect(x-1,y-75,3,7);c.fillRect(x+4,y-73,3,5);}
    if(actor.type==='npc'&&actor.speech&&actor.speech.expiresAt>time){
      const lift=reduced?0:Math.floor(time/320)%2;c.fillStyle='#1a2928e8';c.fillRect(x-7,y-82-lift,14,16);
      c.fillStyle='#f1cf78';c.fillRect(x-1,y-79-lift,3,8);c.fillRect(x-1,y-68-lift,3,3);
    }
  }
  destroy():void {this.images.clear();for(const chunk of this.chunks){chunk.canvas.width=0;chunk.canvas.height=0;}this.chunks=[];}
}
