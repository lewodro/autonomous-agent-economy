import { HttpArenaGateway, type AgentProfile } from './gateway.js';
const gateway=new HttpArenaGateway(),rooms=document.getElementById('rooms')!,status=document.getElementById('lobby-status')!,agents=document.getElementById('arena-agents')!;
let stopped=false;window.addEventListener('pagehide',()=>stopped=true);
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
    const pairPositions=new Map<string,number>();
    const priority=(profile:AgentProfile)=>profile.arenaStatus==='fighting'?0:profile.arenaStatus==='finished'?1:profile.arenaStatus==='queued'?2:3;
    const roster=[...list].sort((a,b)=>priority(a)-priority(b)||(a.arenaStatus==='fighting'&&b.arenaStatus==='fighting'?a.roomId!.localeCompare(b.roomId!):0)||a.name.localeCompare(b.name));
    for(const profile of roster){
      let a=document.getElementById('agent-'+profile.id) as HTMLAnchorElement|null;
      if(!a){a=document.createElement('a');a.id='agent-'+profile.id;agents.append(a);}
      a.href='/world?agent='+encodeURIComponent(profile.id);a.className='arena-agent';a.dataset.status=profile.arenaStatus;
      a.dataset.winner=String(profile.recentWinner);
      const state=profile.arenaStatus==='fighting'?`FIGHTING · ${profile.roomId}`:profile.arenaStatus==='finished'?'JUST FINISHED':profile.arenaStatus==='owned'?'OWNED · PLAZA':'QUEUED';
      const sideKey=profile.arenaStatus==='fighting'&&profile.roomId?profile.roomId:'';
      const sideIndex=sideKey?(pairPositions.get(sideKey)||0):0;
      if(sideKey)pairPositions.set(sideKey,sideIndex+1);
      a.dataset.side=sideIndex===0?'left':'right';a.setAttribute('aria-label',`${profile.name}, ${state}, ${profile.wins} wins from ${profile.matches} matches`);
      a.replaceChildren();
      const stage=node('span','',a);stage.className='arena-agent-stage';
      const image=document.createElement('img');image.className='arena-agent-sprite';image.src='/'+profile.sprite;image.alt='';image.loading='lazy';image.decoding='async';stage.append(image);
      const status=node('span',state,stage);status.className='arena-agent-status';
      const name=node('strong',`${profile.recentWinner?'♛ ':''}${profile.name}`,a);name.className='arena-agent-name';
      node('span',`${profile.strategy} · ${profile.wins}W / ${profile.matches}M`,a).className='arena-agent-record';
    }
  }catch{
    if(!stopped&&!document.getElementById('agents-unavailable')){const warning=node('p','Agent profiles are temporarily unavailable. Reconnecting…',agents);warning.id='agents-unavailable';}
  }
  if(!stopped)setTimeout(profiles,5000);
}
void refresh();void profiles();
