import {reduceEconomy,type EconomyView} from './economy.js';
export interface PublicEconomy {
 session:string;economy:EconomyView['match'];events:unknown[];expected_pot:string;funding_deadline:number;
 operations:{id:string;purpose:'entry'|'payout'|'refund';payer:string;status:string;amount:string;reference?:string|null}[];
 settlement:{status:string;payout_amount:string;winner_id:string}|null;
}
export function formatSol(units:string):string {
 if(!/^(0|[1-9]\d{0,19})$/.test(units))throw Error('Invalid lamports');
 const n=BigInt(units),whole=n/1000000000n,fraction=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');return whole.toString()+(fraction?'.'+fraction:'');
}
export function fundingStatus(view:PublicEconomy,id:string):string {
 if(view.economy.funded_agents.includes(id))return view.economy.state==='refunded'?'↩':'✓';
 return view.operations.some(o=>o.purpose==='entry'&&o.payer===id&&o.status!=='failed')?'◐':'○';
}
export class EconomyHUD {
 private view:PublicEconomy|null=null;
 private presentation:{turn:number;ended:boolean}|null=null;
 constructor(private root:HTMLElement,private error:(text:string)=>void){}
 clear(){this.view=null;this.root.hidden=true;}
 accept(raw:unknown){
  const data=raw as PublicEconomy;let projection:EconomyView|null=null;
  if(!data||!Array.isArray(data.events)||!Array.isArray(data.operations))throw Error('Invalid public economy snapshot');
  for(const e of data.events)projection=reduceEconomy(projection,e);
  if(!projection||JSON.stringify(projection.match)!==JSON.stringify(data.economy))throw Error('Snapshot differs from Rust economy events');
  formatSol(data.expected_pot);this.view=structuredClone(data);this.render();
 }
 decorate(){if(!this.view)return;for(const button of document.querySelectorAll<HTMLElement>('.agent-tab[data-agent]')){button.dataset.funding=fundingStatus(this.view,button.dataset.agent!);button.title=`Funding ${button.dataset.funding}`;}}
 present(turn:number,ended:boolean){
  this.presentation={turn,ended};const note=this.root.querySelector<HTMLElement>('.economy-presentation');
  if(note){note.hidden=!this.view||!['settled','refunded'].includes(this.view.economy.state)||ended;note.textContent=`HOST COMPLETE · WATCHING T${String(turn).padStart(2,'0')}`;}
 }
 private render(){
  const v=this.view!;const e=v.economy;this.root.hidden=false;this.root.replaceChildren();
  const label=document.createElement('span');label.className='pot-label';
  if(e.state==='settled'&&v.settlement?.status==='confirmed')label.textContent=`PAID · ${formatSol(v.settlement.payout_amount)} ${e.payment_mode==='mock'?'MOCK ':''}SOL → ${v.settlement.winner_id}`;
  else if(e.state==='funding')label.textContent=`POT ${formatSol(e.pot_amount)} / ${formatSol(v.expected_pot)} ${e.payment_mode==='mock'?'MOCK ':''}SOL · ${e.funded_agents.length}/${e.required_agents.length} FUNDED`;
  else label.textContent=`POT ${formatSol(e.pot_amount)} ${e.payment_mode==='mock'?'MOCK ':''}SOL · ${e.state==='running'?'LOCKED':e.state.replaceAll('_',' ').toUpperCase()}`;
  this.root.append(label);
  const presentation=document.createElement('small');presentation.className='economy-presentation';presentation.hidden=true;this.root.append(presentation);if(this.presentation)this.present(this.presentation.turn,this.presentation.ended);
  const status=document.createElement('span');status.className='funding-statuses';status.textContent=e.required_agents.map(id=>`${id} ${fundingStatus(v,id)}`).join(' · ');this.root.append(status);
  if(e.state==='funding')for(const [action,text] of [['fund-all','Fund test entries'],['cancel','Cancel / refund']]){const b=document.createElement('button');b.textContent=text!;b.className='small-button';b.onclick=async()=>{b.disabled=true;try{const r=await fetch(`/api/funded-matches/${encodeURIComponent(v.session)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await r.json();if(!r.ok)throw Error(result.error);this.accept(result.economy);}catch(error){this.error((error as Error).message);}finally{b.disabled=false;}};this.root.append(b);}
  this.decorate();
 }
}
