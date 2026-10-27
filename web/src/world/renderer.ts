import { MAP, BUILDINGS, BUSHES, CAMPFIRES, FLOWER_BEDS, GROUND_DETAILS, MARKET_PROPS, PATHS, ROCKS, TERRAIN_AREAS, TREES } from './map.js';
import { SPRITES, type SpriteDefinition } from './sprites.js';
import type { Position, WorldActor, Interactable, WorldParticle, WorldResource } from './model.js';
export interface WorldFrame { actors:WorldActor[];camera:Position;nearby?:Interactable;time:number;resources?:WorldResource[];particles?:WorldParticle[] }
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
    c.translate(-MAP.minX,-MAP.minY);
    rect(MAP.minX,MAP.minY,MAP.width,MAP.height,'#253c36');
    for(let y=MAP.minY+64;y<MAP.minY+MAP.height-40;y+=32)for(let x=MAP.minX+40;x<MAP.minX+MAP.width-40;x+=32){
      rect(x,y,32,32,(x*7+y*13)%5===0?'#344b3e':'#30483c');
      if((x+y)%96===0)rect(x+8,y+20,4,3,'#4b6146');
    }
    // Large vegetation regions use stepped, overlapping pixel blocks. This
    // avoids the vector-like diagonal wedges created by arbitrary polygons.
    for(const area of TERRAIN_AREAS)rect(area.x,area.y,area.width,area.height,area.color);
    rect(1088,128,360,780,'#294b3a');rect(1160,220,350,780,'#294b3a');rect(1260,340,290,620,'#294b3a');
    for(const path of PATHS)rect(path.x,path.y,path.width,path.height,path.color||'#6b6150');
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
    // Stable, visual-only texture. Coordinates are generated once from the
    // central map data rather than changing on every frame or browser.
    const groundTones=['#5f574a','#807361','#91816a'];
    for(const detail of GROUND_DETAILS){
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
        if(b.name==='DATA'){rect(b.x+22,b.y+68,32,15,'#243d43');rect(b.x+26,b.y+72,24,3,b.accent||'#a7d5c2');}
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
    rect(500,340,112,64,'#8e8b6d');rect(508,348,96,48,'#416c6b');rect(542,330,28,44,'#aca37f');
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
      for(const [dx,dy] of [[-19,0],[-13,-9],[-2,-12],[10,-9],[17,0],[10,10],[-2,12],[-13,10]] as [number,number][])rect(x+dx-4,y+dy-3,8,6,'#8a8673');
      rect(x-14,y+4,28,6,'#604934');rect(x-11,y-2,22,6,'#795639');
      rect(x-14,y+1,5,4,'#a17b4f');rect(x+8,y-4,5,4,'#a17b4f');
    }
    c.fillStyle='#e5dfab';c.font='bold 12px monospace';c.textAlign='center';c.fillText('FOREST TRAIL',1280,180);c.fillText('CLEARING',1280,540);c.fillText('BOTANICAL GARDEN',1870,490);c.fillText('WORLD BAZAAR',900,1088);
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
    for(const resource of frame.resources||[]){
      const {x,y}=resource.position;c.fillStyle='#172b2877';c.fillRect(x-15,y+8,30,6);
      if(resource.kind==='ore'){c.fillStyle=resource.available?'#8d9288':'#4f5952';c.fillRect(x-13,y-2,26,13);c.fillRect(x-7,y-9,15,9);c.fillStyle=resource.available?'#c8b66d':'#697069';c.fillRect(x-4,y-6,6,5);c.fillRect(x+6,y+1,4,4);}
      else{c.fillStyle=resource.available?'#548057':'#3c5542';c.fillRect(x-2,y-11,4,22);c.fillRect(x-12,y-7,10,7);c.fillRect(x+2,y-3,12,7);c.fillStyle=resource.available?'#d8c06e':'#71806a';c.fillRect(x-8,y-10,5,5);c.fillRect(x+6,y-7,5,5);}
      if(resource.available&&!reduced&&Math.floor((frame.time+x)/420)%2===0){c.fillStyle='#f2d88a';c.fillRect(x+13,y-12,3,3);}
    }
    for(const particle of frame.particles||[]){const remaining=Math.max(0,particle.expiresAt-frame.time),age=1-Math.min(1,remaining/650);c.fillStyle=particle.color;c.fillRect(Math.round(particle.position.x+particle.velocity.x*age),Math.round(particle.position.y+particle.velocity.y*age),3,3);}
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
    if(actor.type==='npc'&&actor.speech&&actor.speech.expiresAt>time){
      const lift=reduced?0:Math.floor(time/320)%2;c.fillStyle='#1a2928e8';c.fillRect(x-7,y-82-lift,14,16);
      c.fillStyle='#f1cf78';c.fillRect(x-1,y-79-lift,3,8);c.fillRect(x-1,y-68-lift,3,3);
    }
  }
  destroy():void {this.images.clear();}
}
