import { KeyboardInput, TouchJoystickInput } from './input.js';
import { CanvasWorldRenderer } from './renderer.js';
import { moveActor, followCamera, presenceObstacles } from './movement.js';
import { MAP, LANDMARKS, WALLS, safePosition } from './map.js';
import { nearestInteraction, normalizeInput, type WorldActor, type WorldEvent, type Interactable } from './model.js';
import { AVATARS, SPRITES, loadSettings, saveSettings } from './sprites.js';
import { NpcController, npcSpawnPosition } from './npc.js';
import { HttpArenaGateway, type AgentProfile } from './gateway.js';
import { mountTable } from './table.js';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('world-canvas'),dialog=$<HTMLDialogElement>('interaction-dialog'),character=$<HTMLDialogElement>('character-dialog');
const content=$('interaction-content'),hint=$('world-hint'),connection=$('connection');
const settings=loadSettings(),gateway=new HttpArenaGateway();
const player:WorldActor={id:'visitor',type:'human',name:'You',position:settings.position,facing:'down',movementState:'idle',spriteId:settings.avatar,activity:'Exploring',recentWinner:false};
const renderer=new CanvasWorldRenderer(canvas),keyboard=new KeyboardInput(canvas),touch=new TouchJoystickInput($('joystick'),$('joystick-knob'),$<HTMLButtonElement>('interact'));
const npcs:WorldActor[]=[],controllers=new Map<string,NpcController>();let profiles:AgentProfile[]=[];
let camera={x:Math.max(0,player.position.x-renderer.viewport().width/2),y:Math.max(0,player.position.y-renderer.viewport().height/2)};
let requestedAgent=new URLSearchParams(location.search).get('agent');
let nearby:Interactable|undefined,entered=false,stopped=false,raf=0,previous=performance.now(),lastSave=0,lastMoveEvent=0;
let restoreWorldFocus=false;
const events:WorldEvent[]=[];
let interactionVersion=0;
function emit(event:WorldEvent):void {events.push(event);if(events.length>20)events.shift();}
function persist():void {saveSettings({...settings,avatar:player.spriteId,position:player.position});}
function resetInput():void {keyboard.reset();touch.reset();}
function show(title:string):number {resetInput();$('interaction-title').textContent=title;content.replaceChildren();if(!dialog.open)dialog.showModal();return ++interactionVersion;}
function text(tag:string,value:string,parent:HTMLElement=content):HTMLElement {const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
function link(label:string,url:string,parent:HTMLElement=content):void {const a=document.createElement('a');a.textContent=label;a.href=url;a.className='button';parent.append(a);}
function showProfile(id:string):void {
  const profile=profiles.find(a=>a.id===id);if(!profile)return;
  show(profile.name);const head=text('div','');head.className='agent-profile-head';
  const image=document.createElement('img');image.src='/'+profile.sprite;image.alt=profile.name;head.append(image);text('p',profile.strategy,head);
  const stats=text('div','');stats.className='profile-stats';
  for(const [label,value] of [['Matches',profile.matches],['Wins',profile.wins],['Draws',profile.draws]]){const box=text('div','',stats);text('strong',String(value),box);text('span',String(label),box);}
  text('p',`Statistics from ${profile.scope}. ${profile.recentWinner?'Crown: latest retained match was a win.':''}`);
  text('p',`World activity: ${npcs.find(a=>a.agentId===id)?.activity||'At the plaza'}.`);
  text('h3','Recorded observations');
  for(const memory of profile.memory.slice().reverse()){
    const row=text('div',`${memory.game.toUpperCase()} · ${memory.matchId}`);row.className='memory-row';
    text('p',`${profiles.find(a=>a.id===memory.opponent)?.name||memory.opponent}: ${memory.observed}. Played ${memory.move}.`,row);
    link('Download verified run',`/api/arena/logs/${memory.runId}`,row);
  }
  if(!profile.memory.length)text('p','No completed arena matches recorded yet. Watch a room to begin the story.');
  const actions=text('div','');actions.className='profile-actions';link('View all agents','/arena#agents',actions);
  if(profile.roomId)link('Watch current match',`/arena/${profile.roomId.startsWith('rps')?'rps':'tictactoe'}/${profile.roomId}`,actions);
}
async function showArchive():Promise<void> {
  const version=show('Research archive');text('p','Loading verified match history…');
  try{
    const matches=await gateway.history();if(!dialog.open||version!==interactionVersion)return;content.replaceChildren();
    text('p','Completed server matches only. Downloads include the replayable simulation ledger. Older epochs rotate after the retained window.');
    if(!matches.length)text('p','No completed matches yet. Visit the Arena and come back shortly.');
    for(const match of matches.slice(0,20)){
      const row=text('article',`${match.game.toUpperCase()} · ${match.id} · ${match.players.map(a=>a.name).join(' vs ')}`);row.className='archive-row';
      text('p',match.result==='draw'?'Draw':`Winner: ${match.players[match.result==='a'?0:1]!.name}`,row);
      link('Watch this room',`/arena/${match.game}/${match.roomId}`,row);link('Download JSON',match.logUrl,row);
      const details=text('details','',row);text('summary','Structured move history',details);text('pre',JSON.stringify(match.moves,null,2),details);
    }
  }catch{if(dialog.open&&version===interactionVersion){content.replaceChildren();text('p','The archive is unavailable. Close this panel and try again.');}}
}
function portal():void {
  persist();resetInput();emit({type:'world:entered-arena',actorId:player.id});document.body.classList.add('leaving');
  setTimeout(()=>location.assign('/arena'),matchMedia('(prefers-reduced-motion: reduce)').matches?0:220);
}
async function interact(target:Interactable|undefined=nearby):Promise<void> {
  if(!target||dialog.open||character.open)return;
  emit({type:'world:actor-interacted',actorId:player.id,targetId:target.id});
  if(target.type==='arena')portal();else if(target.type==='agent')showProfile(target.id);else if(target.type==='research')await showArchive();
  else {const version=show('Free Tic-Tac-Toe table');mountTable(content,()=>dialog.open&&interactionVersion===version);}
}
function presetButtons():void {
  const presets=$('avatar-presets');
  for(const id of AVATARS){
    let button=presets.querySelector<HTMLButtonElement>(`[data-avatar="${id}"]`);
    if(!button){
      button=document.createElement('button');button.type='button';button.dataset.avatar=id;
      const image=document.createElement('img');const sprite=SPRITES.find(s=>s.id===id)!;image.src=sprite.preview||sprite.sheet;image.alt='';button.append(image,document.createTextNode(id.replace('visitor_','').toUpperCase()));
      button.onclick=()=>{player.spriteId=id;presetButtons();persist();};presets.append(button);
    }
    button.setAttribute('aria-pressed',String(player.spriteId===id));
  }
}
$('avatar-change').onclick=()=>{resetInput();presetButtons();character.showModal();};
$('character-close').onclick=()=>{if(entered)character.close();else $('enter-world').click();};
$('enter-world').onclick=()=>{entered=true;restoreWorldFocus=true;persist();try{sessionStorage.setItem('agent-world-entered','1');}catch{}character.close();canvas.focus();};
character.addEventListener('cancel',event=>{if(!entered)event.preventDefault();});
$('interaction-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{
  resetInput();
  requestAnimationFrame(()=>{
    const active=document.activeElement;
    if(!dialog.open&&(active===document.body||active===document.documentElement||dialog.contains(active)))canvas.focus();
  });
});
character.addEventListener('close',()=>{
  resetInput();
  requestAnimationFrame(()=>{
    if(!character.open&&(restoreWorldFocus||document.activeElement===document.body))canvas.focus();
    restoreWorldFocus=false;
  });
});
canvas.addEventListener('pointerdown',event=>{
  canvas.focus();if(dialog.open||character.open)return;
  const rect=canvas.getBoundingClientRect(),view=renderer.viewport();
  const point={x:camera.x+(event.clientX-rect.left)*view.width/rect.width,y:camera.y+(event.clientY-rect.top)*view.height/rect.height};
  const actor=npcs.find(a=>Math.hypot(point.x-a.position.x,point.y-a.position.y)<30);
  if(actor&&Math.hypot(player.position.x-actor.position.x,player.position.y-actor.position.y)<=72)void interact({id:actor.agentId!,type:'agent',position:actor.position,radius:72,label:`Inspect ${actor.name}`});
});
function addNpc(profile:AgentProfile,index:number):void {
  const sprite=SPRITES.find(s=>s.sheet==='/'+profile.sprite);
  npcs.push({id:'npc-'+profile.id,type:'npc',agentId:profile.id,name:profile.name,position:npcSpawnPosition(index),facing:'down',movementState:'idle',spriteId:sprite?.id||'founder',activity:'Walking through the plaza',recentWinner:profile.recentWinner});
  controllers.set('npc-'+profile.id,new NpcController(index));
  canvas.setAttribute('aria-label',`Agent town with ${npcs.length} agents in the plaza. Use WASD or arrow keys to move, E to interact. Arena is southeast; free table southwest; research archive south.`);
}
async function refreshProfiles():Promise<void> {
  if(stopped)return;
  try{
    profiles=await gateway.getAgentProfiles();if(!npcs.length)profiles.forEach(addNpc);
    for(const npc of npcs)npc.recentWinner=profiles.find(a=>a.id===npc.agentId)?.recentWinner||false;
    connection.textContent='ARENA ONLINE · SIMULATION';
    const directory=$('agent-directory'),current=new Set<string>();
    for(const profile of profiles){
      const id='directory-agent-'+profile.id;current.add(id);
      let b=document.getElementById(id) as HTMLButtonElement|null;
      if(!b){b=document.createElement('button');b.id=id;b.onclick=()=>showProfile(profile.id);directory.append(b);}
      b.textContent=profile.name;
    }
    for(const b of directory.querySelectorAll<HTMLButtonElement>('button'))if(!current.has(b.id))b.remove();
    if(requestedAgent&&entered){showProfile(requestedAgent);requestedAgent=null;}
  }catch{connection.textContent='ARENA OFFLINE · retrying';}
  if(!stopped)setTimeout(refreshProfiles,5000);
}
function frame(time:number):void {
  const dt=Math.min(.1,(time-previous)/1000);previous=time;
  const k=keyboard.read(),t=touch.read();
  if(entered&&!dialog.open&&!character.open&&!document.hidden){
    const input=normalizeInput(k.x+t.x,k.y+t.y,k.interact||t.interact);
    moveActor(player,input,dt,150,[...WALLS,...presenceObstacles(npcs,player)]);
    for(const npc of npcs)controllers.get(npc.id)?.update(npc,dt,[player,...npcs]);
    const targets=[...LANDMARKS,...npcs.map(a=>({id:a.agentId!,position:a.position,radius:72,type:'agent' as const,label:`Inspect ${a.name}`}))];
    nearby=nearestInteraction(player.position,targets);
    if(input.interact)void interact();
    if(player.movementState==='walking'&&time-lastMoveEvent>500){emit({type:'world:actor-moved',actorId:player.id,position:{...player.position}});lastMoveEvent=time;}
    if(time-lastSave>3000){persist();lastSave=time;}
  }else{resetInput();player.movementState='idle';}
  const message=nearby?`E / Interact · ${nearby.label}`:'WASD / arrows to walk · E to interact';
  if(hint.textContent!==message)hint.textContent=message;
  $<HTMLButtonElement>('interact').disabled=!nearby;
  camera=followCamera(camera,player.position,renderer.viewport().width,renderer.viewport().height,dt);
  renderer.render({actors:[player,...npcs],camera,nearby,time});raf=requestAnimationFrame(frame);
}
window.addEventListener('pagehide',()=>{stopped=true;persist();cancelAnimationFrame(raf);keyboard.destroy();touch.destroy();renderer.destroy();});
// The lab uses the production state and controller; no second renderer or game engine.
if(location.pathname==='/labs/world'){
  const lab=$('world-lab');lab.hidden=false;
  for(const landmark of LANDMARKS){const b=document.createElement('button');b.textContent='Teleport: '+landmark.label;b.onclick=()=>{player.position=safePosition(landmark.position);canvas.focus();};lab.append(b);}
  const spawn=document.createElement('button');spawn.textContent='Spawn next NPC';spawn.onclick=()=>{const profile=profiles.find(p=>!npcs.some(n=>n.agentId===p.id));if(profile)addNpc(profile,npcs.length);};lab.append(spawn);
  const badge=document.createElement('button');badge.textContent='Toggle preview crown';badge.onclick=()=>{if(npcs[0])npcs[0].recentWinner=!npcs[0].recentWinner;};lab.append(badge);
  const log=document.createElement('pre');lab.append(log);setInterval(()=>log.textContent=JSON.stringify({player:{...player.position,movementState:player.movementState,facing:player.facing},entered,interactionOpen:dialog.open,characterOpen:character.open,hidden:document.hidden,npcs:npcs.map(actor=>({id:actor.id,position:{...actor.position},movementState:actor.movementState})),events},null,2),1000);
}
presetButtons();try{entered=sessionStorage.getItem('agent-world-entered')==='1';}catch{}
if(!entered)character.showModal();else canvas.focus();void refreshProfiles();raf=requestAnimationFrame(frame);
