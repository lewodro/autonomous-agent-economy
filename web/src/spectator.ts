import type {Replay,State,GameEvent} from './types.js';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function setHTML(id:string,html:string){const node=document.getElementById(id);if(node&&node.innerHTML!==html)node.innerHTML=html;}
const noteworthy=new Set(['WorkCompleted','GuardRaised','ChallengeStarted','ChallengeResolved','AllianceCreated','AllianceBroken','AgentEliminated','WinnerDeclared']);
export class SpectatorHUD {
 private acting:string|null=null;
 render(run:Replay,state:State,cursor:number,playing:boolean,waiting:boolean,session:string,event?:GameEvent){
  if(event?.type==='ActionStarted')this.acting=event.actor;
  if(!event||event?.type==='RoundEnded')this.acting=null;
  const badge=document.getElementById('live')!;
  const status=state.ended?'ENDED':!session?'HISTORY':waiting?'THINKING':playing?'LIVE':state.turn?'PAUSED':'READY';
  badge.textContent=status;badge.dataset.state=status.toLowerCase();
  document.getElementById('active-agent')!.textContent=waiting?'Agents are choosing…':this.acting?`${run.config.agents.find(a=>a.id===this.acting)?.name} acts`:state.ended?'Table cleared':playing?'Decisions resolving':state.turn?`${session?'Paused at':'Recorded'} turn ${state.turn}`:'Your table is ready';
  const current=run.events.slice(0,cursor).filter(e=>e.turn===state.turn);
  const resolved=new Set(current.filter(e=>e.type==='ActionResolved').map(e=>e.actor));
  const choices=current.filter(e=>e.type==='AgentActionSelected');
  setHTML('action-queue',choices.map(e=>`<span class="queue-chip ${e.actor===this.acting?'acting':''} ${resolved.has(e.actor)?'resolved':''}"><b>${escape(run.config.agents.find(a=>a.id===e.actor)?.name||'')}</b> ${escape(e.decision?.action||'')} ${resolved.has(e.actor)?'✓':''}</span>`).join(''));
  const feed=run.events.slice(0,cursor).filter(e=>noteworthy.has(e.type)).slice(-8).reverse();
  setHTML('live-feed',feed.map(e=>`<p class="feed-line ${e.type==='AgentEliminated'?'out':''}"><span>T${String(e.turn).padStart(2,'0')}</span>${escape(e.reason)}</p>`).join('')||'<p class="feed-line">Choose your rivals. Press Play.</p>');
 }
}
