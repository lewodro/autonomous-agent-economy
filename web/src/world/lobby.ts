import { HttpArenaGateway, type ArenaRoom, type LiveDuel, type LiveDuelBoard, type MatchRecord } from './gateway.js';
import { acceptsSurvivalUpdate, loadSurvivalSnapshot, SurvivalRenderer, hitTest, type Selection, type SurvivalEvent, type SurvivalSnapshot } from './survival.js';
const gateway=new HttpArenaGateway(),rooms=document.getElementById('rooms')!,status=document.getElementById('lobby-status')!,agents=document.getElementById('arena-agents')!;
const survivalView=document.getElementById('survival-view')!,roomsView=document.getElementById('rooms-view')!;
const survivalRoster=document.getElementById('survival-roster')!,survivalResult=document.getElementById('survival-result')!;
const feedList=document.getElementById('arena-feed-list')!,feedStatus=document.getElementById('arena-feed-status')!;
const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let stopped=false;window.addEventListener('pagehide',()=>stopped=true);
let gameMode='survival',modeReady=false,snapshot:SurvivalSnapshot|undefined,selection:Selection|undefined,survivalRenderer:SurvivalRenderer|undefined;
const survivalCanvas=document.getElementById('survival-field') as HTMLCanvasElement;
const survivalStatus=document.getElementById('survival-status')!;
const lastStatValues=new Map<string,string>();
function flashStat(id:string,value:string):void{
  const node=document.getElementById(id);if(!node)return;
  const before=lastStatValues.get(id);node.textContent=value;
  if(before!==undefined&&before!==value){node.classList.remove('is-flashing');void node.offsetWidth;node.classList.add('is-flashing');}
  lastStatValues.set(id,value);
}

/* ---------------------------------------------------------------
   Motion helpers. Everything is bounded: CSS transitions do the
   work, no permanent animation loop is created here.
   --------------------------------------------------------------- */
function withFlip(container:HTMLElement,key:string,mutate:()=>void):void{
  if(reduceMotion.matches){mutate();return;}
  const before=new Map<string,DOMRect>();
  for(const child of Array.from(container.children)){
    if(!(child instanceof HTMLElement))continue;
    const value=child.dataset[key];if(value)before.set(value,child.getBoundingClientRect());
  }
  mutate();
  for(const child of Array.from(container.children)){
    if(!(child instanceof HTMLElement))continue;
    const value=child.dataset[key],previous=value?before.get(value):undefined;
    if(!previous)continue;
    const now=child.getBoundingClientRect(),dy=previous.top-now.top,dx=previous.left-now.left;
    if(!dx&&!dy)continue;
    child.style.transition='none';child.style.transform=`translate(${dx}px,${dy}px)`;
    requestAnimationFrame(()=>{child.style.transition='';child.style.transform='';});
  }
}

/* ---------------------------------------------------------------
   Live feed. Only real server events and observed room transitions
   are rendered; nothing is invented to keep the Arena busy.
   --------------------------------------------------------------- */
type FeedKind='event'|'fight'|'elimination'|'result'|'room';
interface FeedEntry{key:string;kind:FeedKind;tag:string;round:string;text:string}
const feedEntries:FeedEntry[]=[];
const feedKeys=new Set<string>();
const FEED_LIMIT=8;
function feedKindFor(type:SurvivalEvent['type']):FeedKind{
  if(type==='DamageTaken'||type==='AttackLanded'||type==='AttackStarted')return 'fight';
  if(type==='AgentEliminated')return 'elimination';
  if(type==='WinnerDeclared'||type==='SurvivalMatchCompleted')return 'result';
  return 'event';
}
const EVENT_TAGS:Record<string,string>={
  SurvivalMatchStarted:'START',SurvivalMatchCompleted:'RESULT',AgentSpawned:'SPAWN',TargetSelected:'TARGET',
  TargetChanged:'TARGET',ChaseStarted:'CHASE',AttackStarted:'ATTACK',AttackLanded:'HIT',DamageTaken:'DAMAGE',
  RetreatStarted:'RETREAT',AgentCornered:'CORNER',AgentEscaped:'ESCAPE',AgentEliminated:'OUT',
  WinnerDeclared:'WINNER',ResearchUpdated:'RESEARCH',
};
function pushFeed(entry:FeedEntry):void{
  if(feedKeys.has(entry.key))return;
  feedKeys.add(entry.key);feedEntries.unshift(entry);
  while(feedEntries.length>FEED_LIMIT){const dropped=feedEntries.pop();if(dropped)feedKeys.delete(dropped.key);}
}
function renderFeed():void{
  const desired=feedEntries.map(entry=>entry.key);
  const desiredSet=new Set(desired);
  withFlip(feedList,'feedKey',()=>{
    // Retire items that fell out of the retained history with a real exit phase.
    for(const child of Array.from(feedList.children)){
      if(!(child instanceof HTMLElement)||!child.dataset.feedKey)continue;
      if(desiredSet.has(child.dataset.feedKey)||child.classList.contains('is-leaving'))continue;
      child.classList.add('is-leaving');
      const remove=()=>child.remove();
      child.addEventListener('transitionend',remove,{once:true});
      window.setTimeout(remove,reduceMotion.matches?0:260);
    }
    // Fill in missing items newest-first at the top of the log.
    const existing=new Set(Array.from(feedList.children).filter(node=>node instanceof HTMLElement&&node.dataset.feedKey).map(node=>(node as HTMLElement).dataset.feedKey));
    let anchor:Element|null=feedList.firstElementChild;
    for(let index=desired.length-1;index>=0;index--){
      const entry=feedEntries[index]!;
      if(existing.has(entry.key))continue;
      const item=document.createElement('li');item.className='feed-item';item.dataset.feedKey=entry.key;item.dataset.kind=entry.kind;
      const tag=document.createElement('span');tag.className='feed-item__tag';tag.textContent=entry.tag;
      const round=document.createElement('span');round.className='feed-item__round';round.textContent=entry.round;
      const text=document.createElement('span');text.className='feed-item__text';text.textContent=entry.text;
      item.append(tag,round,text);
      if(!reduceMotion.matches){item.classList.add('is-entering');requestAnimationFrame(()=>requestAnimationFrame(()=>item.classList.remove('is-entering')));}
      feedList.insertBefore(item,anchor);
      anchor=item;
    }
    if(!feedEntries.length&&!feedList.querySelector('.feed-empty')){
      const empty=document.createElement('li');empty.className='feed-empty';empty.textContent='Waiting for the next authoritative event…';
      feedList.append(empty);
    }
    if(feedEntries.length)feedList.querySelector('.feed-empty')?.remove();
  });
}
function observeSurvivalEvents(s:SurvivalSnapshot):void{
  for(const event of s.events){
    pushFeed({key:`surv-${s.match_id}-${event.seq}`,kind:feedKindFor(event.type),tag:EVENT_TAGS[event.type]||'EVENT',round:`R${event.round}`,text:event.summary});
  }
  renderFeed();
}

/* ---------------------------------------------------------------
   Survival participant strip: real sprites, health and eliminations.
   --------------------------------------------------------------- */
const rosterChips=new Map<string,HTMLElement>();
let rosterSignature='';
function paintRoster(s:SurvivalSnapshot):void{
  const signature=`${s.match_id}|${s.agents.map(agent=>`${agent.id}:${agent.status}:${agent.hp}`).join(',')}`;
  if(signature===rosterSignature)return;
  rosterSignature=signature;
  const seen=new Set<string>();
  withFlip(survivalRoster,'rosterAgent',()=>{
    for(const agent of s.agents){
      seen.add(agent.id);let chip=rosterChips.get(agent.id);
      if(!chip){
        chip=document.createElement('div');chip.className='roster-chip is-entering';chip.dataset.rosterAgent=agent.id;
        const img=document.createElement('img');img.src='/'+agent.sprite;img.alt='';img.width=30;img.height=30;img.decoding='async';
        const body=document.createElement('div');body.className='roster-chip__body';
        const name=document.createElement('span');const bar=document.createElement('i');const fill=document.createElement('b');
        bar.append(fill);body.append(name,bar);chip.append(img,body);
        survivalRoster.append(chip);rosterChips.set(agent.id,chip);
        if(!reduceMotion.matches)requestAnimationFrame(()=>requestAnimationFrame(()=>chip!.classList.remove('is-entering')));
      }
      chip.querySelector('span')!.textContent=agent.name;
      const ratio=Math.max(0,Math.min(1,agent.hp/agent.max_hp));
      chip.querySelector<HTMLElement>('i b')!.style.width=`${Math.round(ratio*100)}%`;
      chip.classList.toggle('is-eliminated',agent.status==='eliminated'||agent.status==='spectating');
      chip.classList.toggle('is-hurt',agent.status!=='eliminated'&&ratio<=.3);
      chip.setAttribute('aria-label',`${agent.name}: ${agent.status}, ${agent.hp} of ${agent.max_hp} HP`);
      chip.title=`${agent.name} · ${agent.status} · ${agent.hp}/${agent.max_hp} HP`;
    }
    for(const [id,chip] of rosterChips)if(!seen.has(id)){chip.remove();rosterChips.delete(id);}
  });
}

/* ---------------------------------------------------------------
   Result banner. Driven only by a finished authoritative snapshot.
   --------------------------------------------------------------- */
let resultHideTimer=0;
function paintResult(s:SurvivalSnapshot):void{
  window.clearTimeout(resultHideTimer);
  if(s.status==='finished'){
    const winner=s.agents.find(agent=>agent.id===s.leader_id);
    survivalResult.replaceChildren();
    const title=document.createElement('strong');title.textContent=winner?`WINNER · ${winner.name.toUpperCase()}`:'MATCH COMPLETE';
    const note=document.createElement('span');note.textContent=winner?`${winner.wins} WINS · ${winner.losses} LOSSES`:`MATCH ${s.match_id}`;
    survivalResult.append(title,note);
    survivalResult.hidden=false;
    requestAnimationFrame(()=>survivalResult.classList.add('is-visible'));
    return;
  }
  if(!survivalResult.hidden){
    survivalResult.classList.remove('is-visible');
    resultHideTimer=window.setTimeout(()=>{survivalResult.hidden=true;},reduceMotion.matches?0:260);
  }
}

/* ---------------------------------------------------------------
   Mode switching with a genuine exit phase before the next view.
   --------------------------------------------------------------- */
function applyMode(mode:string):void{
  const survival=mode==='survival';
  survivalView.hidden=!survival;roomsView.hidden=survival;
  survivalRenderer?.setActive(survival);
  if(!survival){for(const card of rooms.querySelectorAll<HTMLElement>('.room-card'))card.hidden=!card.id.startsWith(mode==='rps'?'room-rps-':'room-ttt-');}
  else if(snapshot)paintSurvival();
}
function setMode(mode:string):void{
  const survival=mode==='survival';
  const nextView=survival?survivalView:roomsView;
  const previousView=survival?roomsView:survivalView;
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-game-mode]'))button.setAttribute('aria-pressed',String(button.dataset.gameMode===mode));
  const changed=mode!==gameMode;
  gameMode=mode;
  if(!changed||!modeReady||reduceMotion.matches){applyMode(mode);modeReady=true;return;}
  modeReady=true;
  previousView.classList.remove('is-entering');
  previousView.classList.add('is-leaving');
  window.setTimeout(()=>{
    previousView.hidden=true;previousView.classList.remove('is-leaving');
    applyMode(mode);
    nextView.hidden=false;nextView.classList.add('is-entering');
    requestAnimationFrame(()=>{nextView.classList.remove('is-entering');nextView.classList.add('is-entered');requestAnimationFrame(()=>nextView.classList.remove('is-entered'));});
  },150);
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-game-mode]'))button.addEventListener('click',()=>setMode(button.dataset.gameMode||'survival'));
function inspector(title:string,paragraphs:string[],href?:string,label='VIEW FULL PROFILE'):void{
  document.getElementById('survival-inspector-title')!.textContent=title;const body=document.getElementById('survival-inspector-body')!;body.replaceChildren();
  for(const text of paragraphs){const p=document.createElement('p');p.textContent=text;body.append(p);}
  if(href){const a=document.createElement('a');a.href=href;a.className='button';a.textContent=label;body.append(a);}
}
function paintSurvival():void{
  if(!snapshot)return;flashStat('survival-alive',`${snapshot.agents.filter(a=>a.status==='alive').length} / ${snapshot.agents.length}`);
  const leader=snapshot.agents.find(a=>a.id===snapshot!.leader_id);
  flashStat('survival-round',String(snapshot.round).padStart(2,'0'));flashStat('survival-fights',String(snapshot.engagements.filter(e=>e.status==='fighting').length));
  flashStat('survival-leader',leader?.name||'—');flashStat('survival-eliminated',String(snapshot.agents.filter(a=>a.status==='eliminated').length));
  const overlay=document.getElementById('survival-overlay')!;overlay.hidden=true;survivalStatus.textContent=`${snapshot.status.toUpperCase()}${snapshot.status==='finished'&&leader?' · WINNER '+leader.name:''} · MATCH ${snapshot.match_id} · SEQ ${snapshot.sequence}`;
  survivalRenderer??=new SurvivalRenderer(survivalCanvas);survivalRenderer.render(snapshot,selection);
  paintRoster(snapshot);paintResult(snapshot);observeSurvivalEvents(snapshot);
  if(selection?.kind==='agent'){
    const a=snapshot.agents.find(agent=>agent.id===selection!.id);if(!a){selection=undefined;return;}
    const engagement=snapshot.engagements.find(e=>e.attacker_id===a.id||e.target_id===a.id);const target=engagement&&snapshot.agents.find(v=>v.id===(engagement.attacker_id===a.id?engagement.target_id:engagement.attacker_id));
    const m=a.metrics;inspector(a.name.toUpperCase(),[`Strategy: ${a.strategy}`,`HP: ${a.hp} / ${a.max_hp}`,`Target: ${target?.name||'None'}`,`Status: ${a.status}`,`Recent action: ${a.recent_action}`,`Research: ${a.research||'No recent structured research.'}`,`Record: ${a.wins} wins · ${a.losses} losses`,...(m?[`Combat: ${m.attacks_landed} hits · ${m.damage_dealt} dealt · ${m.damage_taken} taken`,`Survival: ${m.time_alive} rounds · ${m.retreat_count} retreats · ${m.times_cornered} cornered · ${m.escapes} escapes`,`Placement: ${m.final_placement===null?'in progress':`#${m.final_placement}`}`]:[])],`/world?agent=${encodeURIComponent(a.id)}`);
  }else if(selection?.kind==='fight'){
    const e=snapshot.engagements.find(f=>f.id===selection!.id);if(!e){selection=undefined;return;}
    const a=snapshot.agents.find(v=>v.id===e.attacker_id)!,b=snapshot.agents.find(v=>v.id===e.target_id)!;
    inspector(`${a.name.toUpperCase()} VS ${b.name.toUpperCase()}`,[`${a.name}: ${a.hp} / ${a.max_hp} HP · ${e.status}`,`${b.name}: ${b.hp} / ${b.max_hp} HP · ${e.status}`,`Recent damage: ${e.recent_damage??'—'}`,...e.recent_actions.slice(-4)]);
  }else inspector('LIVE SURVIVAL MATCH',[`Match ${snapshot.match_id} · round ${snapshot.round}`,`${snapshot.engagements.length} active engagements`,...snapshot.events.slice(-5).reverse().map(event=>`R${event.round} · ${event.summary}`)]);
}
survivalCanvas.addEventListener('pointerdown',event=>{if(!snapshot)return;const p=survivalRenderer?.point(event,snapshot);if(!p)return;selection=hitTest(snapshot,p.x,p.y,survivalRenderer?.positions());paintSurvival();});
async function refreshSurvival():Promise<void>{
  if(stopped)return;
  try{const next=await loadSurvivalSnapshot();if(acceptsSurvivalUpdate(snapshot,next)){snapshot=next;if(gameMode==='survival')paintSurvival();else{observeSurvivalEvents(next);paintRoster(next);paintResult(next);}renderLiveBoard();}}
  catch(error){if(!snapshot){document.getElementById('survival-overlay')!.hidden=false;survivalStatus.textContent=error instanceof Error&&error.message.includes('404')?'SURVIVAL FEED NOT AVAILABLE':'SURVIVAL FEED UNAVAILABLE';}else survivalStatus.textContent='CONNECTION INTERRUPTED · LAST SERVER SNAPSHOT SHOWN';}
  if(!stopped)window.setTimeout(()=>void refreshSurvival(),1500);
}
function node(tag:string,text:string,parent:HTMLElement):HTMLElement{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}
function roomLabel(status:string):string{return status==='live'||status==='starting'?'FIGHTING':status==='finished'?'JUST FINISHED':status==='failed'?'ROOM PAUSED':status==='resetting'?'RESETTING':'QUEUED';}
const roomSignatures=new Map<string,string>();
function createRoomCard(room:ArenaRoom):HTMLElement{
  const card=document.createElement('article');card.id='room-'+room.id;card.className='room-card';
  const head=document.createElement('header');head.className='room-card__head';
  const eyebrow=document.createElement('p');eyebrow.className='eyebrow';eyebrow.textContent=room.id.toUpperCase();
  const state=document.createElement('p');state.className='room-state';
  head.append(eyebrow,state);
  const title=document.createElement('h2');title.textContent=room.game==='rps'?'Rock Paper Scissors':'Tic-Tac-Toe';
  const players=document.createElement('div');players.className='room-players room-stage';
  const link=document.createElement('a');link.href=gateway.watchMatch(room);link.textContent='Watch this room →';link.className='button room-watch';
  card.append(head,title,players,link);rooms.append(card);return card;
}
async function refresh():Promise<void>{
  if(stopped)return;
  try{
    const list=await gateway.listRooms();
    roomCache=list;
    renderLiveBoard();
    // Preserve focused room links between polls.
    for(const room of list){
      let card=document.getElementById('room-'+room.id) as HTMLElement|null;
      if(!card){card=createRoomCard(room);if(!reduceMotion.matches)card.classList.add('is-entering');}
      card.dataset.status=room.status;
      card.querySelector('.room-state')!.textContent=`${roomLabel(room.status)} · ${room.phase.toUpperCase()} · ${room.spectators||0} WATCHING`;
      card.hidden=gameMode!=='survival'&&!card.id.startsWith(gameMode==='rps'?'room-rps-':'room-ttt-');
      const players=card.querySelector<HTMLElement>('.room-players')!;
      const signature=room.participants.map(agent=>`${agent.id}:${agent.sprite}:${agent.name}`).join('|')+`|${room.status==='live'||room.status==='starting'}`;
      if(signature!==roomSignatures.get(room.id)){
        roomSignatures.set(room.id,signature);players.replaceChildren();
        if(room.participants.length===2){
          for(const [index,agent] of room.participants.entries()){
            const box=node('div','',players);box.className=`room-player${room.status==='live'||room.status==='starting'?' fighting':''}`;box.setAttribute('aria-label',`${agent.name}${room.status==='live'||room.status==='starting'?', fighting':''}`);
            const img=document.createElement('img');img.src='/'+agent.sprite;img.alt='';img.width=58;img.height=58;img.decoding='async';box.append(img);node('span',agent.name,box);
            if(index===0)node('span','VS',players).className='room-versus';
          }
        }else node('p',room.status==='failed'?'This room paused after an error.':'Pairing the next agents…',players).className='room-empty';
      }
      const previous=card.dataset.feedState;
      const feedState=`${room.status}|${room.phase}`;
      card.dataset.feedState=feedState;
      if(previous&&previous!==feedState&&room.participants.length===2){
        const names=room.participants.map(agent=>agent.name).join(' vs ');
        pushFeed({key:`room-${room.id}-${feedState}-${Date.now()}`,kind:'room',tag:room.id.toUpperCase(),round:room.phase.toUpperCase(),text:`${names} · ${roomLabel(room.status)}`});
      }
    }
    const fighting=list.filter(room=>room.status==='live'||room.status==='starting').length;
    const queued=list.filter(room=>room.status==='waiting'||room.status==='resetting').length;
    const finished=list.filter(room=>room.status==='finished').length;
    status.textContent=`${fighting} fighting · ${queued} queued · ${finished} just finished · pairings update live`;
    updateFeedStatus(fighting);
    renderFeed();
  }catch{status.textContent='The Arena is unavailable. Reconnecting… Existing room links remain available.';}
  if(!stopped)setTimeout(refresh,1500);
}
let liveRooms=0;
function updateFeedStatus(fighting?:number):void{
  if(typeof fighting==='number')liveRooms=fighting;
  const parts=[`SEQ ${snapshot?.sequence??'—'}`,liveRooms?`${liveRooms} FIGHTING`:'NO LIVES NOW',snapshot?`${snapshot.agents.filter(agent=>agent.status==='alive').length} ALIVE`:'CONNECTING'];
  feedStatus.textContent=`SERVER EVENT STREAM · ${parts.join(' · ')}`;
}

/* ---------------------------------------------------------------
   Live match board and recent results. The board merges only data
   the server already exposes: live human duels, autonomous rooms
   and the authoritative Survival snapshot. Watching is read-only.
   --------------------------------------------------------------- */
const AVATAR_PREVIEWS:Record<string,string>={
  visitor_starter:'/assets/avatars/clean/starter_preview.png',
  visitor_ember:'/assets/avatars/clean/ember_preview.png',
  visitor_atlas:'/assets/avatars/clean/atlas_preview.png',
  visitor_nova:'/assets/avatars/clean/nova_preview.png',
  visitor_echo:'/assets/avatars/clean/echo_preview.png',
};
const liveMatches=document.getElementById('live-matches') as HTMLElement;
const liveEmpty=document.getElementById('live-empty') as HTMLElement;
const liveBoardStatus=document.getElementById('live-board-status') as HTMLElement;
const recentList=document.getElementById('recent-list') as HTMLElement;
const recentEmpty=document.getElementById('recent-empty') as HTMLElement;
const recentStatus=document.getElementById('recent-status') as HTMLElement;
const GAME_SHORT:Record<string,string>={rps:'RPS',tictactoe:'TTT',survival:'SURV'};
const GAME_LONG:Record<string,string>={rps:'ROCK PAPER SCISSORS',tictactoe:'TIC-TAC-TOE',survival:'SURVIVAL MELEE'};
let roomCache:ArenaRoom[]=[];
let duelCache:LiveDuelBoard={live:[],recent:[]};
let historyCache:MatchRecord[]=[];
let liveSignature='',recentSignature='';
const isLiveRoom=(room:ArenaRoom):boolean=>room.status==='live'||room.status==='starting';
const avatarPreview=(avatar:string):string=>AVATAR_PREVIEWS[avatar]||AVATAR_PREVIEWS.visitor_starter!;
function duelState(duel:LiveDuel):string{
  if(duel.game==='rps'){
    const locked=(duel.locked||[]).filter(Boolean).length;
    return locked>=2?'BOTH LOCKED':`${locked}/2 LOCKED`;
  }
  const turn=duel.players.find(player=>player.player_id===duel.turn_player_id);
  return turn?`TURN · ${turn.name.toUpperCase()}`:'LIVE';
}
function tableState(room:ArenaRoom):string{
  return `${room.status==='live'?'FIGHTING':room.status==='starting'?'STARTING':room.status.toUpperCase()} · ${room.phase.toUpperCase()}${room.spectators?` · ${room.spectators} WATCHING`:''}`;
}
interface LiveRow {key:string;source:'human'|'table'|'survival';game:string;players:{name:string;image?:string}[];state:string;href?:string;survival?:boolean}
function liveRows():LiveRow[]{
  const rows:LiveRow[]=[];
  for(const duel of duelCache.live){
    if(duel.status!=='playing')continue;
    rows.push({key:`h-${duel.duel_id}`,source:'human',game:duel.game,
      players:duel.players.map(player=>({name:player.name,image:avatarPreview(player.avatar)})),
      state:duelState(duel),href:`/duel/${encodeURIComponent(duel.duel_id)}?spectate=1`});
  }
  for(const room of roomCache){
    if(!isLiveRoom(room)||room.participants.length<2)continue;
    rows.push({key:`t-${room.id}`,source:'table',game:room.game,
      players:room.participants.map(agent=>({name:agent.name,image:'/'+agent.sprite})),
      state:tableState(room),href:gateway.watchMatch(room)});
  }
  if(snapshot&&snapshot.status!=='finished'&&snapshot.agents.length){
    const alive=snapshot.agents.filter(agent=>agent.status==='alive');
    const leader=snapshot.agents.find(agent=>agent.id===snapshot!.leader_id);
    rows.push({key:'s-survival',source:'survival',game:'survival',
      players:[{name:leader?leader.name:'FIELD',image:leader?'/'+leader.sprite:undefined},{name:`${alive.length} ALIVE`}],
      state:`ROUND ${String(snapshot.round).padStart(2,'0')} · ${snapshot.engagements.filter(value=>value.status==='fighting').length} FIGHTS`,survival:true});
  }
  return rows;
}
function liveRowElement(row:LiveRow):HTMLElement{
  const card=document.createElement('article');card.className='live-match';card.dataset.liveKey=row.key;card.dataset.source=row.source;
  const game=document.createElement('span');game.className='live-match__game';game.textContent=GAME_SHORT[row.game]||row.game.toUpperCase();
  const players=document.createElement('div');players.className='live-match__players';
  row.players.forEach((player,index)=>{
    if(index)players.append(Object.assign(document.createElement('span'),{className:'live-match__vs',textContent:'VS'}));
    const chip=document.createElement('span');chip.className='live-match__player';
    if(player.image){const img=document.createElement('img');img.src=player.image;img.alt='';img.width=24;img.height=24;img.decoding='async';img.loading='lazy';chip.append(img);}
    const name=document.createElement('b');name.textContent=player.name.toUpperCase();chip.append(name);players.append(chip);
  });
  const state=document.createElement('span');state.className='live-match__state';state.textContent=row.state;
  card.append(game,players,state);
  if(row.href){const link=document.createElement('a');link.className='live-match__watch';link.href=row.href;link.textContent='WATCH';link.setAttribute('aria-label',`Watch ${GAME_LONG[row.game]||row.game} match read-only`);card.append(link);}
  else if(row.survival){const watch=document.createElement('button');watch.type='button';watch.className='live-match__watch';watch.textContent='WATCH';watch.dataset.watch='survival';watch.setAttribute('aria-label','Watch the live Survival match');card.append(watch);}
  return card;
}
function retargetKeyed(container:HTMLElement,attr:string,keys:string[]):void{
  const desired=new Set(keys);
  for(const child of Array.from(container.children)){
    if(!(child instanceof HTMLElement)||!child.dataset[attr])continue;
    if(desired.has(child.dataset[attr]!)||child.classList.contains('is-leaving'))continue;
    child.classList.add('is-leaving');
    const remove=()=>child.remove();
    child.addEventListener('animationend',remove,{once:true});
    window.setTimeout(remove,reduceMotion.matches?0:240);
  }
}
function renderLiveBoard():void{
  const rows=liveRows();
  const signature=rows.map(row=>`${row.key}:${row.state}:${row.players.map(player=>player.name).join('/')}`).join('|');
  if(signature===liveSignature)return;
  liveSignature=signature;
  withFlip(liveMatches,'liveKey',()=>{
    retargetKeyed(liveMatches,'liveKey',rows.map(row=>row.key));
    const existing=new Map<string,HTMLElement>();
    for(const child of Array.from(liveMatches.children))if(child instanceof HTMLElement&&child.dataset.liveKey)existing.set(child.dataset.liveKey,child);
    for(const row of rows){
      let node=existing.get(row.key);
      if(!node){node=liveRowElement(row);if(!reduceMotion.matches){node.classList.add('is-entering');requestAnimationFrame(()=>requestAnimationFrame(()=>node!.classList.remove('is-entering')));}}
      liveMatches.append(node);
    }
  });
  const human=rows.filter(row=>row.source==='human').length;
  const tables=rows.filter(row=>row.source==='table').length;
  liveBoardStatus.textContent=rows.length?`${human} HUMAN · ${tables} TABLE${tables===1?'':'S'}`: 'NO LIVE MATCHES';
  liveEmpty.hidden=rows.length>0;
}
liveMatches.addEventListener('click',event=>{
  const target=event.target;
  if(target instanceof Element&&target.closest<HTMLElement>('[data-watch="survival"]'))setMode('survival');
});
interface RecentRow {key:string;source:'human'|'table';game:string;players:string;state:string;stamp:string}
function recentRows():RecentRow[]{
  const rows:RecentRow[]=[];
  for(const duel of duelCache.recent){
    if(duel.status==='expired')continue;
    const winner=duel.result==='draw'?null:duel.players.find(player=>player.player_id===duel.winner_player_id);
    rows.push({key:`h-${duel.duel_id}`,source:'human' as const,game:duel.game,players:duel.players.map(player=>player.name).join(' vs '),
      state:duel.result==='draw'?'DRAW':winner?`${winner.name.toUpperCase()} WON`:'COMPLETE',stamp:duel.finished_at||duel.created_at});
  }
  for(const match of historyCache){
    const winner=match.result==='draw'?null:match.players[match.result==='a'?0:1];
    rows.push({key:`t-${match.runId}-${match.id}`,source:'table' as const,game:match.game,players:match.players.map(player=>player.name).join(' vs '),
      state:match.result==='draw'?'DRAW':winner?`${winner.name.toUpperCase()} WON`:'COMPLETE',stamp:match.completedAt});
  }
  return rows.sort((a,b)=>String(b.stamp).localeCompare(String(a.stamp))).slice(0,8);
}
function renderRecent():void{
  const rows=recentRows();
  const signature=rows.map(row=>`${row.key}:${row.state}`).join('|');
  if(signature===recentSignature)return;
  recentSignature=signature;
  retargetKeyed(recentList,'recentKey',rows.map(row=>row.key));
  const existing=new Map<string,HTMLElement>();
  for(const child of Array.from(recentList.children))if(child instanceof HTMLElement&&child.dataset.recentKey)existing.set(child.dataset.recentKey,child);
  for(const row of rows){
    let item=existing.get(row.key);
    if(!item){
      item=document.createElement('li');item.className='recent-row';item.dataset.recentKey=row.key;
      const tag=document.createElement('span');tag.className='recent-row__tag';tag.dataset.source=row.source;
      const game=document.createElement('span');game.className='recent-row__game';
      const players=document.createElement('span');players.className='recent-row__players';
      const state=document.createElement('strong');state.className='recent-row__state';
      const stamp=document.createElement('time');stamp.className='recent-row__time';
      item.append(tag,game,players,state,stamp);
      if(!reduceMotion.matches){item.classList.add('is-entering');requestAnimationFrame(()=>requestAnimationFrame(()=>item!.classList.remove('is-entering')));}
    }
    const source=row.source==='human'?'HUMAN':'TABLE';
    (item.querySelector('.recent-row__tag') as HTMLElement).textContent=source;
    (item.querySelector('.recent-row__game') as HTMLElement).textContent=GAME_SHORT[row.game]||row.game.toUpperCase();
    (item.querySelector('.recent-row__players') as HTMLElement).textContent=row.players;
    (item.querySelector('.recent-row__state') as HTMLElement).textContent=row.state;
    const time=item.querySelector('.recent-row__time') as HTMLTimeElement;
    time.textContent=row.stamp?new Date(row.stamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—';
    time.dateTime=row.stamp||'';
    recentList.append(item);
  }
  recentEmpty.hidden=rows.length>0;
  recentStatus.textContent=rows.length?`LAST ${rows.length} RESULTS`:'NO RESULTS YET';
}
async function refreshDuels():Promise<void>{
  if(stopped)return;
  try{duelCache=await gateway.liveDuels();if(!stopped){renderLiveBoard();renderRecent();}}
  catch{liveBoardStatus.textContent='LIVE BOARD RECONNECTING…';}
  if(!stopped)window.setTimeout(()=>void refreshDuels(),2_000);
}
async function refreshHistory():Promise<void>{
  if(stopped)return;
  try{historyCache=await gateway.history();if(!stopped)renderRecent();}
  catch{/* The live board still works without retained history. */}
  if(!stopped)window.setTimeout(()=>void refreshHistory(),5_000);
}
async function profiles():Promise<void>{
  if(stopped)return;
  try{
    const list=await gateway.getAgentProfiles();if(stopped)return;
    document.getElementById('agents-unavailable')?.remove();
    for(const profile of list){
      let a=document.getElementById('agent-'+profile.id) as HTMLAnchorElement|null;
      if(!a){a=document.createElement('a');a.id='agent-'+profile.id;a.href='/world?agent='+encodeURIComponent(profile.id);a.className='button';agents.append(a);}
      a.dataset.status=profile.arenaStatus;
      const state=profile.arenaStatus==='fighting'?`FIGHTING · ${profile.roomId}`:profile.arenaStatus==='finished'?'JUST FINISHED':'QUEUED';
      a.textContent=`${profile.recentWinner?'♛ ':''}${profile.name} · ${state} · ${profile.matches} matches / ${profile.wins} wins`;
    }
  }catch{
    if(!stopped&&!document.getElementById('agents-unavailable')){const warning=node('p','Agent profiles are temporarily unavailable. Reconnecting…',agents);warning.id='agents-unavailable';}
  }
  if(!stopped)setTimeout(profiles,5000);
}
const cumulativeTotals=document.getElementById('cumulative-totals') as HTMLElement;
const cumulativeGames=document.getElementById('cumulative-games') as HTMLElement;
const cumulativeLeaders=document.getElementById('cumulative-leaders') as HTMLElement;
const cumulativeStatus=document.getElementById('cumulative-status') as HTMLElement;
const formatNumber=(value:number):string=>Number(value||0).toLocaleString();
function cumulativeCard(label:string,value:number):HTMLElement{
  const card=document.createElement('div');card.className='cumulative-total';
  const strong=document.createElement('strong');strong.textContent=formatNumber(value);
  const small=document.createElement('small');small.textContent=label;
  card.append(strong,small);return card;
}
async function refreshCumulative():Promise<void>{
  if(stopped)return;
  try{
    const stats=await gateway.statistics();if(stopped)return;
    cumulativeStatus.textContent=stats.cumulative
      ?`ALL-TIME · ${stats.updated_at?`last match ${new Date(stats.updated_at).toLocaleString()}`:'updating live'}`
      :'NO CUMULATIVE MATCHES YET · SHOWING RETAINED RUNS';
    cumulativeTotals.replaceChildren(
      cumulativeCard('MATCHES SETTLED',stats.totals.matches),
      cumulativeCard('DECISIONS',stats.totals.decisions),
      cumulativeCard('DRAWS',stats.totals.draws),
      cumulativeCard('AGENTS RANKED',stats.agents.length),
    );
    cumulativeGames.replaceChildren();
    for(const [game,title] of [['rps','ROCK PAPER SCISSORS'],['tictactoe','TIC-TAC-TOE'],['survival','SURVIVAL MELEE']] as const){
      const summary=stats.games[game],row=document.createElement('div');row.className='cumulative-game';
      const label=document.createElement('span');label.textContent=title;
      const value=document.createElement('strong');value.textContent=`${formatNumber(summary.matches)} matches · ${formatNumber(summary.decisions)} decisions · ${formatNumber(summary.draws)} draws`;
      row.append(label,value);cumulativeGames.append(row);
    }
    cumulativeLeaders.replaceChildren();
    if(!stats.agents.length){const empty=document.createElement('p');empty.textContent='No completed matches yet. The first result starts the all-time board.';cumulativeLeaders.append(empty);}
    for(const [index,agent] of stats.agents.slice(0,8).entries()){
      const row=document.createElement('a');row.className='cumulative-agent';row.href='/world?agent='+encodeURIComponent(agent.id);
      const rank=document.createElement('span');rank.className='cumulative-rank';rank.textContent=String(index+1).padStart(2,'0');
      const identity=document.createElement('span');identity.className='cumulative-identity';
      const name=document.createElement('strong');name.textContent=`${agent.recentWinner?'♛ ':''}${agent.name}`;
      const record=document.createElement('small');record.textContent=`${formatNumber(agent.wins)}W · ${formatNumber(agent.losses)}L · ${formatNumber(agent.draws)}D · ${formatNumber(agent.matches)} matches · ${agent.win_rate}%`;
      identity.append(name,record);
      const survived=document.createElement('span');survived.className='cumulative-survival';
      survived.textContent=agent.survival?.matches?`SURVIVAL ${formatNumber(agent.survival.wins)}–${formatNumber(agent.survival.losses)}`:'';
      row.append(rank,identity,survived);cumulativeLeaders.append(row);
    }
  }catch{cumulativeStatus.textContent='CUMULATIVE STATISTICS UNAVAILABLE · RETRYING…';}
  if(!stopped)setTimeout(()=>void refreshCumulative(),5000);
}
updateFeedStatus();
setMode('survival');void refresh();void profiles();void refreshSurvival();void refreshCumulative();void refreshDuels();void refreshHistory();
