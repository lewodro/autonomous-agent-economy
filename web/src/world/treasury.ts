interface TreasuryEvent { event_id:string; type:string; amount:number; asset:string; timestamp:string; status:string; reference_id:string; transaction_signature:string|null }
interface TreasurySnapshot {
  status:string; network:string; public_address:string|null; payouts_enabled:boolean; funded:boolean; asset:string;
  reserves:number|null; reward_allocation:number; outstanding_payouts:number; available_reward_budget:number;
  paid_lifetime:number; internal_credits_redeemable:false; recent_activity:TreasuryEvent[];
}

const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
function metric(label:string,value:string):HTMLElement {const node=document.createElement('article');node.className='treasury-metric';const strong=document.createElement('strong');strong.textContent=value;const span=document.createElement('span');span.textContent=label;node.append(strong,span);return node;}
function amount(value:number|null):string {return value===null?'NOT REPORTED':`${value.toLocaleString()} LAMPORTS`;}

async function load():Promise<void>{
  try{
    const response=await fetch('/api/treasury/public',{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('Treasury endpoint unavailable');
    const state=await response.json() as TreasurySnapshot;
    $('treasury-state').textContent=state.status==='not_funded'?'NOT FUNDED':state.payouts_enabled?'PAYOUT INFRASTRUCTURE CONFIGURED':'REAL PAYOUTS DISABLED';
    $('treasury-metrics').replaceChildren(
      metric('TREASURY RESERVE',amount(state.reserves)),metric('REWARD ALLOCATION',amount(state.reward_allocation)),
      metric('OUTSTANDING PAYOUTS',amount(state.outstanding_payouts)),metric('AVAILABLE REWARD BUDGET',amount(state.available_reward_budget)),
      metric('PAID LIFETIME',amount(state.paid_lifetime)),
    );
    const network=$('treasury-network');network.replaceChildren();
    for(const line of [`Network: ${state.network.toUpperCase()}`,`Public address: ${state.public_address||'NOT CONFIGURED'}`,`Real payouts: ${state.payouts_enabled?'ENABLED':'DISABLED'}`]){const p=document.createElement('p');p.textContent=line;network.append(p);}
    const events=$<HTMLOListElement>('treasury-events');events.replaceChildren();
    if(!state.recent_activity.length){const item=document.createElement('li');item.textContent='No real treasury activity has been recorded.';events.append(item);}
    for(const event of state.recent_activity){const item=document.createElement('li');item.textContent=`${event.type.replaceAll('_',' ')} · ${amount(event.amount)} · ${event.status} · ${new Date(event.timestamp).toLocaleString()}`;events.append(item);}
  }catch(error){$('treasury-state').textContent=error instanceof Error?error.message:'Treasury unavailable';}
}
void load();
