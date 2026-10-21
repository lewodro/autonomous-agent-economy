import { drawActorSprite } from './renderer.js';
import { SPRITES, loadSettings } from './sprites.js';
interface Point{x:number;y:number}
interface Room{id:string;label:string;x:number;y:number;w:number;h:number;terrain:string;restricted:boolean}
interface Prop{id:string;kind:string;x:number;y:number;solid:boolean}
interface EscapeRoute{id:string;label:string;position:Point;requires:string[];stages:{id:string;label:string;requires:string[]}[]}
interface CompoundMap{width:number;height:number;tile_size:number;rooms:Room[];walls:Point[];doors:{id:string;position:Point;room_id:string;mode:string}[];props:Prop[];escape_routes:EscapeRoute[]}
interface CompoundParticipant{id:string;name:string;type:'human'|'agent';avatar?:string|null;position:Point;facing:string;public_role:string;role?:string;room:string;heat:number;hp:number;stamina:number;activity:string;status:string;inventory_count:number;inventory?:string[];objective?:string;job_progress?:number;job?:string;credits?:number;stats?:{strength:number;fitness:number;intellect:number};escape_progress?:Record<string,number>;crafting?:{id:string;label:string;available:boolean}[];message?:string|null}
interface CompoundResult{session_id:string;reason:string;duration_ms:number;winner_ids:string[];escaped_ids:string[];participants:{id:string;name:string;status:string}[]}
interface CompoundSnapshot{phase:'lobby'|'active'|'finished';round:number;revision:number;started_at:string|null;ends_at:number|null;routine_phase:string;routine:{current:string;next:string;required_room:string|null};security:string;map:CompoundMap;world_items:{id:string;type:string;position:Point}[];containers:{id:string;available:number}[];participants:CompoundParticipant[];events:{id:string;at:string;type:string;message:string}[];results:CompoundResult[];you:string|null}
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('compound-map'),context=canvas.getContext('2d',{alpha:false})!,statusEl=$<HTMLDivElement>('compound-status'),lobby=$<HTMLDivElement>('compound-lobby'),you=$<HTMLDivElement>('compound-you'),resultsEl=$<HTMLDivElement>('compound-results'),participants=$<HTMLDivElement>('compound-participants'),events=$<HTMLOListElement>('compound-events'),hint=$<HTMLDivElement>('compound-hint');
let state:CompoundSnapshot|null=null,busy=false,lastRevision=-1,errorText='',previousPositions=new Map<string,Point>(),renderPositions=new Map<string,Point>();
const spriteById=new Map(SPRITES.map(sprite=>[sprite.id,sprite]));
const spriteImages=new Map(SPRITES.map(sprite=>{const image=new Image();image.src=sprite.sheet;return[sprite.id,image] as const;}));
const COLORS={outside:'#172b26',corridor:'#6b6453',wall:'#273d36',wallTop:'#51665a',door:'#b67d42',restricted:'#594c52',cell:'#718170',cafeteria:'#80765f',kitchen:'#766a52',security:'#574d55',visitation:'#756b5a',yard:'#526e50',workshop:'#6d6755',infirmary:'#697b73',showers:'#537174',storage:'#625d50',utility:'#525d58',service:'#4d5952'} as const;
async function request<T>(url:string,options?:RequestInit):Promise<T>{const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options?.headers||{})},signal:AbortSignal.timeout(8000)});if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(detail.error||'Compound request failed');}return response.json() as Promise<T>}
function button(label:string,action:()=>void,className=''):HTMLButtonElement{const b=document.createElement('button');b.textContent=label;b.className=className;b.onclick=()=>{if(!busy)action();};return b;}
function roomAt(x:number,y:number):Room|undefined{return state?.map.rooms.find(room=>x>=room.x&&x<room.x+room.w&&y>=room.y&&y<room.y+room.h);}
function tileCenter(point:Point,size:number):Point{return{x:(point.x+.5)*size,y:(point.y+.5)*size};}
function drawPixelText(text:string,x:number,y:number,size=11,align:CanvasTextAlign='left'):void{context.font=`700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;context.textAlign=align;context.fillStyle='#f1dfb8';context.fillText(text,x,y);}
function drawProp(prop:Prop,size:number):void{
 const x=prop.x*size,y=prop.y*size,pad=Math.max(3,size*.16);context.fillStyle='#182b26';context.fillRect(x+3,y+size-6,size-6,4);
 if(prop.kind==='bed'||prop.kind==='medical_bed'){context.fillStyle=prop.kind==='medical_bed'?'#d7e2d7':'#6a4b3b';context.fillRect(x+pad,y+pad,size-pad*2,size-pad*2);context.fillStyle='#e8dec8';context.fillRect(x+pad,y+pad,size-pad*2,Math.max(5,size*.24));}
 else if(prop.kind==='locker'||prop.kind==='cabinet'){context.fillStyle='#84908a';context.fillRect(x+pad,y+2,size-pad*2,size-5);context.fillStyle='#273d36';context.fillRect(x+size*.68,y+size*.5,2,2);}
 else if(prop.kind==='table'||prop.kind==='bench'||prop.kind==='workbench'||prop.kind==='counter'||prop.kind==='guard_desk'){context.fillStyle=prop.kind==='workbench'?'#8b633d':'#76583e';context.fillRect(x+3,y+7,size-6,size-13);context.fillStyle='#b18a58';context.fillRect(x+2,y+5,size-4,5);}
 else if(prop.kind==='stove'){context.fillStyle='#2c3331';context.fillRect(x+4,y+4,size-8,size-8);context.fillStyle='#d46b3b';context.fillRect(x+8,y+8,5,5);context.fillRect(x+size-13,y+8,5,5);}
 else if(prop.kind==='weights'){context.strokeStyle='#c2c8b5';context.lineWidth=3;context.beginPath();context.moveTo(x+5,y+size*.55);context.lineTo(x+size-5,y+size*.55);context.stroke();context.fillStyle='#263630';context.fillRect(x+3,y+size*.42,6,10);context.fillRect(x+size-9,y+size*.42,6,10);}
 else if(prop.kind==='treadmill'){context.fillStyle='#303b38';context.fillRect(x+4,y+size-10,size-8,7);context.fillStyle='#8a9d8f';context.fillRect(x+size-9,y+5,4,size-12);}
 else if(prop.kind==='shower'){context.fillStyle='#9ac0bf';context.fillRect(x+size*.45,y+3,4,size-7);context.fillRect(x+size*.45,y+3,size*.3,4);context.fillStyle='#6ca4aa';context.fillRect(x+size*.68,y+7,5,5);}
 else if(prop.kind==='crate'||prop.kind==='food_crate'){context.fillStyle=prop.kind==='food_crate'?'#748348':'#7b5c3d';context.fillRect(x+4,y+4,size-8,size-8);context.strokeStyle='#b08a56';context.strokeRect(x+6,y+6,size-12,size-12);}
 else if(prop.kind==='sink'){context.fillStyle='#a9beb6';context.fillRect(x+7,y+8,size-14,size-13);context.fillStyle='#547a76';context.fillRect(x+11,y+11,size-22,size-19);}
 else if(['monitor','terminal','machine'].includes(prop.kind)){context.fillStyle='#26332f';context.fillRect(x+4,y+4,size-8,size-8);context.fillStyle='#7fc0a4';context.fillRect(x+8,y+7,size-16,size-15);context.fillStyle='#d8c46c';context.fillRect(x+9,y+size-7,4,2);}
 else if(prop.kind==='alarm'){context.fillStyle='#4b2626';context.fillRect(x+8,y+6,size-16,size-12);context.fillStyle='#e26952';context.fillRect(x+11,y+8,size-22,size-20);}
 else if(['shelf','pipes','divider','laundry','key_board'].includes(prop.kind)){context.fillStyle='#42564e';context.fillRect(x+5,y+4,size-10,size-8);context.fillStyle='#9a8b68';context.fillRect(x+8,y+8,size-16,3);context.fillRect(x+8,y+size-11,size-16,3);}
 else{context.fillStyle='#314b45';context.fillRect(x+4,y+4,size-8,size-8);context.fillStyle='#e1bd66';context.fillRect(x+8,y+8,size-16,4);}
}
function drawActor(actor:CompoundParticipant,size:number,time:number):void{
 const target=tileCenter(actor.position,size),current=renderPositions.get(actor.id)||previousPositions.get(actor.id)||target,lerp=.16;current.x+=(target.x-current.x)*lerp;current.y+=(target.y-current.y)*lerp;renderPositions.set(actor.id,current);
 const x=Math.round(current.x),y=Math.round(current.y),youActor=actor.id===state?.you;
 context.fillStyle='rgba(12,24,20,.45)';context.fillRect(x-size*.3,y+size*.25,size*.6,size*.18);
 const spriteId=actor.type==='human'?(actor.avatar||'visitor_ember'):actor.name.toLowerCase().replaceAll(' ','-');
 if(actor.status==='escaped')context.globalAlpha=.35;
 drawActorSprite(context,spriteById.get(spriteId),spriteImages.get(spriteId),{position:{x,y},facing:(['up','down','left','right'].includes(actor.facing)?actor.facing:'down') as 'up'|'down'|'left'|'right',movementState:Math.abs(target.x-x)+Math.abs(target.y-y)>2?'walking':'idle'},time,false,size);
 context.globalAlpha=1;
 if(youActor){context.strokeStyle='#f2c86d';context.lineWidth=2;context.beginPath();context.ellipse(x,y+size*.35,size*.36,size*.15,0,0,Math.PI*2);context.stroke();}
 if(youActor||actor.message){context.fillStyle='#1b2b27';context.fillRect(x-size*.44,y-size*.86,size*.88,size*.28);drawPixelText(actor.name.toUpperCase().slice(0,11),x,y-size*.64,Math.max(8,size*.25),'center');}
 context.fillStyle='#301f1d';context.fillRect(x-size*.28,y+size*.42,size*.56,4);context.fillStyle=actor.hp>50?'#82ad62':'#d85c4d';context.fillRect(x-size*.28,y+size*.42,size*.56*(actor.hp/100),4);
 if(actor.message){const bob=Math.sin(time/280)*2;context.fillStyle='#f1dfb8';context.fillRect(x+size*.2,y-size*.92+bob,6,6);drawPixelText('!',x+size*.23,y-size*.76+bob,10,'center');}
}
function renderCanvas(time=performance.now()):void{
 if(!state){requestAnimationFrame(renderCanvas);return;}const map=state.map,size=map.tile_size;
 const viewWidth=20*size,viewHeight=14*size;
 if(canvas.width!==viewWidth||canvas.height!==viewHeight){canvas.width=viewWidth;canvas.height=viewHeight;}
 const focus=state.participants.find(actor=>actor.id===state!.you)||state.participants[0];
 const cameraX=Math.max(0,Math.min(map.width*size-viewWidth,(focus?.position.x||map.width/2)*size-viewWidth/2));
 const cameraY=Math.max(0,Math.min(map.height*size-viewHeight,(focus?.position.y||map.height/2)*size-viewHeight/2));
 context.setTransform(1,0,0,1,0,0);context.imageSmoothingEnabled=false;context.fillStyle=COLORS.outside;context.fillRect(0,0,canvas.width,canvas.height);
 context.translate(-Math.round(cameraX),-Math.round(cameraY));
 for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){const room=roomAt(x,y),base=room?COLORS[room.terrain as keyof typeof COLORS]||COLORS.corridor:COLORS.corridor;context.fillStyle=base;context.fillRect(x*size,y*size,size,size);if((x*17+y*31)%13===0){context.fillStyle='rgba(20,32,28,.13)';context.fillRect(x*size+6,y*size+9,3,2);}}
 for(const wall of map.walls){context.fillStyle=COLORS.wall;context.fillRect(wall.x*size,wall.y*size,size,size);context.fillStyle=COLORS.wallTop;context.fillRect(wall.x*size,wall.y*size,size,5);context.fillStyle='#1b2b27';context.fillRect(wall.x*size,wall.y*size+size-4,size,4);}
 for(const door of map.doors){const p=door.position;context.fillStyle=door.mode==='restricted'?'#9e4e43':COLORS.door;context.fillRect(p.x*size+4,p.y*size+3,size-8,size-6);context.fillStyle='#e9c46a';context.fillRect(p.x*size+size-10,p.y*size+size*.5,3,3);}
 for(const prop of map.props)drawProp(prop,size);
 for(const route of map.escape_routes){const p=route.position;context.fillStyle='#182b26';context.fillRect(p.x*size+3,p.y*size+3,size-6,size-6);context.strokeStyle='#dbb866';context.lineWidth=2;context.strokeRect(p.x*size+7,p.y*size+7,size-14,size-14);}
 for(const item of state.world_items){const p=tileCenter(item.position,size);context.fillStyle=item.type==='keycard'?'#e0c56b':item.type==='medkit'?'#d9685b':item.type==='food'?'#80a85c':'#aeb7aa';context.fillRect(p.x-6,p.y-6,12,12);drawPixelText(item.type.slice(0,1).toUpperCase(),p.x,p.y+4,9,'center');}
 for(const room of map.rooms){const door=map.doors.find(value=>value.room_id===room.id);if(door)drawPixelText(room.label,(door.position.x+.5)*size,(door.position.y-.18)*size,Math.max(8,size*.25),'center');}
 for(const actor of state.participants)drawActor(actor,size,time);
 context.setTransform(1,0,0,1,0,0);requestAnimationFrame(renderCanvas);
}
function nearestOther(own:CompoundParticipant):CompoundParticipant|undefined{return state?.participants.filter(value=>value.id!==own.id&&value.status==='active'&&Math.abs(value.position.x-own.position.x)+Math.abs(value.position.y-own.position.y)<=2).sort((a,b)=>Math.abs(a.position.x-own.position.x)+Math.abs(a.position.y-own.position.y)-Math.abs(b.position.x-own.position.x)-Math.abs(b.position.y-own.position.y))[0];}
function tileDistance(a:Point,b:Point):number{return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);}
function nearestProp(own:CompoundParticipant,kinds:string[]):Prop|undefined{return state?.map.props.filter(value=>kinds.includes(value.kind)&&tileDistance(own.position,value)<=1).sort((a,b)=>tileDistance(own.position,a)-tileDistance(own.position,b))[0];}
function nearbyRoute(own:CompoundParticipant):EscapeRoute|undefined{return state?.map.escape_routes.find(value=>tileDistance(own.position,value.position)<=1);}
function roundClock():string{if(!state?.started_at||!state.ends_at)return'--:--';const duration=state.ends_at-Date.parse(state.started_at),elapsed=Math.max(0,Date.now()-Date.parse(state.started_at));const minutes=6*60+Math.floor(Math.min(1,elapsed/Math.max(1,duration))*16*60);return`${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
function renderPanel():void{
 if(!state)return;statusEl.textContent=state.phase==='active'?`${roundClock()} · ${state.routine.current.toUpperCase()} · ${state.security.toUpperCase()} · ROUND ${state.round}`:state.phase==='finished'?`ROUND ${state.round} FINISHED`:`LOBBY · ${state.participants.length}/8 READY`;
 const result=state.results.at(-1);resultsEl.hidden=!result;resultsEl.replaceChildren();
 if(result){const title=document.createElement('h2');title.textContent=`${(result.session_id||'previous round').replaceAll('-',' ').toUpperCase()} · RESULT`;resultsEl.append(title);const names=new Map((result.participants||[]).map(value=>[value.id,value.name]));const winners=document.createElement('p');winners.textContent=`Winners: ${(result.winner_ids||[]).map(id=>names.get(id)||'Unknown participant').join(', ')||'None'}`;resultsEl.append(winners);const summary=document.createElement('p');summary.textContent=`${result.escaped_ids?.length||0} escaped · ${Math.max(0,Math.round((result.duration_ms||0)/1000))} seconds · ${(result.reason||'completed').replaceAll('_',' ')}`;resultsEl.append(summary);}
 lobby.replaceChildren();if(!state.you){lobby.append(document.createTextNode(state.phase==='active'?'Round in progress. Watch now and join the next one.':'Join the shared public round. Empty slots become autonomous players.'));if(state.phase!=='active')lobby.append(button('Join as human',()=>void join(),'primary'));}else if(state.phase==='lobby'){lobby.append(document.createTextNode('You are in. Start the round and agents will fill the open slots.'));lobby.append(button('Start round',()=>void command('/api/compound/start'),'primary'));}else if(state.phase==='active')lobby.append(document.createTextNode('WASD / arrows move. E picks up. Use nearby actions below.'));else{lobby.append(document.createTextNode('The round resolved. Results and evidence are retained.'));lobby.append(button('Start next round',()=>void command('/api/compound/start'),'primary'));}
 you.replaceChildren();const own=state.participants.find(value=>value.id===state!.you);if(own){
  const title=document.createElement('h2');title.textContent=`${own.name} · ${(own.role||own.public_role).toUpperCase()}`;you.append(title);
  const details=document.createElement('p');details.textContent=`HP ${own.hp} · STAMINA ${own.stamina} · HEAT ${own.heat} · CREDITS ${own.credits||0} · ${own.room.replaceAll('-',' ')}`;you.append(details);
  const stats=document.createElement('p');stats.textContent=`STR ${own.stats?.strength||1} · FIT ${own.stats?.fitness||1} · INT ${own.stats?.intellect||1} · JOB ${(own.job||'none').replaceAll('_',' ')}`;you.append(stats);
  const objective=document.createElement('p');objective.className='compound-objective';objective.textContent=`OBJECTIVE · ${own.objective}`;you.append(objective);
  const inv=document.createElement('div');inv.className='compound-inventory';for(let slot=0;slot<6;slot++){const item=own.inventory?.[slot],chip=document.createElement('button');chip.textContent=item||'empty';chip.disabled=!item;if(item)chip.onclick=()=>void command('/api/compound/action',{action:['food','medicine','field_dressing','energy_ration'].includes(item)?'use':'drop',item});inv.append(chip);}you.append(inv);
  const target=nearestOther(own),container=nearestProp(own,['locker','cabinet','crate','guard_desk','counter','workbench']),training=nearestProp(own,['weights','treadmill','terminal']),route=nearbyRoute(own),actions=document.createElement('div');actions.className='compound-action-row';
  if(state.world_items.some(item=>tileDistance(item.position,own.position)<=1))actions.append(button('Pick up [E]',()=>void command('/api/compound/action',{action:'pickup'})));
  if(container)actions.append(button(`Search ${container.kind} [E]`,()=>void command('/api/compound/action',{action:'search',container_id:container.id})));
  actions.append(button(`Work: ${(own.job||'job').replaceAll('_',' ')}`,()=>void command('/api/compound/action',{action:'work'})));
  if(training){const stat=training.kind==='weights'?'strength':training.kind==='treadmill'?'fitness':'intellect';actions.append(button(`Train ${stat}`,()=>void command('/api/compound/action',{action:'train',stat})));}
  for(const recipe of own.crafting?.filter(value=>value.available)||[])actions.append(button(`Craft ${recipe.label}`,()=>void command('/api/compound/action',{action:'craft',recipe_id:recipe.id})));
  if(target){actions.append(button(`Talk: ${target.name}`,()=>void command('/api/compound/action',{action:'talk',target_id:target.id})),button(`Give item: ${target.name}`,()=>void command('/api/compound/action',{action:'trade',target_id:target.id,item:own.inventory?.[0]})),button('Attack',()=>void command('/api/compound/action',{action:'attack',target_id:target.id})));}
  if(own.role!=='guard'&&route){const progress=own.escape_progress?.[route.id]||0;actions.append(button(route.stages[progress]?.label||route.label,()=>void command('/api/compound/action',{action:'escape',route_id:route.id})));}
  if(state.phase==='active')you.append(actions);
 }
 participants.replaceChildren();for(const actor of state.participants){const row=document.createElement('div');row.className='compound-participant';const name=document.createElement('span');name.textContent=`${actor.name}${actor.id===state.you?' · YOU':''}`;const info=document.createElement('small');info.textContent=`${actor.public_role.toUpperCase()} · ${actor.activity} · ${state.phase==='finished'&&actor.status==='active'?'completed':actor.status}`;row.append(name,info);participants.append(row);}
 events.replaceChildren();for(const event of state.events.slice(-12).reverse()){const item=document.createElement('li');item.textContent=event.message;events.append(item);}hint.textContent=errorText||`E interact · next: ${state.routine.next} · server validates every step`;
}
function applySnapshot(next:CompoundSnapshot):void{if(next.revision!==lastRevision){for(const actor of state?.participants||[])previousPositions.set(actor.id,tileCenter(actor.position,next.map.tile_size));state=next;lastRevision=next.revision;renderPanel();}}
async function refresh():Promise<void>{try{applySnapshot(await request<CompoundSnapshot>('/api/compound'));errorText='';}catch(error){errorText=error instanceof Error?error.message:'Compound unavailable';hint.textContent=errorText;}}
async function command(url:string,data:Record<string,unknown>={}):Promise<void>{busy=true;try{applySnapshot(await request<CompoundSnapshot>(url,{method:'POST',body:JSON.stringify(data)}));errorText='';}catch(error){errorText=error instanceof Error?error.message:'Action rejected';hint.textContent=errorText;}finally{busy=false;}}
async function join():Promise<void>{const name=window.prompt('Choose a public compound name','Visitor');if(name)await command('/api/compound/join',{name,avatar:loadSettings().avatar});}
async function move(dx:number,dy:number):Promise<void>{if(!state?.you||busy)return;const own=state.participants.find(value=>value.id===state!.you);if(!own||state.phase!=='active')return;await command('/api/compound/move',{x:own.position.x+dx,y:own.position.y+dy});}
async function interact():Promise<void>{if(!state?.you||busy)return;const own=state.participants.find(value=>value.id===state!.you);if(!own||state.phase!=='active')return;if(state.world_items.some(item=>tileDistance(item.position,own.position)<=1))return command('/api/compound/action',{action:'pickup'});const container=nearestProp(own,['locker','cabinet','crate','guard_desk','counter','workbench']);if(container)return command('/api/compound/action',{action:'search',container_id:container.id});const training=nearestProp(own,['weights','treadmill','terminal']);if(training)return command('/api/compound/action',{action:'train',stat:training.kind==='weights'?'strength':training.kind==='treadmill'?'fitness':'intellect'});return command('/api/compound/action',{action:'work'});}
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(control=>control.onclick=()=>{const direction=control.dataset.move;void move(direction==='left'?-1:direction==='right'?1:0,direction==='up'?-1:direction==='down'?1:0);});
window.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA'].includes((event.target as HTMLElement).tagName))return;const key=event.key.toLowerCase();if(key==='e'){event.preventDefault();void interact();return;}const delta=key==='w'||key==='arrowup'?[0,-1]:key==='s'||key==='arrowdown'?[0,1]:key==='a'||key==='arrowleft'?[-1,0]:key==='d'||key==='arrowright'?[1,0]:null;if(delta){event.preventDefault();void move(delta[0]||0,delta[1]||0);}});
await refresh();requestAnimationFrame(renderCanvas);setInterval(()=>void refresh(),750);
export {};
