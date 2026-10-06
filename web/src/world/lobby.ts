import { HttpArenaGateway } from './gateway.js';
const gateway=new HttpArenaGateway(),rooms=document.getElementById('rooms')!,status=document.getElementById('lobby-status')!,agents=document.getElementById('arena-agents')!;
let stopped=false;window.addEventListener('pagehide',()=>stopped=true);
function node(tag:string,text:string,parent:HTMLElement):HTMLElement{const n=document.createElement(tag);n.textContent=text;parent.append(n);return n;}
async function refresh():Promise<void>{
  if(stopped)return;
  try{
    const list=await gateway.listRooms();
    // Preserve focused room links between polls.
    for(const room of list){
      let card=document.getElementById('room-'+room.id);
      if(!card){card=node('article','',rooms);card.id='room-'+room.id;card.className='room-card';node('p',room.id.toUpperCase(),card).className='eyebrow';node('h2',room.game==='rps'?'Rock Paper Scissors':'Tic-Tac-Toe',card);node('p','',card).className='room-state';node('div','',card).className='room-players';const a=document.createElement('a');a.href=gateway.watchMatch(room);a.textContent='Enter room →';a.className='button';card.append(a);}
      card.querySelector('.room-state')!.textContent=room.status.toUpperCase()+' · '+room.phase.toUpperCase();
      const players=card.querySelector<HTMLElement>('.room-players')!;players.replaceChildren();
      for(const agent of room.participants){const box=node('div','',players);const img=document.createElement('img');img.src='/'+agent.sprite;img.alt='';box.append(img);node('span',agent.name,box);}
      if(!room.participants.length)node('p','Preparing the next pair…',players);
    }
    status.textContent=`${list.length} rooms online · results come from the game rules`;
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
      a.textContent=`${profile.recentWinner?'♛ ':''}${profile.name} · ${profile.matches} matches / ${profile.wins} wins`;
    }
  }catch{
    if(!stopped&&!document.getElementById('agents-unavailable')){const warning=node('p','Agent profiles are temporarily unavailable. Reconnecting…',agents);warning.id='agents-unavailable';}
  }
  if(!stopped)setTimeout(profiles,5000);
}
void refresh();void profiles();
