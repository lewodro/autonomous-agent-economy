import {EconomyHUD} from './economy-hud.js';
import {parseConfig} from './config.js';
import {LiveObserver} from './live-observer.js';
import {SpectatorHUD,setHTML} from './spectator.js';
import type { AgentConfig, Config, GameEvent, MatchResponse, Replay } from './types.js';
import { api } from './api.js';
import { Player } from './player.js';
import { Renderer } from './renderer.js';
import { moments } from './replay.js';
const $ = <T extends HTMLElement = HTMLElement>(id:string):T => document.getElementById(id) as T;
const escape = (text:string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const hud=new SpectatorHUD();
let selected='', favorites=new Set<string>();
let observer:LiveObserver|null=null,watchSession='',watchConnected=false;
try { favorites=new Set(JSON.parse(localStorage.getItem('last-seat-favorites')||'[]') as string[]); } catch {}
const notice=(text:string)=>{$('notice').textContent=text;};
const economyHUD=new EconomyHUD($('economy-hud'),notice);
const player=new Player(update,notice);
const motion=matchMedia('(prefers-reduced-motion: reduce)');
const renderer=new Renderer($<HTMLCanvasElement>('board'),id=>{selected=id;$<HTMLDetailsElement>('agent-drawer').open=true;update();});
const mobile=matchMedia('(max-width:760px)');const log=document.querySelector<HTMLDetailsElement>('.live-log')!;log.open=!mobile.matches;mobile.addEventListener('change',()=>log.open=!mobile.matches);
renderer.reducedMotion=motion.matches;motion.addEventListener('change',()=>{renderer.reducedMotion=motion.matches;update();});
function update(event?:GameEvent) {
  const run=player.run,state=player.state;if(!run||!state)return;
  renderer.selected=selected;renderer.favorite=favorites;renderer.paused=!player.playing&&!player.manual;renderer.speed=player.speed;renderer.thinking=player.waiting;renderer.update(state,run.config,event);hud.render(run,state,player.cursor,player.playing,player.waiting,player.session,event,player.observing,watchConnected);
  $('turn').textContent=`TURN ${String(state.turn).padStart(2,'0')}`;
  const count=state.agents.filter(a=>a.alive).length;
  $('alive').textContent=state.ended?state.winner?`${run.config.agents.find(a=>a.id===state.winner)?.name.toUpperCase()} SURVIVES`:'NO SOLE SURVIVOR':`${count} / ${state.agents.length} AT THE TABLE`;
  $('play').textContent=player.playing?'Ⅱ Pause':player.busy?'▶ Resume':state.ended?'▶ Watch again':'▶ Play';
  $<HTMLButtonElement>('step').disabled=player.observing||player.playing||player.busy||state.ended;
  $<HTMLInputElement>('scrub').max=String(run.final_state.turn);$<HTMLInputElement>('scrub').value=String(state.turn);$('scrub-label').textContent=`${state.turn} / ${run.final_state.turn}`;
  $('mode-label').textContent=run.config.agents.every(a=>a.provider==='mock')?'SEEDED MOCK AGENTS':'RECORDED ADAPTER DECISIONS';
  if(event && !['ResourceChanged','AgentActionSelected','RoundEnded','ActionStarted','ActionResolved','AgentThinking'].includes(event.type))$('ticker').textContent=event.reason;
  if(!event) { const latest=run.events.slice(0,player.cursor).reverse().find(e=>!['ResourceChanged','AgentActionSelected','RoundEnded','RoundStarted','ActionStarted','ActionResolved','AgentThinking'].includes(e.type)); $('ticker').textContent=state.ended?(state.winner?`${run.config.agents.find(a=>a.id===state.winner)?.name} kept the last seat. ${state.end_reason}.`:state.end_reason||'Match ended.'):latest?.reason||'Four choices. One currency. Keep your seat.'; }
  const seen=moments(run).filter(e=>e.seq<player.cursor);
  setHTML('moments',seen.length?[...seen].reverse().slice(0,12).map(e=>`<button class="moment" data-turn="${e.turn}"><span>T${String(e.turn).padStart(2,'0')}</span>${escape(e.reason)}</button>`).join(''):'<p class="personality">A challenge takes credits. A guard blocks it.<br>Mutual cooperation earns a bonus. Upkeep rises every four turns.</p>');
  if(!selected||!state.agents.some(a=>a.id===selected))selected=state.agents[0]!.id;
  setHTML('agent-tabs',run.config.agents.map(a=>`<button class="agent-tab ${a.id===selected?'selected':''}" data-agent="${a.id}">${escape(a.name)}</button>`).join(''));
  inspect(run.config.agents.find(a=>a.id===selected)!);
  const comparison=$('comparison');comparison.hidden=!state.ended;
  if(state.ended)comparison.innerHTML=`<h2>AFTER THE TABLE CLEARED</h2><table><thead><tr><th>Agent / model</th><th>Survived</th><th>Credits</th><th>Challenges won</th><th>Blocks</th><th>Cooperations</th></tr></thead><tbody>${state.agents.map(a=>{const p=run.config.agents.find(p=>p.id===a.id)!;return `<tr><td>${escape(p.name)} · ${escape(p.model)}</td><td>${a.stats.eliminated_turn===null?'Still seated':`Out on T${a.stats.eliminated_turn}`}</td><td>${a.credits}</td><td>${a.stats.challenges_won}</td><td>${a.stats.blocks}</td><td>${a.stats.cooperations}</td></tr>`;}).join('')}</tbody></table>`;
}
function inspect(profile:AgentConfig) {
  const state=player.state!,run=player.run!,a=state.agents.find(a=>a.id===profile.id)!;
  const events=run.events.filter(e=>e.seq<player.cursor && e.actor===profile.id);
  const actions=events.filter(e=>e.type==='AgentActionSelected').slice(-3).reverse();
  $('favorite').textContent=favorites.has(profile.id)?'★ Following':'☆ Follow';
  setHTML('inspect-content',`<div class="agent-name"><img src="/${profile.sprite}" alt=""><div><strong>${escape(profile.name)} · ${a.credits} credits</strong><small>${escape(profile.provider)} · ${escape(profile.model)} · ${a.alive?'SEATED':`OUT T${a.stats.eliminated_turn}`}</small></div></div><p class="personality">${escape(profile.personality)}</p><button id="copy-agent" class="small-button">Copy agent config</button><details><summary class="personality">Prompt / strategy</summary><p class="personality">${escape(profile.prompt)}<br>Strategy: ${escape(profile.strategy)}</p></details><ul class="last-decisions">${actions.map(e=>`<li><b>T${e.turn} · ${e.decision?.action.toUpperCase()}</b> ${escape(e.reason)}</li>`).join('')||'<li>No decisions yet. Select Play to begin.</li>'}</ul>${profile.wallet_enabled?'<button id="wallet-demo">Try mock wallet capability</button>':''}`);
  $('copy-agent').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(profile,null,2));notice('Agent config copied. Paste into a match setup.');}catch{download(JSON.stringify(profile,null,2),'agent.json');}};
  economyHUD.decorate();
  const wallet=$('wallet-demo');if(wallet)wallet.onclick=async()=>{try{const result=await api<{wallet:{address:string;balance:number};events:unknown[]}>('/api/wallet-demo',{});notice(`Mock wallet ${result.wallet.address}: ${result.wallet.balance} lamports. ${result.events.length} activity events. Credits are separate.`);}catch(error){notice((error as Error).message);}};
}
function download(content:string,name:string,type='application/json') {const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function watchMatch(session:string,initial?:Replay){
 observer?.close();watchSession=session;watchConnected=false;
 if(initial){renderer.reset();player.load(initial,'',true);player.observing=true;selected=initial.config.agents[0]!.id;}
 observer=new LiveObserver(session,run=>{const first=!player.run;player.receive(run);if(first){renderer.reset();if(!run.final_state.ended)player.resume();}update();},connected=>{watchConnected=connected;notice(connected?'Watching live. Pause affects your view; the host controls the match.':'Live connection interrupted. Reconnecting…');update();},data=>economyHUD.accept(data));
 if(initial&&!initial.final_state.ended)player.resume();
}
async function create(config:Config,economy?:{mode:string;entry_amount_sol:string}) {
 player.pause();economyHUD.clear();
 if(economy&&economy.mode!=='none'){
  const result=await api<MatchResponse>('/api/funded-matches',{config,...economy});
  history.replaceState(null,'',`/?watch=${result.session}`);watchMatch(result.session,result.replay);notice('Funding open. Fund test entries to admit the match.');return;
 }
 const result=await api<MatchResponse>('/api/matches',{config});observer?.close();observer=null;watchSession='';watchConnected=false;history.replaceState(null,'',location.pathname);selected=result.replay.config.agents[0]!.id;renderer.reset();player.load(result.replay,result.session);try{localStorage.setItem('last-seat-replay-v1',JSON.stringify(result.replay));}catch{}notice(`Seed ${result.replay.config.seed} · ${result.replay.config.agents.length} agents · Rust core. Ready.`);
}
$('play').onclick=()=>{if(player.playing)player.pause();else player.resume();};
$('step').onclick=()=>{void player.step();};
$('replay').onclick=()=>{player.seek(0);notice('Replaying recorded events. Providers and rules are not called for recorded turns.');};
$('restart').onclick=async()=>{try{if(player.run)await create(player.run.config);}catch(error){notice((error as Error).message);}};
$<HTMLSelectElement>('speed').onchange=()=>{player.speed=Number($<HTMLSelectElement>('speed').value);};
$<HTMLInputElement>('scrub').oninput=()=>player.seek(Number($<HTMLInputElement>('scrub').value));
$('favorite').onclick=()=>{favorites.has(selected)?favorites.delete(selected):favorites.add(selected);try{localStorage.setItem('last-seat-favorites',JSON.stringify([...favorites]));}catch{}update();};
document.addEventListener('click',e=>{const target=(e.target as HTMLElement).closest<HTMLElement>('[data-agent],[data-turn]');if(target?.dataset.agent){selected=target.dataset.agent;$<HTMLDetailsElement>('agent-drawer').open=true;update();}if(target?.dataset.turn){player.seek(Number(target.dataset.turn));}});
const dialog=$<HTMLDialogElement>('config-dialog');
$('new').onclick=()=>{player.pause();if(player.run){$<HTMLTextAreaElement>('config-json').value=JSON.stringify(player.run.config,null,2);$<HTMLInputElement>('seed').value=String(player.run.seed);$<HTMLSelectElement>('population').value=String(player.run.config.agents.length);$<HTMLInputElement>('credits').value=String(player.run.config.agents[0]!.starting_credits);$<HTMLInputElement>('max-turns').value=String(player.run.config.max_turns);}$('config-error').textContent='';dialog.showModal();};
$('random-seed').onclick=()=>{$<HTMLInputElement>('seed').value=String(crypto.getRandomValues(new Uint32Array(1))[0]||1);};
$('close-config').onclick=()=>dialog.close();
$('preset').onclick=async()=>{try{const config=await api<Config>(`/api/config?agents=${$<HTMLSelectElement>('population').value}`);config.seed=Number($<HTMLInputElement>('seed').value);config.max_turns=Number($<HTMLInputElement>('max-turns').value);config.agents.forEach(a=>a.starting_credits=Number($<HTMLInputElement>('credits').value));$<HTMLTextAreaElement>('config-json').value=JSON.stringify(config,null,2);}catch(error){$('config-error').textContent=(error as Error).message;}};
$('config-form').onsubmit=async e=>{e.preventDefault();try{await create(parseConfig($<HTMLTextAreaElement>('config-json').value) as Config,{mode:$<HTMLSelectElement>('economy-mode').value,entry_amount_sol:$<HTMLSelectElement>('economy-entry').value});dialog.close();}catch(error){$('config-error').textContent=(error as Error).message;}};
$('download-config').onclick=()=>{download($<HTMLTextAreaElement>('config-json').value,'simulation.json');};
$('export').onclick=()=>{if(player.run)download(JSON.stringify(player.run,null,2),`${player.run.match_id}.json`);};
$('config-copy').onclick=async()=>{if(!player.run)return;try{await navigator.clipboard.writeText(JSON.stringify(player.run.config,null,2));notice('Config copied. Edit and paste into New / remix.');}catch{download(JSON.stringify(player.run.config,null,2),'simulation.json');}};
$('share-live').onclick=async()=>{
 const session=watchSession||player.session;if(!session){notice('Remix this history to start a live match.');return;}
 const url=new URL(location.href);url.search='';url.searchParams.set('watch',session);
 try{await navigator.clipboard.writeText(url.toString());notice('Live watch link copied. Viewers follow this match; pause controls only their view. Local links require this service.');}catch{notice(url.toString());}
};
$<HTMLInputElement>('import').onchange=async()=>{const file=$<HTMLInputElement>('import').files?.[0];if(!file)return;try{if(file.size>32_000_000)throw new Error('Replay exceeds 32 MB');const result=await api<MatchResponse>('/api/replays/import',{replay:JSON.parse(await file.text())});observer?.close();observer=null;watchSession='';watchConnected=false;player.load(result.replay,'',true);notice('Replay verified by Rust. Play from turn zero; no model calls.');}catch(error){notice((error as Error).message);}};
async function share(final:boolean) {
  player.pause();
  if(player.state)player.seek(player.state.turn);
  const run=player.run,state=player.state;if(!run||!state)return;
  if(final&&!state.ended){notice('Finish the match or share the current turn.');return;}
  try{await api('/api/replays/share',{replay:run});
    const url=new URL(location.href);url.search='';url.searchParams.set('match',run.match_id);url.searchParams.set('turn',String(state.turn));
    const winner=run.config.agents.find(a=>a.id===state.winner);
    const text=final?winner?`${winner.name} (${winner.model}) kept the last seat after ${state.turn} turns. ${run.config.agents.length} agents. Seed ${run.seed}.`:`${run.config.agents.length} agents fought for ${state.turn} turns. ${state.end_reason}. Seed ${run.seed}.`:`Turn ${state.turn}: ${$('ticker').textContent} Seed ${run.seed}.`;
    await navigator.clipboard.writeText(`${text}\n${url}`);notice('Text and turn link copied. Localhost links need this local service; deploy it for public X links.');
  }catch(error){notice(`Could not copy link: ${(error as Error).message}. Download the replay to share it.`);}
}
$('share-turn').onclick=()=>{void share(false);};$('share-result').onclick=()=>{void share(true);};
$('card').onclick=()=>{const run=player.run,state=player.state;if(!run||!state)return;const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=820;const c=canvas.getContext('2d')!;c.fillStyle='#24252a';c.fillRect(0,0,1200,820);c.imageSmoothingEnabled=false;c.drawImage($<HTMLCanvasElement>('board'),60,100,1080,608);c.fillStyle='#e0be7f';c.font='bold 32px monospace';c.fillText('LAST SEAT · AGENTS FIGHT UNTIL THEY ARE OUT',60,60);c.font='20px monospace';c.fillStyle='#e8ddc0';c.fillText(`TURN ${state.turn} · ${state.agents.filter(a=>a.alive).length}/${state.agents.length} SEATED · SEED ${run.seed}`,60,752);c.font='16px monospace';c.fillStyle='#b4a99b';c.fillText('Seeded local simulation · replayable decisions · no real-money gameplay',60,787);const a=document.createElement('a');a.download=`last-seat-turn-${state.turn}.png`;a.href=canvas.toDataURL('image/png');a.click();};
try {
  const params=new URLSearchParams(location.search),id=params.get('match'),watch=params.get('watch');
  if(watch){watchMatch(watch);}
  else if(id){const result=await api<{replay:Replay}>(`/api/replays/${encodeURIComponent(id)}`);player.load(result.replay,'',true);player.seek(Math.max(0,Math.min(result.replay.final_state.turn,Number(params.get('turn')||0))));notice('Shared replay loaded. New / remix forks its config.');}
  else {
    const savedSession=localStorage.getItem('last-seat-session'),saved=localStorage.getItem('last-seat-replay-v1');
    if(savedSession){try{const {replay}=await api<{replay:Replay}>(`/api/matches/${encodeURIComponent(savedSession)}`);renderer.reset();player.load(replay,savedSession);notice('Live session restored with its existing inference budget.');}catch(error){if(!(error instanceof Error))throw error;await create(await api<Config>('/api/config?agents=4'));}}
    else if(saved){const result=await api<MatchResponse>('/api/replays/import',{replay:JSON.parse(saved)});renderer.reset();player.load(result.replay,result.session);notice('Verified local replay restored. Restart for an identical fresh run.');}
    else await create(await api<Config>('/api/config?agents=4'));
  }
}catch(error){notice((error as Error).message);try{await create(await api<Config>('/api/config?agents=4'));}catch{notice('Start the local service with npm start.');}}
