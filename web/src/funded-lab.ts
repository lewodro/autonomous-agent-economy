import {formatSol,fundingStatus,type PublicEconomy} from './economy-hud.js';
const $=(id:string)=>document.getElementById(id)!;
const sessions=$('sessions') as HTMLSelectElement,agent=$('agent') as HTMLSelectElement;
let session='';
async function request(path:string,body?:unknown){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
function render(data:{economy:PublicEconomy&{wallets:{account:string;address:string|null;balance:string|null}[]};replay:{final_state:{winner:string|null}}}){
 const v=data.economy;session=v.session;
 $('status').textContent=`${v.economy.state.toUpperCase()} · ${v.economy.funded_agents.length}/${v.economy.required_agents.length} funded · POT ${formatSol(v.economy.pot_amount)} / ${formatSol(v.expected_pot)} SOL${data.replay.final_state.winner?' · winner '+data.replay.final_state.winner:''}`;
 const selected=agent.value;agent.replaceChildren(...v.economy.required_agents.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;return o;}));if(selected&&v.economy.required_agents.includes(selected))agent.value=selected;
 $('wallets').replaceChildren(...v.wallets.map(w=>{const row=document.createElement('tr');for(const text of [w.account,w.address||'mock account',w.balance===null?'RPC unavailable':formatSol(w.balance),v.economy.required_agents.includes(w.account)?fundingStatus(v,w.account):'escrow']){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}return row;}));
 $('output').textContent=JSON.stringify(v,null,2);const link=$('watch') as HTMLAnchorElement;link.hidden=false;link.href=`/?watch=${encodeURIComponent(session)}`;link.target='_blank';
}
async function execute(task:()=>Promise<void>){const buttons=document.querySelectorAll<HTMLButtonElement>('button');buttons.forEach(b=>b.disabled=true);try{await task();}catch(error){$('status').textContent=(error as Error).message;}finally{buttons.forEach(b=>b.disabled=false);}}
async function list(){const records=await request('/api/funded-matches');sessions.replaceChildren(...records.matches.map((r:{session:string;state:string})=>{const o=document.createElement('option');o.value=r.session;o.textContent=`${r.session.slice(0,8)} · ${r.state}`;return o;}));if(session)sessions.value=session;}
$('create').onclick=()=>{void execute(async()=>{const config=await request(`/api/config?agents=${($('seats') as HTMLSelectElement).value}`);render(await request('/api/funded-matches',{config,mode:($('mode') as HTMLSelectElement).value,entry_amount_sol:($('entry') as HTMLSelectElement).value}));await list();});};
$('load').onclick=()=>{void execute(async()=>{session=sessions.value;render(await request(`/api/funded-matches/${session}`));});};
$('refresh').onclick=()=>{void execute(async()=>{if(session)render(await request(`/api/funded-matches/${session}`));await list();});};
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-action]'))button.onclick=()=>{void execute(async()=>{if(!session)throw Error('Create or load a match');render(await request(`/api/funded-matches/${session}/${button.dataset.action}`,{agent_id:agent.value}));await list();});};
void execute(list);
