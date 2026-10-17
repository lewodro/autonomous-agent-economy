import { MAP, BUILDINGS, BUSHES, CAMPFIRES, FLOWER_BEDS, ROCKS, TREES } from './map.js';
import { SPRITES, type SpriteDefinition } from './sprites.js';
import type { Position, WorldActor, Interactable } from './model.js';
export interface WorldFrame { actors:WorldActor[];camera:Position;nearby?:Interactable;time:number }
export interface WorldRenderer {
  viewport():{width:number;height:number};
  render(frame:WorldFrame):void;
  destroy():void;
}
export function isActorNearVisitor(actor:WorldActor,visitor:WorldActor|undefined,distance=150):boolean {
  return actor.type==='human'||!!visitor&&Math.hypot(actor.position.x-visitor.position.x,actor.position.y-visitor.position.y)<distance;
}
/** Shared world sprite frame selection for the plaza and the read-only Arena. */
export function drawActorSprite(c:CanvasRenderingContext2D,sprite:SpriteDefinition|undefined,image:HTMLImageElement|undefined,actor:Pick<WorldActor,'position'|'facing'|'movementState'>,time:number,reduced:boolean,size=48):number {
  const {x,y}=actor.position;
  const animation=sprite?.animations[`${actor.movementState==='walking'?'walk':'idle'}_${actor.facing}`]||[0];
  const frame=animation[Math.floor(time/150)%animation.length]||0;
  const bob=actor.movementState==='walking'&&!reduced?Math.floor(time/140)%2*2:0;
  if(image?.complete&&image.naturalWidth&&sprite){
    const columns=Math.max(1,Math.floor(image.naturalWidth/sprite.frameWidth));
    c.drawImage(image,frame%columns*sprite.frameWidth,Math.floor(frame/columns)*sprite.frameHeight,sprite.frameWidth,sprite.frameHeight,Math.round(x-size/2),Math.round(y-size*5/6-bob),size,size);
  }else{c.fillStyle='#d5b882';c.fillRect(x-size*5/24,y-size*7/12,size*5/12,size*7/12);}
  return bob;
}
/** Rendering accepts presence snapshots only; it cannot advance or settle a game. */
export class CanvasWorldRenderer implements WorldRenderer {
  private ctx:CanvasRenderingContext2D;
  private map=document.createElement('canvas');
  private images=new Map<string,HTMLImageElement>();
  private scale=1;
  constructor(private canvas:HTMLCanvasElement) {
    const context=canvas.getContext('2d');if(!context)throw new Error('Your browser does not support the world renderer.');this.ctx=context;
    this.map.width=MAP.width;this.map.height=MAP.height;this.paintMap();
    for(const sprite of SPRITES){const image=new Image();image.src=sprite.sheet;this.images.set(sprite.id,image);}
  }
  viewport():{width:number;height:number} {
    const width=Math.max(1,this.canvas.clientWidth),height=Math.max(1,this.canvas.clientHeight);
    this.scale=Math.min(1.5,width/400);
    return {width:Math.min(MAP.width,width/this.scale),height:Math.min(MAP.height,height/this.scale)};
  }
  private paintMap():void {
    const c=this.map.getContext('2d')!;c.imageSmoothingEnabled=false;
    const rect=(x:number,y:number,w:number,h:number,color:string)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
    const patch=(points:[number,number][],color:string)=>{c.fillStyle=color;c.beginPath();c.moveTo(points[0]![0],points[0]![1]);for(const [x,y] of points.slice(1))c.lineTo(x,y);c.closePath();c.fill();};
    c.translate(-MAP.minX,-MAP.minY);
    rect(MAP.minX,MAP.minY,MAP.width,MAP.height,'#253c36');
    for(let y=MAP.minY+64;y<MAP.minY+MAP.height-40;y+=32)for(let x=MAP.minX+40;x<MAP.minX+MAP.width-40;x+=32){
      rect(x,y,32,32,(x*7+y*13)%5===0?'#344b3e':'#30483c');
      if((x+y)%96===0)rect(x+8,y+20,4,3,'#4b6146');
    }
    // Broad landscape patches leave generous open ground between landmarks.
    patch([[-830,-490],[-420,-470],[-260,-280],[-340,60],[-820,160]],'#34513f');
    patch([[-820,840],[-520,740],[-290,1040],[-360,1600],[-820,1620]],'#355240');
    patch([[-100,-500],[410,-500],[560,-330],[460,-120],[-90,-160]],'#35513e');
    patch([[1900,-490],[2560,-490],[2580,1090],[2230,1170],[1930,860],[1810,240]],'#2d4c39');
    patch([[1460,470],[1770,420],[2100,480],[2220,710],[2150,1090],[1880,1160],[1510,1040],[1410,740]],'#3d6047');
    // Extend the existing plaza floor treatment into the new open space. The
    // left public/training side keeps its original footprint and landmarks.
    rect(392,300,760,560,'#6b6150');rect(72,420,1024,84,'#6b6150');rect(860,300,112,400,'#6b6150');
    rect(140,494,148,152,'#6b6150');rect(480,688,160,140,'#6b6150');
    // These wide floor connectors follow the original treatment; no markings.
    rect(-730,420,802,84,'#6b6150');rect(392,-420,364,720,'#6b6150');rect(392,860,364,620,'#6b6150');
    // The east connector opens into a low-cost forest and garden zone. These
    // are copied ground treatments, with no repeated road markings.
    patch([[1088,128],[1450,128],[1580,310],[1510,660],[1540,960],[1200,1030],[1088,900]],'#294b3a');
    rect(1040,500,600,56,'#6b6150');
    patch([[1520,520],[1590,520],[1760,670],[1890,670],[1890,730],[1735,730],[1580,580],[1520,580]],'#786b55');
    patch([[1790,700],[1850,700],[1990,920],[2050,920],[2050,975],[1960,975]],'#786b55');
    for(const b of BUILDINGS){
      rect(b.x+8,b.y+8,b.width,b.height,'#1c2b28');rect(b.x,b.y,b.width,b.height,b.color);
      rect(b.x+8,b.y+8,b.width-16,80,'#403838');
      for(let line=12;line<80;line+=12)rect(b.x+8,b.y+line,b.width-16,3,'#65524a');
      rect(b.x-8,b.y+80,b.width+16,10,'#281f26');
      rect(b.x+b.width/2-20,b.y+b.height-42,40,42,'#282d2b');
      rect(b.x+28,b.y+110,32,24,'#243c3a');rect(b.x+b.width-60,b.y+110,32,24,'#243c3a');
      rect(b.x+32,b.y+114,24,3,'#b2c28b');rect(b.x+b.width-56,b.y+114,24,3,'#b2c28b');
      c.font='bold 14px monospace';c.textAlign='center';c.fillStyle='#f4dfaf';c.fillText(b.name,b.x+b.width/2,b.y+105);
    }
    // Fountain, table and archive use the same footprint as collision rectangles.
    rect(500,340,112,64,'#8e8b6d');rect(508,348,96,48,'#416c6b');rect(542,330,28,44,'#aca37f');
    rect(184,530,80,48,'#916d4e');rect(192,538,64,32,'#b29261');
    for(let n=1;n<3;n++){rect(204+n*12,542,2,24,'#493f38');rect(200,538+n*10,44,2,'#493f38');}
    rect(208,590,30,10,'#946f52');rect(208,511,30,10,'#946f52');
    rect(480,720,160,32,'#776951');rect(492,701,136,43,'#243f3e');rect(501,711,118,18,'#83a98b');
    c.fillStyle='#e5dfab';c.font='bold 12px monospace';c.textAlign='center';c.fillText('ARENA STATISTICS',560,770);
    c.fillText('FREE TABLE',224,655);c.fillText('PLAZA',558,445);
    // Trees share trunk collision; varied crowns keep the garden organic.
    const treePalettes=[['#496345','#56734b'],['#3e6145','#638052'],['#4d6440','#71804c']];
    for(const {x,y,scale=1,tint=0} of TREES){
      const [dark,light]=treePalettes[tint]!;
      rect(x,y+24*scale,12*scale,28*scale,'#675542');
      rect(x-18*scale,y,48*scale,34*scale,dark!);
      rect(x-10*scale,y-12*scale,32*scale,26*scale,light!);
      rect(x+3*scale,y-8*scale,10*scale,6*scale,dark!);
    }
    const bushPalettes=[['#355940','#4e744b'],['#3d6045','#608052'],['#456040','#70814e']];
    for(const {x,y,size,tint=0} of BUSHES){
      const [dark,light]=bushPalettes[tint]!;
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
      for(const [dx,dy] of [[-19,0],[-13,-9],[-2,-12],[10,-9],[17,0],[10,10],[-2,12],[-13,10]] as [number,number][])rect(x+dx-4,y+dy-3,8,6,'#8a8673');
      rect(x-14,y+4,28,6,'#604934');rect(x-11,y-2,22,6,'#795639');
      rect(x-14,y+1,5,4,'#a17b4f');rect(x+8,y-4,5,4,'#a17b4f');
    }
    c.fillStyle='#e5dfab';c.font='bold 12px monospace';c.textAlign='center';c.fillText('FOREST TRAIL',1280,180);c.fillText('CLEARING',1280,540);c.fillText('BOTANICAL GARDEN',1870,490);
    rect(MAP.minX+32,MAP.minY+56,MAP.width-64,8,'#77705b');rect(MAP.minX+32,MAP.minY+MAP.height-40,MAP.width-64,8,'#77705b');
    rect(MAP.minX+32,MAP.minY+56,8,MAP.height-88,'#77705b');rect(MAP.minX+MAP.width-40,MAP.minY+56,8,MAP.height-88,'#77705b');
  }
  render(frame:WorldFrame):void {
    const {width,height}=this.viewport();const ratio=Math.min(2,window.devicePixelRatio||1);
    const pixelWidth=Math.round(this.canvas.clientWidth*ratio),pixelHeight=Math.round(this.canvas.clientHeight*ratio);
    if(this.canvas.width!==pixelWidth||this.canvas.height!==pixelHeight){this.canvas.width=pixelWidth;this.canvas.height=pixelHeight;}
    const c=this.ctx;c.setTransform(ratio*this.scale,0,0,ratio*this.scale,0,0);c.imageSmoothingEnabled=false;
    c.fillStyle='#1c2b28';c.fillRect(0,0,width,height);c.translate(-Math.round(frame.camera.x),-Math.round(frame.camera.y));
    const sx=Math.max(0,Math.floor(frame.camera.x-MAP.minX)),sy=Math.max(0,Math.floor(frame.camera.y-MAP.minY));
    const sw=Math.min(MAP.width-sx,Math.ceil(width)+2),sh=Math.min(MAP.height-sy,Math.ceil(height)+2);
    c.drawImage(this.map,sx,sy,sw,sh,MAP.minX+sx,MAP.minY+sy,sw,sh);
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
    }
    c.fillStyle=!reduced&&Math.floor(frame.time/800)%2?'#edbb69':'#ac8859';
    c.fillRect(880,645,8,10);c.fillRect(968,645,8,10);
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
  }
  private renderActor(actor:WorldActor,time:number,reduced:boolean,showName:boolean):void {
    const c=this.ctx,{x,y}=actor.position;const sprite=SPRITES.find(s=>s.id===actor.spriteId);const image=this.images.get(actor.spriteId);
    c.fillStyle='#172b2880';c.beginPath();c.ellipse(x,y+7,18,7,0,0,Math.PI*2);c.fill();
    const bob=drawActorSprite(c,sprite,image,actor,time,reduced);
    if(actor.type==='human'){c.strokeStyle='#c4dfbd';c.lineWidth=2;c.beginPath();c.ellipse(x,y+9,20,8,0,0,Math.PI*2);c.stroke();}
    if(showName){c.textAlign='center';c.font='bold 10px monospace';const name=actor.name.toUpperCase();
      c.fillStyle='#1a2928e0';c.fillRect(x-name.length*3.2-5,y-57-bob,name.length*6.4+10,14);
      c.fillStyle=actor.type==='human'?'#cce4bf':'#e8d3a6';c.fillText(name,x,y-47-bob);}
    if(actor.recentWinner){c.fillStyle='#edbe66';c.fillRect(x-6,y-68,12,5);c.fillRect(x-6,y-73,3,5);c.fillRect(x-1,y-75,3,7);c.fillRect(x+4,y-73,3,5);}
  }
  destroy():void {this.images.clear();}
}
