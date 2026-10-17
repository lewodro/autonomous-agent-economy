import {parseSurvivalSnapshot,SurvivalRenderer,type SurvivalSnapshot} from './survival.js';

type Room={id:string;game:'rps'|'tictactoe';status:string;phase:string;matchId:string|null};
type History={game:string;id:string;result:string;roomId:string;completedAt?:string};
type View={started:boolean;rooms:Room[];survival:unknown;history:History[];custom_agent:{name:string;sprite:string;strategy:string;mcp:{controller_type:string;endpoint:string|null}}|null;statistics:{totals:{matches:number;decisions:number;draws:number}}};
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const start=$<HTMLButtonElement>('start'),stop=$<HTMLButtonElement>('stop'),status=$<HTMLElement>('status'),rooms=$<HTMLElement>('rooms'),history=$<HTMLElement>('history'),canvas=$<HTMLCanvasElement>('survival-field'),summary=$<HTMLElement>('survival-summary'),title=$<HTMLElement>('survival-title'),agentForm=$<HTMLFormElement>('agent-form'),agentStatus=$<HTMLElement>('agent-status'),controller=$<HTMLSelectElement>('agent-controller'),mcpField=$<HTMLElement>('mcp-endpoint-field');
let renderer:SurvivalRenderer|undefined,stopped=false,refreshTimer=0;
function text(parent:HTMLElement,value:string):void{const p=document.createElement('p');p.textContent=value;parent.append(p);}
function paint(view:View):void{
  status.textContent=view.started?'AUTONOMOUS · PRIVATE TO THIS BROWSER':'PAUSED · PRIVATE STATE RETAINED';
  start.disabled=view.started;stop.disabled=!view.started;
  agentForm.querySelectorAll('input,select,button').forEach(element=>{(element as HTMLInputElement|HTMLSelectElement|HTMLButtonElement).disabled=view.started;});
  if(view.custom_agent){($('agent-name') as HTMLInputElement).value=view.custom_agent.name;($('agent-sprite') as HTMLSelectElement).value=view.custom_agent.sprite;($('agent-strategy') as HTMLSelectElement).value=view.custom_agent.strategy;controller.value=view.custom_agent.mcp.controller_type;($('mcp-endpoint') as HTMLInputElement).value=view.custom_agent.mcp.endpoint||'';mcpField.hidden=controller.value!=='mcp';agentStatus.textContent=`${view.custom_agent.name} · ${view.custom_agent.strategy} · ${view.custom_agent.mcp.controller_type.toUpperCase()} · private to this browser`;}else agentStatus.textContent='No private agent configured yet.';
  rooms.replaceChildren();
  if(!view.rooms.length)text(rooms,'No private rooms yet.');
  for(const room of view.rooms){const row=document.createElement('div');row.className='private-room';row.textContent=`${room.game.toUpperCase()} · ${room.status.toUpperCase()}${room.matchId?` · ${room.matchId}`:''}`;rooms.append(row);}
  history.replaceChildren();
  if(!view.history.length)text(history,'No private results yet.');
  for(const match of view.history.slice(0,20)){const row=document.createElement('div');row.className='private-history';row.textContent=`${match.game.toUpperCase()} · ${match.id} · ${match.result.toUpperCase()}${match.completedAt?` · ${new Date(match.completedAt).toLocaleString()}`:''}`;history.append(row);}
  try{const survival=parseSurvivalSnapshot(view.survival);renderer??=new SurvivalRenderer(canvas);renderer.render(survival);title.textContent=`SURVIVAL · ${survival.status.toUpperCase()} · ${survival.match_id}`;const alive=survival.agents.filter(agent=>agent.status==='alive').length;summary.textContent=`${alive}/${survival.agents.length} alive · round ${survival.round} · ${view.statistics.totals.matches} completed private matches`;}catch{title.textContent='SURVIVAL · WAITING';summary.textContent='Your private match begins when you start the arena.';}
}
async function request<T>(url:string,options?:RequestInit):Promise<T>{const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options?.headers||{})},signal:AbortSignal.timeout(8000)});const value=await response.json();if(!response.ok)throw new Error(value.error||'Private arena unavailable');return value as T;}
async function refresh():Promise<void>{if(stopped)return;try{paint(await request<View>('/api/private-arena'));}catch(error){status.textContent=(error as Error).message;}if(!stopped)refreshTimer=window.setTimeout(()=>void refresh(),1500);}
start.onclick=async()=>{start.disabled=true;try{paint(await request<View>('/api/private-arena/start',{method:'POST',body:'{}'}));}catch(error){status.textContent=(error as Error).message;start.disabled=false;}};
stop.onclick=async()=>{stop.disabled=true;try{paint(await request<View>('/api/private-arena/stop',{method:'POST',body:'{}'}));}catch(error){status.textContent=(error as Error).message;}};
controller.onchange=()=>{mcpField.hidden=controller.value!=='mcp';};
agentForm.onsubmit=async event=>{event.preventDefault();const payload={name:($('agent-name') as HTMLInputElement).value,sprite:($('agent-sprite') as HTMLSelectElement).value,strategy:($('agent-strategy') as HTMLSelectElement).value,mcp:{controller_type:controller.value,endpoint:($('mcp-endpoint') as HTMLInputElement).value||null,capabilities:['observe','intent']}};try{paint(await request<View>('/api/private-arena/agent',{method:'POST',body:JSON.stringify(payload)}));}catch(error){agentStatus.textContent=(error as Error).message;}};
window.addEventListener('pagehide',()=>{stopped=true;window.clearTimeout(refreshTimer);});
void refresh();
