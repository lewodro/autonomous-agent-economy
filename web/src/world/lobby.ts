import { HttpArenaGateway } from './gateway.js';
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
void refresh();void profiles();
