import { MAP, BUILDINGS } from './map.js';
import { SPRITES } from './sprites.js';
import type { Position, WorldActor, Interactable } from './model.js';
export interface WorldFrame { actors:WorldActor[];camera:Position;nearby?:Interactable;time:number }
export interface WorldRenderer {
  viewport():{width:number;height:number};
  render(frame:WorldFrame):void;
  destroy():void;
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
    rect(0,0,MAP.width,MAP.height,'#253c36');
    for(let y=64;y<MAP.height-40;y+=32)for(let x=40;x<MAP.width-40;x+=32){
      rect(x,y,32,32,(x*7+y*13)%5===0?'#344b3e':'#30483c');
      if((x+y)%96===0)rect(x+8,y+20,4,3,'#4b6146');
    }
    rect(392,300,364,424,'#6b6150');rect(72,420,1024,84,'#6b6150');rect(860,300,112,400,'#6b6150');
    rect(140,494,148,152,'#6b6150');rect(480,688,160,140,'#6b6150');
    for(let y=320;y<720;y+=32)for(let x=416;x<750;x+=32)rect(x,y,26,2,'#81735c');
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
    c.fillStyle='#e5dfab';c.font='bold 12px monospace';c.textAlign='center';c.fillText('RESEARCH ARCHIVE',560,770);
    c.fillText('FREE TABLE',224,655);c.fillText('PLAZA',558,445);
    // Decorative trees live outside circulation routes.
    for(const [x,y] of [[60,120],[65,280],[60,710],[340,770],[1060,180],[1056,350],[1030,770]]){
      rect(x!,y!+24,12,28,'#675542');rect(x!-18,y!,48,34,'#496345');rect(x!-10,y!-12,32,26,'#56734b');
    }
    rect(32,56,MAP.width-64,8,'#77705b');rect(32,MAP.height-40,MAP.width-64,8,'#77705b');
    rect(32,56,8,MAP.height-88,'#77705b');rect(MAP.width-40,56,8,MAP.height-88,'#77705b');
  }
  render(frame:WorldFrame):void {
    const {width,height}=this.viewport();const ratio=Math.min(2,window.devicePixelRatio||1);
    const pixelWidth=Math.round(this.canvas.clientWidth*ratio),pixelHeight=Math.round(this.canvas.clientHeight*ratio);
    if(this.canvas.width!==pixelWidth||this.canvas.height!==pixelHeight){this.canvas.width=pixelWidth;this.canvas.height=pixelHeight;}
    const c=this.ctx;c.setTransform(ratio*this.scale,0,0,ratio*this.scale,0,0);c.imageSmoothingEnabled=false;
    c.fillStyle='#1c2b28';c.fillRect(0,0,width,height);c.translate(-Math.round(frame.camera.x),-Math.round(frame.camera.y));
    c.drawImage(this.map,0,0);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.fillStyle=!reduced&&Math.floor(frame.time/800)%2?'#edbb69':'#ac8859';
    c.fillRect(880,645,8,10);c.fillRect(968,645,8,10);
    const labels:{x:number;y:number;width:number;height:number}[]=[];
    for(const actor of [...frame.actors].sort((a,b)=>a.position.y-b.position.y)) {
      if(actor.position.x<frame.camera.x-64||actor.position.x>frame.camera.x+width+64||actor.position.y<frame.camera.y-64||actor.position.y>frame.camera.y+height+64)continue;
      const nameWidth=actor.name.length*6.4+10,label={x:actor.position.x-nameWidth/2,y:actor.position.y-57,width:nameWidth,height:14};
      const nearby=actor.type==='human'||Math.hypot(actor.position.x-frame.actors.find(a=>a.type==='human')!.position.x,actor.position.y-frame.actors.find(a=>a.type==='human')!.position.y)<150;
      const showName=nearby&&!labels.some(other=>label.x<other.x+other.width&&label.x+label.width>other.x&&label.y<other.y+other.height&&label.y+label.height>other.y);
      if(showName)labels.push(label);
      this.renderActor(actor,frame.time,reduced,showName);
    }
    if(frame.nearby){c.strokeStyle='#e4bc73';c.lineWidth=2;c.beginPath();c.ellipse(frame.nearby.position.x,frame.nearby.position.y+8,22,9,0,0,Math.PI*2);c.stroke();}
  }
  private renderActor(actor:WorldActor,time:number,reduced:boolean,showName:boolean):void {
    const c=this.ctx,{x,y}=actor.position;const sprite=SPRITES.find(s=>s.id===actor.spriteId);const image=this.images.get(actor.spriteId);
    const animation=sprite?.animations[`${actor.movementState==='walking'?'walk':'idle'}_${actor.facing}`]||[0];
    const frame=animation[Math.floor(time/150)%animation.length]||0;
    const bob=actor.movementState==='walking'&&!reduced?Math.floor(time/140)%2*2:0;
    c.fillStyle='#172b2880';c.beginPath();c.ellipse(x,y+7,18,7,0,0,Math.PI*2);c.fill();
    if(image?.complete&&image.naturalWidth&&sprite){
      const columns=Math.max(1,Math.floor(image.naturalWidth/sprite.frameWidth));
      c.drawImage(image,frame%columns*sprite.frameWidth,Math.floor(frame/columns)*sprite.frameHeight,sprite.frameWidth,sprite.frameHeight,Math.round(x-24),Math.round(y-40-bob),48,48);
    }else{c.fillStyle='#d5b882';c.fillRect(x-10,y-28,20,28);}
    if(actor.type==='human'){c.strokeStyle='#c4dfbd';c.lineWidth=2;c.beginPath();c.ellipse(x,y+9,20,8,0,0,Math.PI*2);c.stroke();}
    if(showName){c.textAlign='center';c.font='bold 10px monospace';const name=actor.name.toUpperCase();
      c.fillStyle='#1a2928e0';c.fillRect(x-name.length*3.2-5,y-57-bob,name.length*6.4+10,14);
      c.fillStyle=actor.type==='human'?'#cce4bf':'#e8d3a6';c.fillText(name,x,y-47-bob);}
    if(actor.recentWinner){c.fillStyle='#edbe66';c.fillRect(x-6,y-68,12,5);c.fillRect(x-6,y-73,3,5);c.fillRect(x-1,y-75,3,7);c.fillRect(x+4,y-73,3,5);}
  }
  destroy():void {this.images.clear();}
}
