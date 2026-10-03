import {reduceEconomy,type EconomyView,type EconomyEvent} from './economy.js';
let view:EconomyView|null=null;
const status=document.getElementById('status')!,output=document.getElementById('output')!,agent=document.getElementById('agent') as HTMLSelectElement;
for(const button of document.querySelectorAll<HTMLButtonElement>('button[data-action]'))button.addEventListener('click',async()=>{
 const action=button.dataset.action;
 const buttons=document.querySelectorAll<HTMLButtonElement>('button');buttons.forEach(b=>b.disabled=true);
 try{
  const response=await fetch('/api/labs/economy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,agent_id:agent.value})});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  if(action==='reset')view=null;
  for(const event of data.events as EconomyEvent[])view=reduceEconomy(view,event);
  if(!view)throw Error('Missing Rust economy projection');
  const selected=agent.value;agent.replaceChildren(...view.match.required_agents.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;return o;}));if(selected)agent.value=selected;
  status.textContent=`${view.match.state.toUpperCase()} · ${view.match.funded_agents.length}/${view.match.required_agents.length} funded · pot ${view.match.pot_amount} mock base units${data.simulation.winner?' · winner '+data.simulation.winner:''}`;
  output.textContent=JSON.stringify(data,null,2);
 }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
 finally{buttons.forEach(b=>b.disabled=false);}
});
