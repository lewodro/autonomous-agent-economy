import {parseSurvivalSnapshot,SurvivalRenderer,type SurvivalSnapshot} from './survival.js';

type Room={id:string;game:'rps'|'tictactoe';status:string;phase:string;matchId:string|null};
type History={game:string;id:string;result:string;roomId:string;completedAt?:string};
type View={started:boolean;rooms:Room[];survival:unknown;history:History[];statistics:{totals:{matches:number;decisions:number;draws:number}}};
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const start=$<HTMLButtonElement>('start'),stop=$<HTMLButtonElement>('stop'),status=$<HTMLElement>('status'),rooms=$<HTMLElement>('rooms'),history=$<HTMLElement>('history'),canvas=$<HTMLCanvasElement>('survival-field'),summary=$<HTMLElement>('survival-summary'),title=$<HTMLElement>('survival-title');
let renderer:SurvivalRenderer|undefined,stopped=false,refreshTimer=0;
function text(parent:HTMLElement,value:string):void{const p=document.createElement('p');p.textContent=value;parent.append(p);}
function paint(view:View):void{
  status.textContent=view.started?'AUTONOMOUS · PRIVATE TO THIS BROWSER':'PAUSED · PRIVATE STATE RETAINED';
  start.disabled=view.started;stop.disabled=!view.started;
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
window.addEventListener('pagehide',()=>{stopped=true;window.clearTimeout(refreshTimer);});
void refresh();
