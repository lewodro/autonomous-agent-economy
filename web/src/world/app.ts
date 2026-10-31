import { KeyboardInput, TouchJoystickInput } from './input.js';
import { CanvasWorldRenderer } from './renderer.js';
import { moveActor, followCamera } from './movement.js';
import { EXPLORATION_PROBES, MAP, LANDMARKS, WALLS, safePosition } from './map.js';
import { nearestInteraction, normalizeInput, type WorldActor, type WorldEvent, type Interactable, type WorldSpeech, type WorldParticle, type WorldResource } from './model.js';
import { AVATARS, SPRITES, loadSettings, saveSettings } from './sprites.js';
import { publicSpeech, SpeechLimiter, thoughtSeed } from './speech.js';
import { HttpArenaGateway, type AgentProfile, type MatchRecord } from './gateway.js';
import { liveMatchMessages } from './live-statistics.js';
import { loadSurvivalSnapshot } from './survival.js';
import { mountTable } from './table.js';
import { WorldPresenceClient, type PresenceAgent, type PresencePlayer, type PresenceSnapshot } from './presence-client.js';
import { FarmClient, FarmHud, CROPS, createAuth, type FarmSnapshot, type FarmTile, type FarmAccount, type CropKind } from './farm.js';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('world-canvas'),dialog=$<HTMLDialogElement>('interaction-dialog'),character=$<HTMLDialogElement>('character-dialog');
const content=$('interaction-content'),hint=$('world-hint'),connection=$('connection'),liveNotice=$<HTMLDivElement>('world-live');
const settings=loadSettings(),gateway=new HttpArenaGateway();
// A world visit from Last Seat, Arena, or an external link starts in the
// plaza again. Reloading the world itself keeps the visitor's saved position.
const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
let referrerPath='';
try{referrerPath=document.referrer?new URL(document.referrer,location.href).pathname:'';}catch{}
const returnTarget=new URLSearchParams(location.search).get('return');
if(returnTarget==='compound'){settings.position={x:-220,y:930};saveSettings(settings);}
else if(navigation?.type!=='reload'&&!['/world','/labs/world'].includes(referrerPath)){settings.position={...MAP.spawn};saveSettings(settings);}
const player:WorldActor={id:'visitor',type:'human',name:'You',position:settings.position,facing:'down',movementState:'idle',spriteId:settings.avatar,activity:'Exploring',recentWinner:false};
const renderer=new CanvasWorldRenderer(canvas),keyboard=new KeyboardInput(canvas),touch=new TouchJoystickInput($('joystick'),$('joystick-knob'),$<HTMLButtonElement>('interact'));
const npcs:WorldActor[]=[];let profiles:AgentProfile[]=[];
const agentTargets=new Map<string,{x:number;y:number}>();
const labPinnedAgents=new Map<string,number>();
const speechLimiter=new SpeechLimiter();
const thoughtCounts=new Map<string,number>();
let visitorName='human',publicHistory:MatchRecord[]=[],nextHistoryRefresh=0;
const remotePlayers=new Map<string,{actor:WorldActor;target:{x:number;y:number}}>();
let presenceClient:WorldPresenceClient|undefined,presenceState:'idle'|'connecting'|'connected'|'reconnecting'|'closed'='idle';
let presenceHeartbeat=0,presenceReconnect=0,presenceConnecting=false,lastPresenceMoveAt=0,lastPresenceMoveState='';
let arenaOnline=false;
let camera=followCamera({...MAP.spawn},player.position,renderer.viewport().width,renderer.viewport().height,100);
let requestedAgent=new URLSearchParams(location.search).get('agent');
let nearby:Interactable|undefined,entered=false,stopped=false,raf=0,previous=performance.now(),lastSave=0,lastMoveEvent=0;
let restoreWorldFocus=false;
const events:WorldEvent[]=[];
let interactionVersion=0;
let researchLiveTimer=0,worldLiveTimer=0,worldLiveIndex=0;
let worldResources:WorldResource[]=[],resourceRefresh=0;const particles:WorldParticle[]=[];
const farmClient=new FarmClient(),farmHud=new FarmHud();
let farmSnapshot:FarmSnapshot|null=null,lastPlayTick=0;
const knownTiles=new Map<string,string>();
const auth=createAuth(async()=>{
  const response=await fetch('/api/world/auth',{signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Sign-in service unavailable');
  return await response.json() as {configured:boolean;publishable_key:string|null};
});
function emit(event:WorldEvent):void {events.push(event);if(events.length>20)events.shift();}
function persist():void {saveSettings({...settings,avatar:player.spriteId,position:player.position});}
function updateWorldLabel():void {
  const others=remotePlayers.size,visitorLabel=others===1?'other visitor':'other visitors';
  canvas.setAttribute('aria-label',`Agent town with ${npcs.length} visiting agents in the plaza and ${others} ${visitorLabel} online. Agents fighting are inside the Arena. Use WASD or arrow keys to move, E to interact. Free table southwest; arena statistics south.`);
}
function updateConnectionLabel():void {
  updateWorldLabel();
  if(!entered){connection.textContent='WORLD LIVE · JOINING';return;}
  const presenceText=presenceState==='connected'?'ONLINE':presenceState==='reconnecting'?'RECONNECTING':presenceState==='closed'?'OFFLINE':'CONNECTING';
  connection.textContent=`WORLD ${presenceText} · ${remotePlayers.size+1} HERE${arenaOnline?'':' · ARENA DATA OFFLINE'}`;
}
function syncRemotePlayers(snapshot:PresenceSnapshot):void {
  const next=new Set<string>(),ownId=presenceClient?.player_id;
  for(const value of snapshot.players){
    if(value.player_id===ownId){visitorName=value.display_name||'human';continue;}
    const id=`presence:${value.player_id}`;next.add(id);
    const facing=value.direction==='up'||value.direction==='left'||value.direction==='right'?value.direction:'down';
    const spriteId=AVATARS.includes(value.avatar)?value.avatar:'visitor_ember';
    const current=remotePlayers.get(id);
    if(current){
      current.actor.name=value.display_name||`Watcher ${value.player_id.slice(-4).toUpperCase()}`;current.actor.spriteId=spriteId;
      current.actor.facing=facing;current.actor.movementState=value.animation_state==='walk'?'walking':'idle';current.actor.activity=value.activity;
      current.target={...value.position};
    }else{
      remotePlayers.set(id,{target:{...value.position},actor:{id,type:'human',name:value.display_name||`Watcher ${value.player_id.slice(-4).toUpperCase()}`,
        position:{...value.position},facing,movementState:value.animation_state==='walk'?'walking':'idle',spriteId,activity:value.activity,recentWinner:false}});
    }
  }
  for(const id of remotePlayers.keys())if(!next.has(id))remotePlayers.delete(id);
  syncCanonicalAgents(snapshot.agents);
  updateConnectionLabel();
}
function syncCanonicalAgents(agents:PresenceAgent[]):void {
  const next=new Set<string>();
  for(const value of agents){
    next.add(value.agent_id);
    const actor=npcs.find(npc=>npc.agentId===value.agent_id);
    const sprite=SPRITES.find(candidate=>candidate.sheet==='/'+value.sprite);
    const facing=value.direction==='up'||value.direction==='left'||value.direction==='right'?value.direction:'down';
    if(actor){
      actor.name=value.display_name;actor.spriteId=sprite?.id||actor.spriteId;actor.facing=facing;
      actor.movementState=value.animation_state==='walk'?'walking':'idle';actor.activity=value.activity;actor.recentWinner=value.recent_winner;
    }else{
      npcs.push({id:'npc-'+value.agent_id,type:'npc',agentId:value.agent_id,name:value.display_name,position:{...value.position},facing,
        movementState:value.animation_state==='walk'?'walking':'idle',spriteId:sprite?.id||'founder',activity:value.activity,activityState:'wander',recentWinner:value.recent_winner});
    }
    if((labPinnedAgents.get(value.agent_id)||0)<=performance.now())agentTargets.set(value.agent_id,{...value.position});
  }
  for(let index=npcs.length-1;index>=0;index--){
    const id=npcs[index]!.agentId;
    if(id&&!next.has(id)){agentTargets.delete(id);npcs.splice(index,1);}
  }
}
function presenceError(client:WorldPresenceClient):void {
  if(stopped||presenceClient!==client)return;
  presenceState='reconnecting';updateConnectionLabel();
  if(presenceReconnect)return;
  presenceReconnect=window.setTimeout(()=>{presenceReconnect=0;connectPresence(client);},1_000);
}
function connectPresence(client:WorldPresenceClient):Promise<void> {
  if(stopped||presenceClient!==client||presenceConnecting)return Promise.resolve();
  presenceConnecting=true;presenceState='connecting';updateConnectionLabel();
  return client.connect().then(()=>{lastPresenceMoveState=`${player.position.x},${player.position.y},${player.facing},${player.movementState}`;})
    .catch(()=>presenceError(client)).finally(()=>{presenceConnecting=false;});
}
function startPresence():Promise<void> {
  if(!entered||stopped||presenceClient)return Promise.resolve();
  let client:WorldPresenceClient;
  client=new WorldPresenceClient({avatar:player.spriteId,position:{...player.position},direction:player.facing,activity:player.activity,
    onPlayers:syncRemotePlayers,onConnection:state=>{
      if(presenceClient!==client)return;
      presenceState=state==='closed'?'closed':state;updateConnectionLabel();
    }});
  presenceClient=client;const joined=connectPresence(client);
  presenceHeartbeat=window.setInterval(()=>{
    if(presenceClient!==client)return;
    void client.heartbeat(player.activity).catch(()=>presenceError(client));
  },1_000);
  return joined;
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
function stopResearchLive():void {if(researchLiveTimer)window.clearInterval(researchLiveTimer);researchLiveTimer=0;}
dialog.addEventListener('close',stopResearchLive);
function show(title:string):number {stopResearchLive();resetInput();$('interaction-title').textContent=title;content.replaceChildren();if(!dialog.open)dialog.showModal();return ++interactionVersion;}
function text(tag:string,value:string,parent:HTMLElement=content):HTMLElement {const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
function link(label:string,url:string,parent:HTMLElement=content):void {const a=document.createElement('a');a.textContent=label;a.href=url;a.className='button';parent.append(a);}
interface WorldEconomySnapshot {mode:'test_credits';nodes:WorldResource[];profile:{nickname:string;wallet_address:string|null;wallet_link_status:string;credits:number};treasury:{public_address:string|null;payouts_enabled:boolean;signing:string};receipts:Array<{reward_id:string;source_action:string;amount_credits:number;status:string;timestamp:string;amount_lamports?:number;transaction_signature?:string|null}>}
async function loadWorldEconomy():Promise<WorldEconomySnapshot>{const response=await fetch('/api/world/economy',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('World economy unavailable');const result=await response.json() as WorldEconomySnapshot;worldResources=result.nodes;return result;}
const ANCHORS:Record<string,string>={
  'garden-north':'the botanical garden','garden-east':'the garden east beds','garden-south':'the garden south beds',
  'garden-west':'the garden west beds','garden-path':'the garden path','market-north':'the north market','market-east':'the east market',
  'plaza-south':'the plaza edge','south-field':'the south field','south-meadow':'the south meadow','east-workshop':'the east workshop',
  'west-trail':'the west trail','market-home':'the market homes',
};
function cropLabel(crop:CropKind|null):string{return crop?crop.charAt(0).toUpperCase()+crop.slice(1):'produce';}
function anchorLabel(anchor:string):string{return ANCHORS[anchor]||'the farm grounds';}
function sparkle(position:{x:number;y:number},colors:string[],count=10):void{const time=performance.now();for(let index=0;index<count;index++){const angle=index/count*Math.PI*2,range=16+(index%3)*6;particles.push({id:`plot-${time}-${index}`,position:{...position},velocity:{x:Math.cos(angle)*range,y:Math.sin(angle)*range-12},color:colors[index%colors.length]!,expiresAt:time+650});}}
function mergeFarmAccount(account?:FarmAccount|null):void{if(!account||!farmSnapshot)return;farmSnapshot.account=account;farmHud.show(farmSnapshot);}
function mergeFarmTile(tile?:FarmTile|null):void{if(!tile||!farmSnapshot)return;farmSnapshot.tiles=farmSnapshot.tiles.map(value=>value.id===tile.id?tile:value);}
async function loadFarm():Promise<void>{
  try{
    const snapshot=await farmClient.load(),previous=farmSnapshot;
    farmSnapshot=snapshot;farmHud.show(snapshot);
    for(const tile of snapshot.tiles){
      const before=knownTiles.get(tile.id);
      if(previous&&before===undefined)farmHud.notice(`New farm plot appeared in ${anchorLabel(tile.anchor)}`,'info');
      if(before==='growing'&&tile.stage==='ready'&&tile.mine)farmHud.notice(`${cropLabel(tile.crop)} ready at ${anchorLabel(tile.anchor)}`,'good');
      knownTiles.set(tile.id,tile.stage);
    }
  }catch{/* the HUD keeps the last snapshot until the next poll */}
}
async function plantPlot(tile:FarmTile,crop:CropKind):Promise<void>{
  try{
    const result=await farmClient.post('plant',{tile_id:tile.id,crop});
    mergeFarmTile(result.tile as FarmTile|undefined);mergeFarmAccount(result.account as FarmAccount|undefined);
    knownTiles.set(tile.id,'growing');
    farmHud.notice(`Planted ${cropLabel(crop)} · ready in about ${Math.round(Number(result.grow_ms)/1000)}s`,'good');
    dialog.close();
  }catch(error){farmHud.notice(error instanceof Error?error.message:'Planting failed','warn');}
}
async function harvestPlot(tile:FarmTile):Promise<void>{
  try{
    const result=await farmClient.post('harvest',{tile_id:tile.id});
    mergeFarmTile(result.tile as FarmTile|undefined);mergeFarmAccount(result.account as FarmAccount|undefined);
    knownTiles.set(tile.id,'wild');
    sparkle(tile.position,tile.crop==='pumpkin'?['#d98336','#f0cf75','#6fa15c']:tile.crop==='carrot'?['#d8843f','#7ea55b','#f0cf75']:['#dcc46f','#b8944d','#f0cf75']);
    farmHud.notice(`Harvested +1 ${cropLabel(tile.crop)} · carry it to the bazaar`,'good');
    burstAtBazaarHint();
  }catch(error){farmHud.notice(error instanceof Error?error.message:'Harvesting failed','warn');}
}
let bazaarHinted=false;
function burstAtBazaarHint():void{if(bazaarHinted||!farmSnapshot)return;const carrying=CROPS.reduce((sum,kind)=>sum+(farmSnapshot?.account?.inventory[kind]||0),0);if(carrying>0&&!bazaarHinted){bazaarHinted=true;farmHud.notice('Follow the arrow to the bazaar to sell your produce','info');}}
function showFarmPlot(tile:FarmTile):void{
  if(tile.mine&&tile.stage!=='wild'){void harvestPlot(tile);return;}
  show(tile.stage==='wild'?'FARM PLOT · plant':`${cropLabel(tile.crop)} · ${tile.stage}`);
  if(tile.stage==='wild'){
    text('p','Empty soil. Pick a crop; it ripens in one to two minutes.');
    const choices=document.createElement('div');choices.className='farm-plant-options';
    for(const kind of CROPS){const crop=farmSnapshot?.crops[kind];const button=document.createElement('button');button.type='button';
      button.textContent=`${crop?crop.label:kind} · ${crop?.sell||0} CR · ~${Math.round(((crop?.grow_ms[0]||60_000)+(crop?.grow_ms[1]||120_000))/2000)}s`;
      button.onclick=()=>void plantPlot(tile,kind);choices.append(button);}
    content.append(choices);
    const used=farmSnapshot?.account?.plots_used||0,limit=farmSnapshot?.account?.plots_limit||3;
    text('p',`You are tending ${used} of ${limit} plots.`);
    return;
  }
  if(!tile.mine){text('p',`Another farmer planted this ${cropLabel(tile.crop).toLowerCase()}.`);return;}
  if(tile.stage==='growing')text('p',`Growing. Ready in about ${Math.ceil(tile.ready_in_ms/1000)} seconds — the arrow will point back here.`);
  else text('p','Ready to harvest.');
}
function farmSection():void{
  const account=farmSnapshot?.account;
  if(!account){text('p','The farm ledger is still loading.');return;}
  text('h3',`FARM · LV ${account.level} · ${account.credits} CR`);
  text('p',`${account.stats.harvested} harvested · ${account.stats.sold} sold · ${Math.floor(account.seconds_played/60)} minutes in the world.`);
  const bag=CROPS.filter(kind=>(account.inventory[kind]||0)>0);
  if(!bag.length)text('p','Your bag is empty. Harvest a plot, then carry the produce back here.');
  for(const kind of bag){
    const row=document.createElement('div');row.className='bazaar-row';
    text('span',`${cropLabel(kind)} × ${account.inventory[kind]}`,row);
    const price=farmSnapshot?.crops[kind]?.sell||0;
    const one=document.createElement('button');one.type='button';one.textContent=`Sell 1 · +${price} CR`;
    const all=document.createElement('button');all.type='button';all.textContent=`Sell all · +${price*account.inventory[kind]} CR`;
    one.onclick=()=>void sellProduce(kind,1);all.onclick=()=>void sellProduce(kind,account.inventory[kind]);
    row.append(one,all);content.append(row);
  }
}
async function sellProduce(crop:CropKind,quantity:number):Promise<void>{
  try{
    const result=await farmClient.post('sell',{crop,quantity});
    mergeFarmAccount(result.account as FarmAccount|undefined);
    farmHud.notice(`Sold ${quantity} ${cropLabel(crop).toLowerCase()} · +${result.credits} CR`,'good');
    sparkle(player.position,['#f0cf75','#dcc46f']);
    await showBazaar();
  }catch(error){farmHud.notice(error instanceof Error?error.message:'Sale failed','warn');}
}
function accountSection():void{
  const account=farmSnapshot?.account;
  if(!account)return;
  text('h3','ACCOUNT');
  if(account.signed_in){
    text('p',`Signed in as ${account.display_name}. Credits, crops and payout history follow this account.`);
    const out=document.createElement('button');out.type='button';out.textContent='Sign out';
    out.onclick=()=>{out.disabled=true;void auth.signOut().then(async()=>{await loadFarm();await showBazaar();});};
    content.append(out);
  }else{
    text('p',farmSnapshot?.auth.configured?'Sign in with a social account to keep credits, crops and payouts across devices.':'Social login is not configured on this deployment yet; progress stays in this browser.');
    if(farmSnapshot?.auth.configured){
      const sign=document.createElement('button');sign.type='button';sign.className='primary';sign.textContent='Sign in with Google or GitHub';
      sign.onclick=()=>{sign.disabled=true;void auth.signIn().then(async signed=>{if(signed){farmHud.notice('Signed in · your farm progress was linked','good');await loadFarm();await showBazaar();}else sign.disabled=false;}).catch(error=>{sign.disabled=false;farmHud.notice(error instanceof Error?error.message:'Sign-in failed','warn');});};
      content.append(sign);
    }
  }
}
function walletSection(payoutsEnabled:boolean):void{
  const account=farmSnapshot?.account;if(!account)return;
  text('h3','FUTURE REWARD LINK');
  text('p',`Time in the world earns ${farmSnapshot?.rates.credits_per_minute||1} internal credit per minute. Credits are not SOL or wallet funds. A public address can be linked for a future, separately enabled payout program.`);
  const form=document.createElement('form');form.className='world-profile-form';
  const wallet=document.createElement('input');wallet.placeholder='Public Solana wallet address';wallet.maxLength=44;wallet.value=account.wallet.address||'';
  const save=document.createElement('button');save.type='submit';save.textContent=account.wallet.address?'Update wallet':'Link wallet';
  form.append(wallet,save);content.append(form);
  const status=text('p',account.wallet.address?'Wallet saved as self-declared. Never enter a seed phrase or private key.':'No wallet linked. Never enter a seed phrase or private key.');
  form.onsubmit=event=>{event.preventDefault();save.disabled=true;void farmClient.post('wallet',{wallet_address:wallet.value}).then(result=>{mergeFarmAccount(result.account as FarmAccount|undefined);status.textContent='Public wallet saved.';farmHud.notice('Wallet linked','good');}).catch(error=>{status.textContent=error instanceof Error?error.message:'Wallet update failed';}).finally(()=>save.disabled=false);};
  if(account.wallet.address&&payoutsEnabled){
    const min=farmSnapshot?.rates.min_withdrawal_credits||50;
    const button=document.createElement('button');button.type='button';button.textContent=`Request payout · ${account.credits} CR`;button.disabled=account.credits<min;
    button.onclick=()=>{button.disabled=true;void farmClient.post('payout',{amount_credits:account.credits}).then(result=>{mergeFarmAccount(result.account as FarmAccount|undefined);farmHud.notice('Payout queued for the treasury','good');void showBazaar();}).catch(error=>{button.disabled=false;farmHud.notice(error instanceof Error?error.message:'Payout request failed','warn');});};
    content.append(button);
    if(account.credits<min)text('p',`Withdrawals open at ${min} credits.`);
  }else if(account.wallet.address){
    text('p','Real payouts are disabled. Linking an address does not convert credits into SOL or create a payable balance.');
  }
  for(const payout of account.payouts)text('p',`${payout.amount_credits} CR · ${payout.status} · ${new Date(payout.requested_at).toLocaleDateString()}`);
}
async function showBazaar():Promise<void>{
  const version=show('BAZAAR · farm exchange');
  text('p','Loading the exchange ledger…');
  try{
    const [,economy]=await Promise.all([loadFarm(),loadWorldEconomy().catch(()=>null)]);
    if(!dialog.open||version!==interactionVersion)return;
    content.replaceChildren();
    text('p','Bring produce here from the farm plots. Produce sells for internal world credits; credits are not SOL or wallet funds.');
    farmSection();accountSection();walletSection(Boolean(economy?.treasury.payouts_enabled));
    if(economy?.treasury.public_address){text('h3','PUBLIC TREASURY CONFIGURATION');text('p',economy.treasury.public_address);text('p',economy.treasury.payouts_enabled?'A separately configured real-payout program is enabled.':'Real payouts are disabled; internal credits remain in-game only.');}
    text('h3','GATHERING RECEIPTS');
    if(!economy?.receipts.length)text('p','No ore or herb gathering receipts yet.');
    for(const receipt of (economy?.receipts||[]).slice().reverse().slice(0,5))text('p',`${receipt.amount_credits} credits · ${receipt.source_action.replace(':',' ')} · ${receipt.status}`);
  }catch{if(dialog.open&&version===interactionVersion){content.replaceChildren();text('p','The bazaar terminal is temporarily unavailable.');}}
}
function burst(resource:WorldResource,time:number):void{const colors=resource.kind==='ore'?['#d5c47d','#8e9488','#665c4d']:['#d8cb75','#78a164','#496f4f'];for(let index=0;index<12;index++){const angle=index/12*Math.PI*2,range=18+(index%3)*6;particles.push({id:`${resource.id}-${time}-${index}`,position:{...resource.position},velocity:{x:Math.cos(angle)*range,y:Math.sin(angle)*range-10},color:colors[index%colors.length]!,expiresAt:time+650});}}
async function gatherResource(id:string):Promise<void>{const resource=worldResources.find(value=>value.id===id);if(!resource||!presenceClient?.player_id)return;try{const response=await fetch('/api/world/economy/gather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({node_id:id})});const result=await response.json() as {error?:string;node?:WorldResource;profile?:{credits:number};receipt?:{amount_credits:number}};if(!response.ok)throw new Error(result.error||'Gathering failed');worldResources=worldResources.map(value=>value.id===id?result.node!:value);burst(resource,performance.now());show(resource.kind==='ore'?'Ore gathered':'Plants harvested');text('p',`+${result.receipt?.amount_credits||resource.reward} TEST CREDITS · balance ${result.profile?.credits||0}.`);text('p','A reward receipt was recorded at the Bazaar terminal.');}catch(error){show('Gathering');text('p',error instanceof Error?error.message:'Gathering failed');}}
function showProfile(id:string,sharedThought?:WorldSpeech):void {
  const profile=profiles.find(a=>a.id===id);if(!profile)return;
  show(profile.name);const head=text('div','');head.className='agent-profile-head';
  const image=document.createElement('img');image.src='/'+profile.sprite;image.alt=profile.name;head.append(image);text('p',profile.strategy,head);
  if(sharedThought){const thought=text('section','');thought.className='agent-shared-thought';text('span',sharedThought.synthetic?'CURRENT THOUGHT · WANTS TO SHARE':'CURRENT THOUGHT · PUBLIC RESEARCH',thought);text('p',`“${sharedThought.text}”`,thought);
    if(sharedThought.text.includes('?')){const responses=text('div','',thought);responses.className='agent-thought-responses';for(const label of ['PLAY SAFER','KEEP PRESSURE','YOUR CALL']){const choice=document.createElement('button');choice.textContent=label;choice.onclick=()=>{responses.replaceChildren();const note=text('p',`${profile.name} heard you. This only affects this conversation.`,responses);note.className='agent-thought-response';};responses.append(choice);}}
  }
  const stats=text('div','');stats.className='profile-stats';
  for(const [label,value] of [['Matches',profile.matches],['Wins',profile.wins],['Draws',profile.draws]]){const box=text('div','',stats);text('strong',String(value),box);text('span',String(label),box);}
  text('p',`Statistics from ${profile.scope}. ${profile.recentWinner?'Crown: latest retained match was a win.':''}`);
  text('p',`World activity: ${npcs.find(a=>a.agentId===id)?.activity||'At the plaza'}.`);
  if(profile.latestMatch)text('p',`Recent public match: ${profile.latestMatch.game.toUpperCase()} · ${profile.latestMatch.matchId}.`);
  text('h3','Recent public research');
  for(const memory of profile.memory.slice().reverse()){
    const row=text('div',`${memory.game.toUpperCase()} · ${memory.matchId}`);row.className='memory-row';
    text('p',`${profiles.find(a=>a.id===memory.opponent)?.name||memory.opponent}: ${memory.observed}. Played ${memory.move}.`,row);
    link('Download match record',`/api/arena/logs/${memory.runId}`,row);
  }
  if(!profile.memory.length)text('p','No completed arena matches recorded yet. Watch a room to begin the story.');
  const actions=text('div','');actions.className='profile-actions';link('View all agents','/arena#agents',actions);
  if(profile.roomId)link('Watch current match',profile.roomId==='survival-main'?'/arena/survival/survival-main':`/arena/${profile.roomId.startsWith('rps')?'rps':'tictactoe'}/${profile.roomId}`,actions);
}
async function showResearch():Promise<void> {
  const version=show('Arena research');text('p','Loading authoritative arena statistics…');
  try{
    const [stats,matches]=await Promise.all([gateway.statistics(),gateway.history()]);
    if(!dialog.open||version!==interactionVersion)return;content.replaceChildren();
    const live=text('section','');live.id='research-live';text('h3','Live public matchups',live);
    const liveBody=text('div','Loading current server match state…',live);
    let requestNumber=0;
    const refreshLive=async()=>{
      const currentRequest=++requestNumber;
      const [roomResult,survivalResult]=await Promise.allSettled([gateway.listRooms(),loadSurvivalSnapshot()]);
      if(!dialog.open||version!==interactionVersion||currentRequest!==requestNumber)return;
      liveBody.replaceChildren();
      if(roomResult.status==='rejected'&&survivalResult.status==='rejected'){
        text('p','Live match feed is temporarily unavailable.',liveBody);return;
      }
      const lines=liveMatchMessages(roomResult.status==='fulfilled'?roomResult.value:[],survivalResult.status==='fulfilled'?survivalResult.value:null);
      if(!lines.length)text('p','No public match is live right now. Waiting for the next round.',liveBody);
      for(const line of lines)text('p',line,liveBody);
    };
    void refreshLive();researchLiveTimer=window.setInterval(()=>void refreshLive(),4000);
    text('p',`Completed record · ${stats.scope}. ${stats.updated_at?`Last completed match: ${new Date(stats.updated_at).toLocaleString()}.`:'No completed matches recorded yet.'}`);
    const totals=text('div','');totals.className='research-totals';
    for(const [label,value] of [['Completed matches',stats.totals.matches],['Recorded decisions',stats.totals.decisions],['Draws',stats.totals.draws]] as [string,number][]){
      const item=text('article','',totals);text('strong',String(value),item);text('span',label,item);
    }
    text('h3','Games recorded');
    for(const [game,label] of [['rps','Rock Paper Scissors'],['tictactoe','Tic-Tac-Toe'],['survival','Survival melee']] as const){
      const summary=stats.games[game];const row=text('p',`${label} · ${summary.matches} matches · ${summary.decisions} decisions · ${summary.draws} draws`);row.className='research-game';
    }
    text('h3','Agent standings · retained runs');
    if(!stats.agents.length)text('p','No completed matches yet. Visit the Arena and return after the first result.');
    for(const [index,agent] of stats.agents.slice(0,10).entries()){
      const row=text('article',`${String(index+1).padStart(2,'0')} · ${agent.name}`);row.className='research-agent';
      text('p',`${agent.wins} wins · ${agent.matches} matches · ${agent.win_rate}% win rate · ${agent.strategy}`,row);
      link('Inspect agent in the world',`/world?agent=${encodeURIComponent(agent.id)}`,row);
    }
    text('h3','Latest match results');
    for(const match of matches.slice(0,6)){
      const row=text('article',`${match.game.toUpperCase()} · ${match.players.map(a=>a.name).join(' vs ')}`);row.className='archive-row';
      text('p',match.result==='draw'?'Draw':`Winner: ${match.players[match.result==='a'?0:1]!.name}`,row);
      link('Watch room',`/arena/${match.game}/${match.roomId}`,row);link('Download match record',match.logUrl,row);
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
  if(target.type==='arena')portal();else if(target.type==='agent'){
    const actor=npcs.find(npc=>npc.agentId===target.id);
    if(actor?.speech&&actor.speech.expiresAt>performance.now()){
      const thought=actor.speech;
      actor.speech=undefined;
      showProfile(target.id,thought);
    }else showProfile(target.id);
  }else if(target.type==='research')await showResearch();else if(target.type==='zone'){
    if(target.id==='compound-entrance'){persist();resetInput();void leavePresence();document.body.classList.add('leaving');setTimeout(()=>location.assign('/compound'),220);return;}
    if(target.id==='south-market'){await showBazaar();return;}
    if(target.id.startsWith('resource:')){await gatherResource(target.id.slice('resource:'.length));return;}
    if(target.id.startsWith('plot:')){
      const tile=farmSnapshot?.tiles.find(value=>value.id===target.id.slice('plot:'.length));
      if(tile)showFarmPlot(tile);
      return;
    }
    const zones:Record<string,[string,string]>={
      'forest-clearing':['Forest clearing','A quiet trail and wooded rest point beyond the plaza.'],
      'botanical-garden':['Botanical garden','Walk among planted beds, varied trees and the garden campfire.'],
      'agent-agency':['Agent agency','This building is reserved for a future agent gathering place.'],
    };
    const [title,description]=zones[target.id]||[target.label,'A place to explore in the shared world.'];show(title);text('p',description);
  }
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
$('enter-world').onclick=()=>{entered=true;restoreWorldFocus=true;persist();try{sessionStorage.setItem('agent-world-entered','1');}catch{}character.close();canvas.focus();const joined=startPresence();lastPlayTick=Date.now();void joined.then(()=>loadFarm());};
document.querySelectorAll<HTMLButtonElement>('[data-place]').forEach(button=>{
  button.onclick=()=>{
    button.closest('details')?.removeAttribute('open');
    const place=button.dataset.place;
    if(place==='market')void showBazaar();
    else if(place==='archive')void showResearch();
    else if(place==='agency'){show('Agent agency');text('p','The agent house sits northeast of the plaza. It is reserved for a future agent gathering place.');}
  };
});
document.addEventListener('click',event=>{const places=document.querySelector<HTMLDetailsElement>('.world-places');if(places?.open&&!places.contains(event.target as Node))places.open=false;});
const legend=document.querySelector<HTMLDetailsElement>('.world-legend');if(legend&&matchMedia('(max-width:680px)').matches)legend.open=false;
$('hud-account').onclick=()=>{
  if(farmSnapshot?.account?.signed_in){void showBazaar();return;}
  if(!farmSnapshot?.auth.configured){farmHud.notice('Social login is not configured on this deployment yet','info');return;}
  const button=$<HTMLButtonElement>('hud-account');button.disabled=true;
  void auth.signIn().then(async signed=>{
    if(signed){farmHud.notice('Signed in · your farm progress was linked','good');await loadFarm();}
  }).catch(error=>farmHud.notice(error instanceof Error?error.message:'Sign-in failed','warn')).finally(()=>{button.disabled=false;});
};
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
async function refreshProfiles():Promise<void> {
  if(stopped)return;
  try{
    profiles=await gateway.getAgentProfiles();
    if(Date.now()>=nextHistoryRefresh){
      nextHistoryRefresh=Date.now()+20_000;
      try{publicHistory=await gateway.history();}catch{publicHistory=[];}
    }
    for(const profile of profiles){
      const existing=npcs.find(npc=>npc.agentId===profile.id);
      if(existing)existing.recentWinner=profile.recentWinner;
    }
    updateWorldLabel();
    arenaOnline=true;updateConnectionLabel();
    const directory=$('agent-directory'),current=new Set<string>();
    for(const profile of profiles){
      const id='directory-agent-'+profile.id;current.add(id);
      let b=document.getElementById(id) as HTMLButtonElement|null;
      if(!b){b=document.createElement('button');b.id=id;b.onclick=()=>showProfile(profile.id);directory.append(b);}
      b.textContent=`${profile.name} · ${profile.arenaStatus.toUpperCase()}${profile.roomId?` · ${profile.roomId.toUpperCase()}`:''}`;
    }
    for(const b of directory.querySelectorAll<HTMLButtonElement>('button'))if(!current.has(b.id))b.remove();
    if(requestedAgent&&entered){showProfile(requestedAgent);requestedAgent=null;}
  }catch{arenaOnline=false;updateConnectionLabel();}
  if(!stopped)setTimeout(refreshProfiles,5000);
}
async function refreshWorldLive():Promise<void>{
  if(stopped)return;
  const [roomResult,survivalResult]=await Promise.allSettled([gateway.listRooms(),loadSurvivalSnapshot()]);
  const lines=liveMatchMessages(roomResult.status==='fulfilled'?roomResult.value:[],survivalResult.status==='fulfilled'?survivalResult.value:null);
  liveNotice.textContent=lines.length?`LIVE · ${lines[worldLiveIndex++%lines.length]}`:'LIVE · plaza open · the next public match is starting soon';
  liveNotice.hidden=false;
}
function farmGuide():{target:{x:number;y:number};label:string}|null{
  if(!entered||!farmSnapshot?.account)return null;
  const account=farmSnapshot.account;
  const carrying=CROPS.reduce((sum,kind)=>sum+(account.inventory[kind]||0),0);
  if(carrying>0)return {target:{...farmSnapshot.bazaar.position},label:'Sell produce'};
  const ready=farmSnapshot.tiles.filter(tile=>tile.mine&&tile.stage==='ready');
  const candidates=ready.length?ready:farmSnapshot.tiles.filter(tile=>tile.stage==='wild');
  if(!candidates.length)return null;
  const nearest=[...candidates].sort((a,b)=>Math.hypot(player.position.x-a.position.x,player.position.y-a.position.y)-Math.hypot(player.position.x-b.position.x,player.position.y-b.position.y)||a.id.localeCompare(b.id))[0]!;
  return {target:{...nearest.position},label:ready.length?`Harvest ${cropLabel(nearest.crop).toLowerCase()}`:'Plant a crop'};
}
function frame(time:number):void {
  const dt=Math.min(.1,(time-previous)/1000);previous=time;
  const k=keyboard.read(),t=touch.read();
  if(entered&&!dialog.open&&!character.open&&!document.hidden){
    const input=normalizeInput(k.x+t.x,k.y+t.y,k.interact||t.interact);
    // Ambient agents remain inspectable, but cannot form a moving wall across the visitor's route.
    moveActor(player,input,dt,150,WALLS);
    for(const npc of npcs)if(npc.speech&&npc.speech.expiresAt<=time)npc.speech=undefined;
    const closeNpc=npcs.filter(npc=>Math.hypot(player.position.x-npc.position.x,player.position.y-npc.position.y)<170)
      .sort((a,b)=>Math.hypot(player.position.x-a.position.x,player.position.y-a.position.y)-Math.hypot(player.position.x-b.position.x,player.position.y-b.position.y)||a.id.localeCompare(b.id))[0];
    const closeProfile=closeNpc?.agentId?profiles.find(profile=>profile.id===closeNpc.agentId):undefined;
    const activeThoughts=npcs.filter(npc=>npc.speech&&npc.speech.expiresAt>time).length;
    if(closeNpc&&closeProfile&&!closeNpc.speech&&activeThoughts<3&&speechLimiter.allow(closeNpc.id,Date.now())){
      const count=(thoughtCounts.get(closeNpc.id)||0)+1;thoughtCounts.set(closeNpc.id,count);
      const speech=publicSpeech(closeProfile,closeNpc.activityState||'wander',thoughtSeed(closeNpc.id,count,Math.floor(Date.now()/60_000)),{visitorName,publicHistory});
      closeNpc.speech={text:speech.text,expiresAt:time+24000,synthetic:speech.synthetic};
    }
    if(time>=resourceRefresh){resourceRefresh=time+5000;void loadWorldEconomy().catch(()=>{});void loadFarm();}
    const resourceTargets:Interactable[]=worldResources.filter(resource=>resource.available).map(resource=>({id:`resource:${resource.id}`,position:resource.position,radius:64,type:'zone',label:resource.kind==='ore'?'Mine ore':'Harvest plants'}));
    const plotTargets:Interactable[]=(farmSnapshot?.tiles||[]).map(tile=>({id:`plot:${tile.id}`,position:tile.position,radius:70,type:'zone' as const,
      label:tile.stage==='wild'?'Plant a crop':tile.mine?(tile.stage==='ready'?`Harvest ${cropLabel(tile.crop).toLowerCase()}`:`${cropLabel(tile.crop).toLowerCase()} growing`):`${cropLabel(tile.crop).toLowerCase()} field`}));
    const targets=[...LANDMARKS,...resourceTargets,...plotTargets,...npcs.map(a=>({id:a.agentId!,position:a.position,radius:72,type:'agent' as const,label:`${a.speech&&a.speech.expiresAt>time?'Talk to':'Inspect'} ${a.name}`}))];
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
  if(entered&&!document.hidden&&lastPlayTick&&Date.now()-lastPlayTick>=15_000){
    const seconds=Math.min(30,Math.round((Date.now()-lastPlayTick)/1000));lastPlayTick=Date.now();
    void farmClient.post('heartbeat',{seconds}).then(result=>mergeFarmAccount(result.account as FarmAccount|undefined)).catch(()=>{});
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
  for(const npc of npcs){
    const target=npc.agentId?agentTargets.get(npc.agentId):undefined;if(!target)continue;
    npc.position.x+=(target.x-npc.position.x)*interpolation;
    npc.position.y+=(target.y-npc.position.y)*interpolation;
  }
  for(let index=particles.length-1;index>=0;index--)if(particles[index]!.expiresAt<=time)particles.splice(index,1);
  renderer.render({actors:[player,...[...remotePlayers.values()].map(remote=>remote.actor),...npcs],camera,nearby,time,resources:worldResources,particles,farmTiles:farmSnapshot?.tiles||[],guide:farmGuide()});raf=requestAnimationFrame(frame);
}
window.addEventListener('pagehide',()=>{stopped=true;persist();cancelAnimationFrame(raf);keyboard.destroy();touch.destroy();renderer.destroy();
  if(presenceHeartbeat)window.clearInterval(presenceHeartbeat);if(presenceReconnect)window.clearTimeout(presenceReconnect);if(worldLiveTimer)window.clearInterval(worldLiveTimer);presenceClient?.close();presenceClient=undefined;});
// The lab uses the production state and controller; no second renderer or game engine.
if(location.pathname==='/labs/world'){
  const lab=$('world-lab');lab.hidden=false;
  const teleport=async(position:{x:number;y:number})=>{await leavePresence();player.position=safePosition(position);persist();if(entered)startPresence();canvas.focus();};
  for(const landmark of LANDMARKS){const b=document.createElement('button');b.textContent='Teleport: '+landmark.label;b.onclick=()=>{void teleport(landmark.position);};lab.append(b);}
  for(const [name,position] of Object.entries(EXPLORATION_PROBES)){const b=document.createElement('button');b.textContent='Walk probe: '+name;b.onclick=()=>{void teleport(position);};lab.append(b);}
  const badge=document.createElement('button');badge.textContent='Toggle preview crown';badge.onclick=()=>{if(npcs[0])npcs[0].recentWinner=!npcs[0].recentWinner;};lab.append(badge);
  const thought=document.createElement('button');thought.textContent='Offer nearest NPC thought';thought.onclick=()=>{
    const actor=[...npcs].sort((a,b)=>Math.hypot(a.position.x-player.position.x,a.position.y-player.position.y)-Math.hypot(b.position.x-player.position.x,b.position.y-player.position.y))[0];
    const profile=actor?.agentId?profiles.find(value=>value.id===actor.agentId):undefined;
    if(actor&&profile){const preview={x:player.position.x+42,y:player.position.y};actor.position={...preview};agentTargets.set(profile.id,preview);labPinnedAgents.set(profile.id,performance.now()+25000);const speech=publicSpeech(profile,actor.activityState||'wander',7);actor.speech={text:speech.text,expiresAt:performance.now()+24000,synthetic:speech.synthetic};}
  };lab.append(thought);
  const log=document.createElement('pre');lab.append(log);setInterval(()=>log.textContent=JSON.stringify({player:{...player.position,movementState:player.movementState,facing:player.facing},entered,interactionOpen:dialog.open,characterOpen:character.open,hidden:document.hidden,npcs:npcs.map(actor=>({id:actor.id,name:actor.name,position:{...actor.position},movementState:actor.movementState,activityState:actor.activityState,attention:!!actor.speech})),events},null,2),250);
}
try{entered=sessionStorage.getItem('agent-world-entered')==='1';}catch{}
// The plaza is the landing page: join it immediately instead of covering the
// live world with a splash or a blocking character picker. Character choice
// stays available from the header.
if(!entered){entered=true;try{sessionStorage.setItem('agent-world-entered','1');}catch{}}
void presetButtons();
canvas.focus();const joined=startPresence();lastPlayTick=Date.now();
// The presence join owns the anonymous visitor cookie. Wait for it before
// loading other visitor-scoped state so a concurrent request cannot mint a
// second identity and ghost this visitor on refresh.
void refreshProfiles();void refreshWorldLive();void joined.then(()=>loadFarm());worldLiveTimer=window.setInterval(()=>void refreshWorldLive(),4000);raf=requestAnimationFrame(frame);
