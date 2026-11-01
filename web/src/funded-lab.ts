import {formatSol,formatInternalCredits,fundingStatus,type PublicEconomy} from './economy-hud.js';
const $=(id:string)=>document.getElementById(id)!;
const sessions=$('sessions') as HTMLSelectElement,agent=$('agent') as HTMLSelectElement;
let session='';
const mode=$('mode') as HTMLSelectElement,entry=$('entry') as HTMLSelectElement;
function updateModeCopy(paymentMode:string):void{
 const mock=paymentMode==='mock';
 $('entry-label').firstChild!.textContent=mock?'Risk · credits ':'Entry · test SOL ';
 entry.setAttribute('aria-label',mock?'Risk per agent':'Test SOL entry');
 for(const option of [...entry.options])option.textContent=mock?`${Number(option.value)*100} credits`:`${option.value} test SOL`;
 $('address-heading').textContent=mock?'Account type':'Public address';
 $('balance-heading').textContent=mock?'Capital · credits':'Balance · test SOL';
 agent.setAttribute('aria-label',mock?'Commit agent credits':'Fund agent with test SOL');
 const actions:[string,string,string][]=[['fund','Commit selected','Fund selected'],['fund-all','Commit all','Fund all'],['cancel','Cancel / return credits','Cancel / refund'],['reconcile','Verify records','Verify known transactions']];
 for(const [action,mockText,localText] of actions)document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.textContent=mock?mockText:localText;
}
async function request(path:string,body?:unknown){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
function render(data:{economy:PublicEconomy&{wallets:{account:string;address:string|null;balance:string|null}[]};replay:{final_state:{winner:string|null}}}){
 const v=data.economy,mock=v.economy.payment_mode==='mock',amount=(value:string)=>mock?formatInternalCredits(value):`${formatSol(value)} test SOL`;session=v.session;mode.value=v.economy.payment_mode;updateModeCopy(v.economy.payment_mode);
 $('status').textContent=`${v.economy.state.toUpperCase()} · ${v.economy.funded_agents.length}/${v.economy.required_agents.length} ${mock?'committed':'funded'} · POOL ${amount(v.economy.pot_amount)} / ${amount(v.expected_pot)}${data.replay.final_state.winner?' · winner '+data.replay.final_state.winner:''}`;
 const selected=agent.value;agent.replaceChildren(...v.economy.required_agents.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;return o;}));if(selected&&v.economy.required_agents.includes(selected))agent.value=selected;
 $('wallets').replaceChildren(...v.wallets.map(w=>{const row=document.createElement('tr');for(const text of [w.account,mock?'Internal account':w.address||'Address unavailable',w.balance===null?mock?'Unavailable':'RPC unavailable':amount(w.balance),v.economy.required_agents.includes(w.account)?fundingStatus(v,w.account):'escrow']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}return row;}));
 $('output').textContent=JSON.stringify(v,null,2);const link=$('watch') as HTMLAnchorElement;link.hidden=false;link.href=`/?watch=${encodeURIComponent(session)}`;link.target='_blank';
}
async function execute(task:()=>Promise<void>){const buttons=document.querySelectorAll<HTMLButtonElement>('button');buttons.forEach(b=>b.disabled=true);try{await task();}catch(error){$('status').textContent=(error as Error).message;}finally{buttons.forEach(b=>b.disabled=false);}}
async function list(){const records=await request('/api/funded-matches');sessions.replaceChildren(...records.matches.map((r:{session:string;state:string})=>{const o=document.createElement('option');o.value=r.session;o.textContent=`${r.session.slice(0,8)} · ${r.state}`;return o;}));if(session)sessions.value=session;}
$('create').onclick=()=>{void execute(async()=>{const config=await request(`/api/config?agents=${($('seats') as HTMLSelectElement).value}`);render(await request('/api/funded-matches',{config,mode:mode.value,entry_amount_sol:entry.value}));await list();});};
$('load').onclick=()=>{void execute(async()=>{session=sessions.value;render(await request(`/api/funded-matches/${session}`));});};
$('refresh').onclick=()=>{void execute(async()=>{if(session)render(await request(`/api/funded-matches/${session}`));await list();});};
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-action]'))button.onclick=()=>{void execute(async()=>{if(!session)throw Error('Create or load a match');render(await request(`/api/funded-matches/${session}/${button.dataset.action}`,{agent_id:agent.value}));await list();});};
void execute(list);
mode.onchange=()=>updateModeCopy(mode.value);
