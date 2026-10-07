import { HttpArenaGateway } from './gateway.js';
import { loadSurvivalSnapshot, SurvivalRenderer, hitTest, type Selection, type SurvivalSnapshot } from './survival.js';
const gateway=new HttpArenaGateway(),rooms=document.getElementById('rooms')!,status=document.getElementById('lobby-status')!,agents=document.getElementById('arena-agents')!;
let stopped=false;window.addEventListener('pagehide',()=>stopped=true);
let gameMode='survival',snapshot:SurvivalSnapshot|undefined,selection:Selection|undefined,survivalRenderer:SurvivalRenderer|undefined;
const survivalCanvas=document.getElementById('survival-field') as HTMLCanvasElement;
const survivalStatus=document.getElementById('survival-status')!;
function setMode(mode:string):void{
  gameMode=mode;for(const button of document.querySelectorAll<HTMLButtonElement>('[data-game-mode]'))button.setAttribute('aria-pressed',String(button.dataset.gameMode===mode));
  const survival=mode==='survival';document.getElementById('survival-view')!.hidden=!survival;document.getElementById('rooms-view')!.hidden=survival;
  if(!survival){for(const card of rooms.querySelectorAll<HTMLElement>('.room-card'))card.hidden=!card.id.startsWith(mode==='rps'?'room-rps-':'room-ttt-');}
  else if(snapshot)paintSurvival();
}
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-game-mode]'))button.addEventListener('click',()=>setMode(button.dataset.gameMode||'survival'));
function inspector(title:string,paragraphs:string[],href?:string,label='VIEW FULL PROFILE'):void{
  document.getElementById('survival-inspector-title')!.textContent=title;const body=document.getElementById('survival-inspector-body')!;body.replaceChildren();
  for(const text of paragraphs){const p=document.createElement('p');p.textContent=text;body.append(p);}
  if(href){const a=document.createElement('a');a.href=href;a.className='button';a.textContent=label;body.append(a);}
}
function paintSurvival():void{
  if(!snapshot)return;document.getElementById('survival-alive')!.textContent=`${snapshot.agents.filter(a=>a.status==='alive').length} / ${snapshot.agents.length}`;
  document.getElementById('survival-round')!.textContent=String(snapshot.round).padStart(2,'0');document.getElementById('survival-fights')!.textContent=String(snapshot.engagements.filter(e=>e.status==='fighting').length);
  const leader=snapshot.agents.find(a=>a.id===snapshot!.leader_id);document.getElementById('survival-leader')!.textContent=leader?.name||'—';document.getElementById('survival-eliminated')!.textContent=String(snapshot.agents.filter(a=>a.status==='eliminated').length);
  const overlay=document.getElementById('survival-overlay')!;overlay.hidden=true;survivalStatus.textContent=`${snapshot.status.toUpperCase()}${snapshot.status==='finished'&&leader?' · WINNER '+leader.name:''} · MATCH ${snapshot.match_id} · SEQ ${snapshot.sequence}`;
  survivalRenderer??=new SurvivalRenderer(survivalCanvas);survivalRenderer.render(snapshot,selection);
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
survivalCanvas.addEventListener('pointerdown',event=>{if(!snapshot)return;const p=survivalRenderer?.point(event,snapshot);if(!p)return;selection=hitTest(snapshot,p.x,p.y);paintSurvival();});
async function refreshSurvival():Promise<void>{
  if(stopped)return;
  try{const next=await loadSurvivalSnapshot();if(!snapshot||next.sequence>=snapshot.sequence){snapshot=next;if(gameMode==='survival')paintSurvival();}}
  catch(error){if(!snapshot){document.getElementById('survival-overlay')!.hidden=false;survivalStatus.textContent=error instanceof Error&&error.message.includes('404')?'SURVIVAL FEED NOT AVAILABLE':'SURVIVAL FEED UNAVAILABLE';}else survivalStatus.textContent='CONNECTION INTERRUPTED · LAST SERVER SNAPSHOT SHOWN';}
  if(!stopped)window.setTimeout(()=>void refreshSurvival(),1500);
}
function node(tag:string,text:string,parent:HTMLElement):HTMLElement{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}
function roomLabel(status:string):string{return status==='live'||status==='starting'?'FIGHTING':status==='finished'?'JUST FINISHED':status==='failed'?'ROOM PAUSED':status==='resetting'?'RESETTING':'QUEUED';}
async function refresh():Promise<void>{
  if(stopped)return;
  try{
    const list=await gateway.listRooms();
    // Preserve focused room links between polls.
    for(const room of list){
      let card=document.getElementById('room-'+room.id);
      if(!card){card=node('article','',rooms);card.id='room-'+room.id;card.className='room-card';node('p',room.id.toUpperCase(),card).className='eyebrow';node('h2',room.game==='rps'?'Rock Paper Scissors':'Tic-Tac-Toe',card);node('p','',card).className='room-state';node('div','',card).className='room-players';const a=document.createElement('a');a.href=gateway.watchMatch(room);a.textContent='Watch this room →';a.className='button';card.append(a);}
      card.dataset.status=room.status;
      card.querySelector('.room-state')!.textContent=`${roomLabel(room.status)} · ${room.phase.toUpperCase()} · ${room.spectators||0} WATCHING`;
      card.hidden=gameMode!=='survival'&&!card.id.startsWith(gameMode==='rps'?'room-rps-':'room-ttt-');
      const players=card.querySelector<HTMLElement>('.room-players')!;players.replaceChildren();
      if(room.participants.length===2){
        for(const [index,agent] of room.participants.entries()){
          const box=node('div','',players);box.className=`room-player${room.status==='live'||room.status==='starting'?' fighting':''}`;box.setAttribute('aria-label',`${agent.name}${room.status==='live'||room.status==='starting'?', fighting':''}`);
          const img=document.createElement('img');img.src='/'+agent.sprite;img.alt='';box.append(img);node('span',agent.name,box);
          if(index===0)node('span','VS',players).className='room-versus';
        }
      }else node('p',room.status==='failed'?'This room paused after an error.':'Pairing the next agents…',players).className='room-empty';
    }
    const fighting=list.filter(room=>room.status==='live'||room.status==='starting').length;
    const queued=list.filter(room=>room.status==='waiting'||room.status==='resetting').length;
    const finished=list.filter(room=>room.status==='finished').length;
    status.textContent=`${fighting} fighting · ${queued} queued · ${finished} just finished · pairings update live`;
  }catch{status.textContent='The Arena is unavailable. Reconnecting… Existing room links remain available.';}
  if(!stopped)setTimeout(refresh,1500);
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
setMode('survival');void refresh();void profiles();void refreshSurvival();
