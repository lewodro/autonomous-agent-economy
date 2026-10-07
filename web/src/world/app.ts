import { KeyboardInput, TouchJoystickInput } from './input.js';
import { CanvasWorldRenderer } from './renderer.js';
import { moveActor, followCamera } from './movement.js';
import { MAP, LANDMARKS, WALLS, safePosition } from './map.js';
import { nearestInteraction, normalizeInput, type WorldActor, type WorldEvent, type Interactable } from './model.js';
import { AVATARS, SPRITES, loadSettings, saveSettings } from './sprites.js';
import { NpcController, npcSpawnPosition, arenaExitPosition, selectPlazaAgents } from './npc.js';
import { HttpArenaGateway, type AgentProfile } from './gateway.js';
import { mountTable } from './table.js';
import { WorldPresenceClient, type PresencePlayer, type PresenceSnapshot } from './presence-client.js';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('world-canvas'),dialog=$<HTMLDialogElement>('interaction-dialog'),character=$<HTMLDialogElement>('character-dialog');
const content=$('interaction-content'),hint=$('world-hint'),connection=$('connection');
const settings=loadSettings(),gateway=new HttpArenaGateway();
const player:WorldActor={id:'visitor',type:'human',name:'You',position:settings.position,facing:'down',movementState:'idle',spriteId:settings.avatar,activity:'Exploring',recentWinner:false};
const renderer=new CanvasWorldRenderer(canvas),keyboard=new KeyboardInput(canvas),touch=new TouchJoystickInput($('joystick'),$('joystick-knob'),$<HTMLButtonElement>('interact'));
const npcs:WorldActor[]=[],controllers=new Map<string,NpcController>();let profiles:AgentProfile[]=[];
const remotePlayers=new Map<string,{actor:WorldActor;target:{x:number;y:number}}>();
let presenceClient:WorldPresenceClient|undefined,presenceState:'idle'|'connecting'|'connected'|'reconnecting'|'closed'='idle';
let presenceHeartbeat=0,presenceReconnect=0,presenceConnecting=false,lastPresenceMoveAt=0,lastPresenceMoveState='';
let arenaOnline=false;
let camera={x:Math.max(0,player.position.x-renderer.viewport().width/2),y:Math.max(0,player.position.y-renderer.viewport().height/2)};
let requestedAgent=new URLSearchParams(location.search).get('agent');
let nearby:Interactable|undefined,entered=false,stopped=false,raf=0,previous=performance.now(),lastSave=0,lastMoveEvent=0;
let restoreWorldFocus=false;
const events:WorldEvent[]=[];
let interactionVersion=0;
function emit(event:WorldEvent):void {events.push(event);if(events.length>20)events.shift();}
function persist():void {saveSettings({...settings,avatar:player.spriteId,position:player.position});}
function updateWorldLabel():void {
  const others=remotePlayers.size,visitorLabel=others===1?'other visitor':'other visitors';
  canvas.setAttribute('aria-label',`Agent town with ${npcs.length} visiting agents in the plaza and ${others} ${visitorLabel} online. Agents fighting are inside the Arena. Use WASD or arrow keys to move, E to interact. Free table southwest; arena statistics south.`);
}
function updateConnectionLabel():void {
  updateWorldLabel();
  if(!entered){connection.textContent=arenaOnline?'ARENA ONLINE · SIMULATION':'ARENA OFFLINE · retrying';return;}
  const presenceText=presenceState==='connected'?'ONLINE':presenceState==='reconnecting'?'RECONNECTING':presenceState==='closed'?'OFFLINE':'CONNECTING';
  connection.textContent=`WORLD ${presenceText} · ${remotePlayers.size+1} HERE${arenaOnline?'':' · ARENA DATA OFFLINE'}`;
}
function syncRemotePlayers(snapshot:PresenceSnapshot):void {
  const next=new Set<string>(),ownId=presenceClient?.player_id;
  for(const value of snapshot.players){
    if(value.player_id===ownId)continue;
    const id=`presence:${value.player_id}`;next.add(id);
    const facing=value.direction==='up'||value.direction==='left'||value.direction==='right'?value.direction:'down';
    const spriteId=AVATARS.includes(value.avatar)?value.avatar:'visitor_ember';
    const current=remotePlayers.get(id);
    if(current){
      current.actor.name=`Visitor ${value.player_id.slice(-4).toUpperCase()}`;current.actor.spriteId=spriteId;
      current.actor.facing=facing;current.actor.movementState=value.animation_state==='walk'?'walking':'idle';current.actor.activity=value.activity;
      current.target={...value.position};
    }else{
      remotePlayers.set(id,{target:{...value.position},actor:{id,type:'human',name:`Visitor ${value.player_id.slice(-4).toUpperCase()}`,
        position:{...value.position},facing,movementState:value.animation_state==='walk'?'walking':'idle',spriteId,activity:value.activity,recentWinner:false}});
    }
  }
  for(const id of remotePlayers.keys())if(!next.has(id))remotePlayers.delete(id);
  updateConnectionLabel();
}
function presenceError(client:WorldPresenceClient):void {
  if(stopped||presenceClient!==client)return;
  presenceState='reconnecting';updateConnectionLabel();
  if(presenceReconnect)return;
  presenceReconnect=window.setTimeout(()=>{presenceReconnect=0;connectPresence(client);},1_000);
}
function connectPresence(client:WorldPresenceClient):void {
  if(stopped||presenceClient!==client||presenceConnecting)return;
  presenceConnecting=true;presenceState='connecting';updateConnectionLabel();
  void client.connect().then(()=>{lastPresenceMoveState=`${player.position.x},${player.position.y},${player.facing},${player.movementState}`;})
    .catch(()=>presenceError(client)).finally(()=>{presenceConnecting=false;});
}
function startPresence():void {
  if(!entered||stopped||presenceClient)return;
  let client:WorldPresenceClient;
  client=new WorldPresenceClient({avatar:player.spriteId,position:{...player.position},direction:player.facing,activity:player.activity,
    onPlayers:syncRemotePlayers,onConnection:state=>{
      if(presenceClient!==client)return;
      presenceState=state==='closed'?'closed':state;updateConnectionLabel();
    }});
  presenceClient=client;connectPresence(client);
  presenceHeartbeat=window.setInterval(()=>{
    if(presenceClient!==client)return;
    void client.heartbeat(player.activity).catch(()=>presenceError(client));
  },1_000);
}
async function leavePresence():Promise<void> {
  const client=presenceClient;if(!client)return;
  presenceClient=undefined;presenceState='closed';
  if(presenceHeartbeat)window.clearInterval(presenceHeartbeat);presenceHeartbeat=0;
  if(presenceReconnect)window.clearTimeout(presenceReconnect);presenceReconnect=0;
  remotePlayers.clear();updateConnectionLabel();
  try{await client.leave();}catch{client.close();}
}
function resetInput():void {keyboard.reset();touch.reset();}
function show(title:string):number {resetInput();$('interaction-title').textContent=title;content.replaceChildren();if(!dialog.open)dialog.showModal();return ++interactionVersion;}
function text(tag:string,value:string,parent:HTMLElement=content):HTMLElement {const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
function link(label:string,url:string,parent:HTMLElement=content):void {const a=document.createElement('a');a.textContent=label;a.href=url;a.className='button';parent.append(a);}
function showProfile(id:string):void {
  const profile=profiles.find(a=>a.id===id);if(!profile)return;
  show(profile.name);const head=text('div','');head.className='agent-profile-head';
  const image=document.createElement('img');image.src='/'+profile.sprite;image.alt=profile.name;head.append(image);text('p',profile.strategy,head);
  if(profile.ownership_status==='user')text('p',`Community-owned agent${profile.owner_wallet?` · ${profile.owner_wallet}`:''}. User-created agents are free to inspect; this does not grant spending access.`);
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
async function showResearch():Promise<void> {
  const version=show('Arena research');text('p','Loading verified arena statistics…');
  try{
    const [stats,matches]=await Promise.all([gateway.statistics(),gateway.history()]);
    if(!dialog.open||version!==interactionVersion)return;content.replaceChildren();
    text('p',`Live totals from ${stats.scope}. ${stats.updated_at?`Last completed match: ${new Date(stats.updated_at).toLocaleString()}.`:'No completed matches recorded yet.'}`);
    const totals=text('div','');totals.className='research-totals';
    for(const [label,value] of [['Completed matches',stats.totals.matches],['Recorded decisions',stats.totals.decisions],['Draws',stats.totals.draws]] as [string,number][]){
      const item=text('article','',totals);text('strong',String(value),item);text('span',label,item);
    }
    text('h3','Games recorded');
    for(const [game,label] of [['rps','Rock Paper Scissors'],['tictactoe','Tic-Tac-Toe']] as const){
      const summary=stats.games[game];const row=text('p',`${label} · ${summary.matches} matches · ${summary.decisions} decisions · ${summary.draws} draws`);row.className='research-game';
    }
    text('p','Counts persist as old runs leave the replay window. Match logs remain bounded; matches discarded before cumulative rollups were added cannot be reconstructed.');
    text('h3','Agent standings · cumulative runs');
    if(!stats.agents.length)text('p','No completed matches yet. Visit the Arena and return after the first result.');
    for(const [index,agent] of stats.agents.slice(0,10).entries()){
      const row=text('article',`${String(index+1).padStart(2,'0')} · ${agent.name}`);row.className='research-agent';
      text('p',`${agent.wins} wins · ${agent.matches} matches · ${agent.win_rate}% win rate · ${agent.strategy}`,row);
      link('Inspect agent in the world',`/world?agent=${encodeURIComponent(agent.id)}`,row);
    }
    text('h3','Latest verified results');
    for(const match of matches.slice(0,6)){
      const row=text('article',`${match.game.toUpperCase()} · ${match.players.map(a=>a.name).join(' vs ')}`);row.className='archive-row';
      text('p',match.result==='draw'?'Draw':`Winner: ${match.players[match.result==='a'?0:1]!.name}`,row);
      link('Watch room',`/arena/${match.game}/${match.roomId}`,row);link('Download run',match.logUrl,row);
    }
  }catch{if(dialog.open&&version===interactionVersion){content.replaceChildren();text('p','Arena statistics are temporarily unavailable. Close this panel and try again.');}}
}
function portal():void {
  persist();resetInput();void leavePresence();emit({type:'world:entered-arena',actorId:player.id});document.body.classList.add('leaving');
  setTimeout(()=>location.assign('/arena'),matchMedia('(prefers-reduced-motion: reduce)').matches?0:220);
}
async function interact(target:Interactable|undefined=nearby):Promise<void> {
  if(!target||dialog.open||character.open)return;
  emit({type:'world:actor-interacted',actorId:player.id,targetId:target.id});
  if(target.type==='arena')portal();else if(target.type==='agent')showProfile(target.id);else if(target.type==='research')await showResearch();
  else {const version=show('Free Tic-Tac-Toe table');mountTable(content,()=>dialog.open&&interactionVersion===version);}
}
interface AvatarAsset {id:string;name:string;sheet:string;preview:string;frameWidth:number;frameHeight:number;columns:number;rows:number;approved:boolean;placeholder?:boolean;debug?:boolean}
let approvedAvatarAssets:AvatarAsset[]|null=null;
async function transparentImage(url:string,width:number,height:number):Promise<boolean>{
  const image=new Image();image.src=url;await image.decode();
  if(image.naturalWidth!==width||image.naturalHeight!==height)return false;
  const sample=document.createElement('canvas');sample.width=width;sample.height=height;
  const context=sample.getContext('2d',{willReadFrequently:true});if(!context)return false;
  context.drawImage(image,0,0);const pixels=context.getImageData(0,0,width,height).data;
  let transparent=0,visible=0;
  for(let alpha=3;alpha<pixels.length;alpha+=4){if(pixels[alpha]===0)transparent++;else visible++;}
  return visible>0&&transparent/(width*height)>=0.01;
}
async function avatarCatalog():Promise<AvatarAsset[]> {
  if(approvedAvatarAssets)return approvedAvatarAssets;
  const response=await fetch('/assets/avatars/index.json',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Avatar catalog unavailable');
  const catalog=await response.json() as {version?:number;avatars?:AvatarAsset[]};
  if(catalog.version!==1||!Array.isArray(catalog.avatars))throw new Error('Avatar catalog invalid');
  const eligible=catalog.avatars.filter(asset=>asset.approved===true&&asset.placeholder!==true&&asset.debug!==true
    &&!/(placeholder|debug|invalid)/i.test(asset.id)&&AVATARS.includes(asset.id)
    &&SPRITES.some(sprite=>sprite.id===asset.id&&sprite.selectable===true&&sprite.sheet===asset.sheet&&sprite.preview===asset.preview
      &&sprite.frameWidth===asset.frameWidth&&sprite.frameHeight===asset.frameHeight));
  const checked:AvatarAsset[]=[];
  for(const asset of eligible){
    try{
      const sheetOk=await transparentImage(asset.sheet,asset.frameWidth*asset.columns,asset.frameHeight*asset.rows);
      const previewOk=await transparentImage(asset.preview,256,256);
      if(sheetOk&&previewOk)checked.push(asset);
    }catch{/* Broken previews stay out of the character picker. */}
  }
  approvedAvatarAssets=checked;return checked;
}
async function presetButtons():Promise<void> {
  const presets=$('avatar-presets');
  let assets:AvatarAsset[];
  try{assets=await avatarCatalog();}catch{assets=[];}
  const valid=new Set(assets.map(asset=>asset.id));
  for(const button of presets.querySelectorAll<HTMLButtonElement>('button'))if(!valid.has(button.dataset.avatar||''))button.remove();
  for(const asset of assets){
    const {id,name,preview}=asset;
    let button=presets.querySelector<HTMLButtonElement>(`[data-avatar="${id}"]`);
    if(!button){
      button=document.createElement('button');button.type='button';button.dataset.avatar=id;
      const image=document.createElement('img');image.src=preview;image.alt='';button.append(image,document.createTextNode(name.toUpperCase()));
      button.onclick=()=>{player.spriteId=id;presetButtons();persist();if(presenceClient)void presenceClient.updateAvatar(id).catch(()=>presenceClient&&presenceError(presenceClient));};presets.append(button);
    }
    button.setAttribute('aria-pressed',String(player.spriteId===id));
  }
}
$('avatar-change').onclick=()=>{resetInput();void presetButtons().then(()=>character.showModal());};
$('character-close').onclick=()=>{if(entered)character.close();else $('enter-world').click();};
$('enter-world').onclick=()=>{entered=true;restoreWorldFocus=true;persist();try{sessionStorage.setItem('agent-world-entered','1');}catch{}character.close();canvas.focus();startPresence();};
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
function addNpc(profile:AgentProfile,index:number,returningFromArena=false):void {
  const sprite=SPRITES.find(s=>s.sheet==='/'+profile.sprite);
  npcs.push({id:'npc-'+profile.id,type:'npc',agentId:profile.id,name:profile.name,position:returningFromArena?arenaExitPosition(index):npcSpawnPosition(index),facing:'down',movementState:'idle',spriteId:sprite?.id||'founder',activity:returningFromArena?'Leaving the Arena · match complete':'Walking through the plaza',recentWinner:profile.recentWinner});
  controllers.set('npc-'+profile.id,new NpcController(index,returningFromArena));
  updateWorldLabel();
}
async function refreshProfiles():Promise<void> {
  if(stopped)return;
  try{
    profiles=await gateway.getAgentProfiles();
    const selected=selectPlazaAgents(profiles,npcs.map(npc=>npc.agentId||'')),selectedIds=new Set(selected.map(profile=>profile.id));
    for(let index=npcs.length-1;index>=0;index--)if(!selectedIds.has(npcs[index]!.agentId||'')){controllers.delete(npcs[index]!.id);npcs.splice(index,1);}
    selected.forEach((profile,index)=>{
      const existing=npcs.find(npc=>npc.agentId===profile.id);
      if(!existing)addNpc(profile,index,profile.arenaStatus==='finished');
      else{existing.recentWinner=profile.recentWinner;if(profile.arenaStatus==='finished'&&existing.movementState==='idle')existing.activity='Back in the plaza · match complete';}
    });
    updateWorldLabel();
    arenaOnline=true;updateConnectionLabel();
    const directory=$('agent-directory'),current=new Set<string>();
    for(const profile of profiles){
      const id='directory-agent-'+profile.id;current.add(id);
      let b=document.getElementById(id) as HTMLButtonElement|null;
      if(!b){b=document.createElement('button');b.id=id;b.onclick=()=>showProfile(profile.id);directory.append(b);}
      b.textContent=`${profile.name} · ${profile.arenaStatus==='owned'?'OWNED · PLAZA':profile.arenaStatus.toUpperCase()}${profile.roomId?` · ${profile.roomId.toUpperCase()}`:''}`;
    }
    for(const b of directory.querySelectorAll<HTMLButtonElement>('button'))if(!current.has(b.id))b.remove();
    if(requestedAgent&&entered){showProfile(requestedAgent);requestedAgent=null;}
  }catch{arenaOnline=false;updateConnectionLabel();}
  if(!stopped)setTimeout(refreshProfiles,5000);
}
function frame(time:number):void {
  const dt=Math.min(.1,(time-previous)/1000);previous=time;
  const k=keyboard.read(),t=touch.read();
  if(entered&&!dialog.open&&!character.open&&!document.hidden){
    const input=normalizeInput(k.x+t.x,k.y+t.y,k.interact||t.interact);
    // Ambient agents remain inspectable, but cannot form a moving wall across the visitor's route.
    moveActor(player,input,dt,150,WALLS);
    for(const npc of npcs)controllers.get(npc.id)?.update(npc,dt,[player,...npcs]);
    const targets=[...LANDMARKS,...npcs.map(a=>({id:a.agentId!,position:a.position,radius:72,type:'agent' as const,label:`Inspect ${a.name}`}))];
    nearby=nearestInteraction(player.position,targets);
    if(input.interact)void interact();
    if(player.movementState==='walking'&&time-lastMoveEvent>500){emit({type:'world:actor-moved',actorId:player.id,position:{...player.position}});lastMoveEvent=time;}
    if(time-lastSave>3000){persist();lastSave=time;}
  }else{resetInput();player.movementState='idle';}
  if(entered&&presenceClient&&time-lastPresenceMoveAt>=80){
    const state=`${player.position.x},${player.position.y},${player.facing},${player.movementState}`;
    if(state!==lastPresenceMoveState){
      lastPresenceMoveAt=time;const client=presenceClient;
      void client.move({...player.position},player.facing,player.movementState==='walking'?'walk':'idle').then(sent=>{if(sent)lastPresenceMoveState=state;}).catch(()=>presenceError(client));
    }
  }
  const message=nearby?`E / Interact · ${nearby.label}`:'WASD / arrows to walk · E to interact';
  if(hint.textContent!==message)hint.textContent=message;
  $<HTMLButtonElement>('interact').disabled=!nearby;
  camera=followCamera(camera,player.position,renderer.viewport().width,renderer.viewport().height,dt);
  const interpolation=1-Math.exp(-14*Math.max(0,dt));
  for(const remote of remotePlayers.values()){
    remote.actor.position.x+=(remote.target.x-remote.actor.position.x)*interpolation;
    remote.actor.position.y+=(remote.target.y-remote.actor.position.y)*interpolation;
  }
  renderer.render({actors:[player,...[...remotePlayers.values()].map(remote=>remote.actor),...npcs],camera,nearby,time});raf=requestAnimationFrame(frame);
}
window.addEventListener('pagehide',()=>{stopped=true;persist();cancelAnimationFrame(raf);keyboard.destroy();touch.destroy();renderer.destroy();
  if(presenceHeartbeat)window.clearInterval(presenceHeartbeat);if(presenceReconnect)window.clearTimeout(presenceReconnect);presenceClient?.close();presenceClient=undefined;});
// The lab uses the production state and controller; no second renderer or game engine.
if(location.pathname==='/labs/world'){
  const lab=$('world-lab');lab.hidden=false;
  for(const landmark of LANDMARKS){const b=document.createElement('button');b.textContent='Teleport: '+landmark.label;b.onclick=()=>{player.position=safePosition(landmark.position);canvas.focus();};lab.append(b);}
  const spawn=document.createElement('button');spawn.textContent='Spawn next NPC';spawn.onclick=()=>{const profile=profiles.find(p=>!npcs.some(n=>n.agentId===p.id));if(profile)addNpc(profile,npcs.length);};lab.append(spawn);
  const badge=document.createElement('button');badge.textContent='Toggle preview crown';badge.onclick=()=>{if(npcs[0])npcs[0].recentWinner=!npcs[0].recentWinner;};lab.append(badge);
  const log=document.createElement('pre');lab.append(log);setInterval(()=>log.textContent=JSON.stringify({player:{...player.position,movementState:player.movementState,facing:player.facing},entered,interactionOpen:dialog.open,characterOpen:character.open,hidden:document.hidden,npcs:npcs.map(actor=>({id:actor.id,position:{...actor.position},movementState:actor.movementState})),events},null,2),1000);
}
try{entered=sessionStorage.getItem('agent-world-entered')==='1';}catch{}
void presetButtons().then(()=>{if(!entered)character.showModal();else{canvas.focus();startPresence();}void refreshProfiles();raf=requestAnimationFrame(frame);});
