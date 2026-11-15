import { createState, assertAccounting, record } from '../src/economy.js';
import { SOL } from '../src/policy.js';
import { configureRun } from '../src/config.js';
import { Orchestrator, eligibility } from '../src/orchestrator.js';
import { verifyProof } from '../src/rps.js';
import { verifyTicTacToeProof, WIN_LINES } from '../src/tictactoe.js';
import { loadState, saveState } from '../src/storage.js';
import { receiveRevenue, allocateTreasury } from '../src/treasury.js';
import { startTournament, nextTournamentPair, scoreTournament } from '../src/tournament.js';

const $ = id => document.getElementById(id);
const sharedRoom = location.pathname.match(/^\/arena\/(?:rps|tictactoe)\/(rps-[12]|ttt-[12])$/)?.[1] || null;
const spectatorKey=sharedRoom?`aae-room-spectator-v1:${sharedRoom}`:null;
let spectatorLease=loadSpectatorLease(),nextSpectatorAttempt=0,roomPageStopped=false,spectatorOperation=false;
function loadSpectatorLease(){
  if(!spectatorKey)return null;
  try{
    const value=JSON.parse(sessionStorage.getItem(spectatorKey)||'null');
    return value&&/^[A-Za-z0-9_-]{1,64}$/.test(value.id)&&typeof value.token==='string'?value:null;
  }catch{return null;}
}
function saveSpectatorLease(value){
  spectatorLease=value;
  try{if(value)sessionStorage.setItem(spectatorKey,JSON.stringify(value));else sessionStorage.removeItem(spectatorKey);}catch{/* Spectating still works without session storage. */}
}
async function spectatorRequest(action,lease,keepalive=false){
  const response=await fetch(`/api/arena/rooms/${sharedRoom}/spectators/${action}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spectator_id:lease.id,spectator_token:lease.token}),
    keepalive,signal:AbortSignal.timeout(keepalive?2_000:5_000),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.error||'Room spectator connection failed'),{status:response.status,code:result.code});
  return result;
}
async function joinRoomAsSpectator(){
  const lease=spectatorLease||{id:`viewer_${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`,token:''};
  const result=await spectatorRequest('join',lease);
  const connected={id:result.spectator_id,token:result.spectator_token};
  if(roomPageStopped){await spectatorRequest('leave',connected,true).catch(()=>{});return;}
  saveSpectatorLease(connected);
}
async function maintainRoomSpectator(){
  if(!sharedRoom||roomPageStopped||spectatorOperation||Date.now()<nextSpectatorAttempt)return;
  spectatorOperation=true;
  try{
    if(!spectatorLease)await joinRoomAsSpectator();
    else await spectatorRequest('heartbeat',spectatorLease);
    nextSpectatorAttempt=Date.now()+15_000;
  }catch(error){
    if(error.status===404||error.status===403){saveSpectatorLease(null);try{await joinRoomAsSpectator();nextSpectatorAttempt=Date.now()+15_000;return;}catch{/* Retry the join on the next backoff window. */}}
    nextSpectatorAttempt=Date.now()+5_000;
  }finally{spectatorOperation=false;}
}
function leaveRoomSpectator(){
  if(!sharedRoom||!spectatorLease)return Promise.resolve();
  return spectatorRequest('leave',spectatorLease,true).then(()=>saveSpectatorLease(null)).catch(()=>{/* The lease expires automatically if navigation interrupts the request. */});
}
// The legacy engine stores exact integer base units. Public simulation copy
// deliberately presents those units as internal credits, never as SOL.
const credits = n => n / SOL * 100;
const fmt = n => `${Number.isInteger(credits(n)) ? credits(n).toFixed(0) : credits(n).toFixed(2)} CR`;
const creditInputToUnits = value => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Use a positive credit amount.');
  const units = Math.round(amount * SOL / 100);
  if (!Number.isSafeInteger(units)) throw new Error('Credit amount is too large.');
  return units;
};
const creditInputToLegacyDecimal = value => String(creditInputToUnits(value) / SOL);
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let state = createState(), selected = state.agents[0].id, watching = false, current = null, phase = '', busy = false;
let orchestrator;
let sharedRunId=null;
const agent = id => state.agents.find(a => a.id === id);
const games = a => a.wins + a.losses + a.draws;
const notice = text => { $('notice').textContent = text; };
function save() { if(!sharedRoom)saveState(state); }
function connect() {
  if(sharedRoom)return;
  orchestrator = new Orchestrator(state, { onSave: () => {
    if (state.tournament?.status === 'open') scoreTournament(state, state.matches.at(-1));
    save();
  }, onStage: async (stage, match) => {
    phase = stage; current = match; render();
    const delay = Number($('speed').value);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  } });
}
/* ---------------------------------------------------------------
   Presentation state for the bout stage. Everything below only
   reads existing match data; no rule or settlement code lives here.
   --------------------------------------------------------------- */
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const duelNodes=new Map(),spriteTokens=new Map(),historyCards=new Map();
let boardCells=[],lastBoard=Array(9).fill(null),lastRevealed=false,lastSettled=false,lastMatchId=null;
function restartClass(node,className,ms){if(!node)return;node.classList.remove(className);void node.offsetWidth;node.classList.add(className);setTimeout(()=>node.classList.remove(className),ms);}
function moveLabel(move){return move==='rock'?'ROCK':move==='paper'?'PAPER':move==='scissors'?'SCISSORS':'';}
function ensureDuelist(side){
  if(duelNodes.has(side))return duelNodes.get(side);
  const placeholder=document.querySelector(`#duel .duelist[data-side="${side}"]`);
  const node=document.createElement('div');node.className='duelist';node.dataset.side=side;
  node.innerHTML=`<div class="duelist__platform"><img alt="" width="96" height="96" decoding="async"></div><span class="duelist__tag"></span><strong class="duelist__name">?</strong><div class="duelist__move"><span class="move-icon" aria-hidden="true"><i></i></span><b>…</b></div>`;
  if(placeholder)placeholder.replaceWith(node);else $('duel').append(node);
  duelNodes.set(side,node);return node;
}
function ensureBoard(){
  if(boardCells.length)return;
  for(let index=0;index<9;index++){const cell=document.createElement('span');cell.dataset.cell=String(index);boardCells.push(cell);}
  $('ttt-board').replaceChildren(...boardCells);
}
function renderDuel(){
  const ttt=current?.type==='tictactoe';
  if(!current){
    for(const side of ['a','b']){
      const node=ensureDuelist(side);
      node.querySelector('img').removeAttribute('src');
      node.querySelector('.duelist__name').textContent='?';
      node.querySelector('.duelist__tag').textContent='';
      node.querySelector('.duelist__move').hidden=true;
      node.classList.remove('is-winner','is-defeated','is-revealed','is-draw');
    }
    return;
  }
  const revealed=ttt||phase==='reveal'||phase==='settle'||current.status==='settled';
  const settled=current.status==='settled',draw=settled&&current.result==='draw';
  current.players.forEach((id,index)=>{
    const side=index===0?'a':'b',node=ensureDuelist(side),info=agent(id);
    const img=node.querySelector('img'),src='/'+info.sprite;
    if(img.getAttribute('src')!==src)img.src=src;
    img.alt=`${info.name} pixel sprite`;
    node.querySelector('.duelist__name').textContent=info.name;
    node.querySelector('.duelist__tag').textContent=ttt?(index===0?'PLAYS X':'PLAYS O'):`SEAT ${index===0?'A':'B'}`;
    const slot=node.querySelector('.duelist__move'),icon=slot.querySelector('.move-icon'),label=slot.querySelector('b');
    slot.hidden=false;
    if(ttt){
      icon.hidden=true;label.textContent=index===0?'X':'O';slot.dataset.mark=index===0?'x':'o';
    }else{
      const move=revealed?(current.reveals?.[id]?.move||''):'';
      icon.hidden=!revealed;slot.dataset.mark='';
      icon.dataset.move=move;
      label.textContent=revealed?(moveLabel(move)||'…'):'LOCKED';
    }
    node.classList.toggle('is-winner',settled&&!draw&&current.result===side);
    node.classList.toggle('is-defeated',settled&&!draw&&current.result!==side);
    node.classList.toggle('is-draw',draw);
    node.classList.toggle('is-revealed',!ttt&&revealed);
  });
  if(!ttt&&revealed&&!lastRevealed)restartClass($('duel'),'is-impact',460);
  if(settled&&!lastSettled)restartClass(document.querySelector('.bout-stage'),'is-impact',460);
  lastRevealed=!ttt&&revealed;lastSettled=settled;
}
function renderBoard(){
  const boardEl=$('ttt-board'),ttt=current?.type==='tictactoe';
  if(!ttt){boardEl.hidden=true;lastBoard=Array(9).fill(null);return;}
  boardEl.hidden=false;ensureBoard();
  const board=current.board||Array(9).fill(null),settled=current.status==='settled';
  const winner=settled&&(current.result==='a'||current.result==='b')?current.result:null;
  const winning=new Set();
  if(winner)for(const line of WIN_LINES){if(line.every(index=>board[index]===winner)){line.forEach(index=>winning.add(index));break;}}
  for(let index=0;index<9;index++){
    const cell=board[index],node=boardCells[index],newCell=!!cell&&!lastBoard[index];
    node.textContent=cell==='a'?'X':cell==='b'?'O':'';
    node.className='';
    if(cell)node.classList.add('is-filled',cell==='a'?'is-x':'is-o');
    if(winning.has(index))node.classList.add('is-win');
    if(settled&&current.result==='draw'&&cell)node.classList.add('is-tied');
    if(newCell&&!reduceMotion.matches){node.classList.add('is-placed');node.addEventListener('animationend',()=>node.classList.remove('is-placed'),{once:true});}
  }
  lastBoard=board.slice();
}
function renderResult(){
  const node=$('match-result'),ttt=current?.type==='tictactoe';
  let text,state='idle';
  if(!current)text='Moves stay hidden until both commitments are locked.';
  else if(current.status==='settled'){
    text=current.result==='draw'?'Draw. Both credit commitments returned.':`${agent(current.players[current.result==='a'?0:1]).name} wins. ${fmt(current.stake*2)} pool settled.`;
    state=current.result==='draw'?'draw':'winner';
  }else{
    text=ttt?`Move ${current.moves.length+1} · ${agent(current.players[current.moves.length%2]).name} to play.`:phase==='commit'?'Both SHA-256 commitments are locked.':phase==='reveal'?'Both reveals verified. Preparing settlement.':'Entry intents passed policy. Internal credits held in game escrow.';
    state='live';
  }
  node.textContent=text;
  if(node.dataset.state!==state){node.dataset.state=state;if(state==='winner'||state==='draw')restartClass(node,'is-flash',720);}
}
function renderSpriteField(){
  const seen=new Set();
  for(const a of state.agents){
    seen.add(a.id);
    let token=spriteTokens.get(a.id);
    if(!token){
      token=document.createElement('button');token.className='sprite-token';token.dataset.agent=a.id;token.setAttribute('aria-label',`Inspect ${a.name}`);
      const img=document.createElement('img');img.alt='';img.decoding='async';
      const label=document.createElement('span');
      token.append(img,label);$('sprite-field').append(token);spriteTokens.set(a.id,token);
    }
    const img=token.querySelector('img'),src='/'+a.sprite;
    if(img.getAttribute('src')!==src)img.src=src;
    token.querySelector('span').textContent=a.name.toUpperCase();
    const fighting=busy&&current?.players.includes(a.id);
    token.classList.toggle('selected',a.id===selected);
    token.classList.toggle('out',!eligibility(state,a).eligible);
    token.classList.toggle('fighting',!!fighting);
  }
  for(const [id,token] of spriteTokens)if(!seen.has(id)){token.remove();spriteTokens.delete(id);}
}
function renderHistory(settled){
  const list=$('history-list');
  if(!settled.length){list.replaceChildren();const empty=document.createElement('p');empty.className='empty';empty.textContent='The story begins with the first match.';list.append(empty);historyCards.clear();return;}
  list.querySelector('.empty')?.remove();
  const wanted=[...settled].reverse().slice(0,40),wantedIds=new Set(wanted.map(match=>match.id));
  for(const [id,card] of historyCards){
    if(wantedIds.has(id))continue;
    historyCards.delete(id);card.classList.add('is-leaving');
    const remove=()=>card.remove();card.addEventListener('transitionend',remove,{once:true});setTimeout(remove,260);
  }
  wanted.forEach((match,index)=>{
    let card=historyCards.get(match.id);
    if(!card){
      card=document.createElement('button');card.className='history-card is-new';card.dataset.match=match.id;
      card.innerHTML=`<span class="history-card__id">${esc(match.id.toUpperCase())} · ${match.type==='tictactoe'?'TIC-TAC-TOE':'RPS'}</span><strong>${esc(agent(match.players[0]).name)} vs ${esc(agent(match.players[1]).name)}</strong><span class="history-card__result">${match.result==='draw'?'DRAW · RETURNED':`${esc(agent(match.players[match.result==='a'?0:1]).name.toUpperCase())} WINS`}</span><span class="tiny">${fmt(match.stake*2)} internal pool · view proof ↗</span>`;
      historyCards.set(match.id,card);
      if(!reduceMotion.matches)requestAnimationFrame(()=>requestAnimationFrame(()=>card.classList.remove('is-new')));
    }
    if(list.children[index]!==card)list.insertBefore(card,list.children[index]||null);
  });
}
function render() {
  const settled = state.matches.filter(m => m.status === 'settled');
  const available = state.agents.filter(a => eligibility(state, a).eligible);
  $('active-count').textContent = `${available.length} / ${state.agents.length}`;
  $('match-count').textContent = String(settled.length).padStart(4, '0');
  $('capital').textContent = fmt(state.agents.reduce((sum, a) => sum + a.balance, 0) + state.matches.reduce((sum, m) => sum + m.escrow, 0));
  $('treasury-total').textContent = fmt(state.treasury);
  $('seed-label').textContent = `SEED ${state.seed}`;
  $('run-status').textContent = state.paused ? 'PAUSED' : watching ? 'LIVE' : settled.length >= state.config.maxRounds || available.length < 2 ? 'COMPLETE' : 'READY';
  $('arena-caption').textContent = state.mode === 'survival' ? 'Survival · out when the next risk cannot be covered' : 'Bounded · reserve, exposure, and loss limits enforced';
  $('run').textContent = watching ? '■ Stop watching' : '▶ Start watching';
  $('step').disabled = busy || watching || state.paused;
  $('run').disabled = state.paused;
  $('pause').textContent = state.paused ? 'Resume economy' : 'Pause economy';
  document.querySelectorAll('#new-run input,#new-run select,#new-run button').forEach(el => el.disabled = busy || watching);
  document.querySelectorAll('#treasury-controls input,#treasury-controls button').forEach(el => el.disabled = busy || watching || state.paused);
  if(current?.id!==lastMatchId){lastMatchId=current?.id??null;lastBoard=Array(9).fill(null);lastRevealed=false;lastSettled=current?.status==='settled';}
  renderSpriteField();
  renderDuel();
  renderBoard();
  renderResult();
  $('match-title').textContent = current ? `${current.id} · ${current.type === 'tictactoe' ? 'TIC-TAC-TOE' : 'RPS'} · ${fmt(current.stake)} risk each` : 'Waiting for rivals';
  const tttPhases = current?.type === 'tictactoe' ? ['evaluate', 'play', 'verify', 'settle'] : ['evaluate', 'commit', 'reveal', 'settle'];
  document.querySelectorAll('[data-phase]').forEach((el, i) => { el.dataset.phase = tttPhases[i]; el.textContent = tttPhases[i].toUpperCase(); el.classList.toggle('active', el.dataset.phase === phase); });
  const sort = $('sort').value;
  const ranked = [...state.agents].sort((a, b) => sort === 'drawdown' ? a.drawdown - b.drawdown : b[sort] - a[sort]);
  $('leaderboard').innerHTML = ranked.map((a, i) => `<tr><td><button data-agent="${a.id}"><span class="rank">${i + 1}</span><img class="table-agent" src="/${a.sprite}" alt="">${a.name}</button></td><td>${fmt(a.balance)}</td><td class="${a.pnl < 0 ? 'negative' : 'positive'}">${a.pnl >= 0 ? '+' : ''}${fmt(a.pnl)}<span class="tiny">${(a.pnl / a.capital * 100).toFixed(1)}% ROI</span></td><td>${a.wins} / ${a.losses} / ${a.draws}</td><td class="${eligibility(state, a).eligible ? 'positive' : 'muted'}">${eligibility(state, a).eligible ? 'READY' : 'OUT'}</td></tr>`).join('');
  renderDetail();
  const t = state.tournament;
  if ($('tournament-status')) $('tournament-status').textContent = t ? `${t.status.toUpperCase()} · ${t.matchIds.length}/${t.schedule.length} matches · ${Object.entries(t.points).map(([id, points]) => `${agent(id).name} ${points}pt`).join(' / ')}${t.skipped ? ` · ${t.skipped} skipped by policy` : ''}` : 'Four eligible rivals · round robin · win 3pt / draw 1pt';
  renderHistory(settled);
  if(sharedRoom){
    document.body.classList.add('shared-room');
    $('run-status').textContent='LIVE · SHARED ROOM';
    $('match-scope').textContent='Spectator view. The server runs the existing rules and settles every move.';
    document.querySelectorAll('.play-controls,.speed-label,#new-run,#treasury-controls').forEach(el=>el.hidden=true);
    document.querySelectorAll('.play-controls button,.speed-label input,.speed-label select,#new-run button,#new-run input,#new-run select,#treasury-controls button,#treasury-controls input').forEach(el=>el.disabled=true);
    $('share').hidden=true;
  }
}
let detailSignature='';
function renderDetail() {
  const a = agent(selected) || state.agents[0]; selected = a.id;
  const count = games(a);
  const signature=[a.id,count,a.balance,a.pnl,a.wins,a.losses,a.draws,a.memory.length,a.memory.at(-1)?.matchId,a.memory.at(-1)?.delta].join('|');
  if(signature===detailSignature)return;
  detailSignature=signature;
  $('agent-detail').innerHTML = `<div class="agent-head"><img src="/${a.sprite}" alt="${a.name} pixel sprite"><div><h2>${a.name}</h2><span class="muted">${a.strategy}</span></div></div><p class="muted">${eligibility(state, a).eligible ? 'Ready for the next opportunity.' : `Out of play: ${esc(eligibility(state, a).reason)}.`}</p><dl class="detail-grid"><div><dt>WIN RATE / ALL GAMES</dt><dd>${count ? (a.wins / count * 100).toFixed(1) : '0.0'}%</dd></div><div><dt>MAX RISK DRAWDOWN</dt><dd>${fmt(a.drawdown)}</dd></div><div><dt>AVERAGE RISK</dt><dd>${fmt(count ? a.staked / count : 0)}</dd></div><div><dt>GAMES PLAYED</dt><dd>${count}</dd></div></dl><h3>Deterministic limits</h3><p class="muted">Max risk ${fmt(a.policy.maxStake)} · reserve ${fmt(a.policy.reserve)} · exposure ${a.policy.maxExposureBps / 100}% · loss budget ${fmt(a.policy.maxLoss)}.</p><h3>What this agent learns</h3><p class="muted">RPS move frequencies inform counter-moves; tic-tac-toe records board outcomes. Exploration ${(a.exploration * 100).toFixed(0)}%. Memory comes only from settled matches.</p>${a.memory.slice(-4).reverse().map(m => `<div class="memory-item">${m.matchId} · ${agent(m.opponent).name} played ${m.observed}<br>${m.delta >= 0 ? '+' : ''}${fmt(m.delta)} internal change</div>`).join('') || '<p class="muted">No opponent observations yet.</p>'}`;
  restartClass($('agent-detail'),'is-updated',320);
}
async function playOne() {
  if (busy) return;
  busy = true; render();
  try {
    if (state.matches.length >= state.config.maxRounds) throw new Error('Match limit reached. Create a new run to continue.');
    const inTournament = state.tournament?.status === 'open';
    const pair = inTournament ? nextTournamentPair(state) : null;
    if (inTournament && !pair) { save(); watching = false; notice('Tournament complete. Inspect the recorded points.'); return; }
    const match = await orchestrator.step(pair, $('game-type').value); current = match; phase = 'settle';
    if (inTournament) { scoreTournament(state, match); save(); }
    notice('Internal-credit settlement verified · saved locally · capital conserved');
  } catch (error) { watching = false; current = state.matches.at(-1) || null; phase = current ? 'settle' : ''; notice(error.message); }
  finally { busy = false; render(); }
}
$('run').addEventListener('click', async () => {
  if (watching) { watching = false; render(); return; }
  if (busy) return;
  watching = true; render();
  while (watching && !state.paused) { await playOne(); if (watching) await new Promise(resolve => setTimeout(resolve, 30)); }
});
$('step').addEventListener('click', playOne);
$('pause').addEventListener('click', () => {
  // Finish an atomic in-flight settlement before applying pause to the next entry.
  watching = false; state.paused = !state.paused;
  record(state, 'EMERGENCY_PAUSE', { paused: state.paused });
  try { if (!busy) save(); } catch (error) { notice(`Could not save: ${error.message}`); } render();
});
$('sort').addEventListener('change', render);
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-agent],[data-match]');
  if (!target) return;
  if (target.dataset.agent) { selected = target.dataset.agent; render(); }
  if (target.dataset.match && !busy) {
    const match = state.matches.find(m => m.id === target.dataset.match);
    if (!match || match.status !== 'settled') return;
    const valid = match.type === 'tictactoe' ? verifyTicTacToeProof(match) : await verifyProof(match);
    current = match; phase = 'settle'; render(); $('proof').hidden = false;
    $('proof').innerHTML = `<p class="${valid ? 'positive' : 'negative'}">${esc(match.id)} · ${valid ? match.type === 'tictactoe' ? 'Board and deterministic result verified' : 'SHA-256 reveals and deterministic result verified' : 'Verification failed'}</p>${match.players.map(id => `<p>${agent(id).name}: ${esc(match.type === 'tictactoe' ? `${match.moves.filter(m => m.agentId === id).length} moves` : match.reveals[id].move)} · settlement ${fmt(match.payouts[id])}</p>`).join('')}<details><summary>Inspect complete proof</summary><pre>${esc(JSON.stringify(match, null, 2))}</pre></details>`;
  }
});
$('new-run').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || watching) return;
  try { const values=Object.fromEntries(new FormData(event.target));values.stake=creditInputToLegacyDecimal(values.stake);values.bankroll=creditInputToLegacyDecimal(values.bankroll);state = configureRun(values); selected = state.agents[0].id; current = null; phase = ''; $('proof').hidden = true; connect(); save(state); render(); notice('New experiment ready. Previous run replaced.'); }
  catch (error) { notice(error.message); }
});
$('export').addEventListener('click', () => {
  if(sharedRoom){
    if(!sharedRunId)return;
    const link=document.createElement('a');link.href=`/api/arena/logs/${sharedRunId}`;link.download=`arena-${sharedRunId}.json`;link.click();return;
  }
  if (busy) { notice('Wait for settlement before exporting.'); return; }
  assertAccounting(state);
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `agent-arena-seed-${state.seed}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('share').addEventListener('click', async () => {
  const top = [...state.agents].sort((a, b) => b.pnl - a.pnl)[0];
  const summary = `I made ${state.agents.length} pixel agents compete in RPS and tic-tac-toe. Seed ${state.seed}, ${state.matches.filter(m => m.status === 'settled').length} settled matches, ${state.agents.filter(a => eligibility(state, a).eligible).length} still eligible. ${top.name} leads by internal P&L (${fmt(top.pnl)}). Run yours: https://github.com/lewodro/autonomous-agent-economy`;
  try { await navigator.clipboard.writeText(summary); notice('Run summary copied.'); }
  catch { notice(summary); }
});
$('treasury-controls').innerHTML = `<form id="revenue-form" class="settings-form"><label>Internal receipt ID<input name="receipt" value="demo-receipt-1" required></label><label>Creator revenue · credits<input name="revenue" inputmode="decimal" value="100" required></label><button type="submit">Record receipt → allocate 30% to treasury</button></form><div class="button-row" style="margin-top:12px"><button id="allocate">Distribute bounded grants</button><button id="tournament">Start tournament</button></div><p id="tournament-status" class="muted"></p><p class="muted">This is internal game accounting, not wallet value. Duplicate receipt IDs cannot create credits twice. Grants go to lower balances first, capped at 10% of each agent's capital per allocation. Grants never reset loss limits.</p>`;
$('revenue-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || watching) return;
  try { const form = new FormData(event.target); const deposit = receiveRevenue(state, form.get('receipt'), creditInputToUnits(form.get('revenue'))); save(); render(); notice(`${fmt(deposit)} recorded in the internal treasury.`); }
  catch (error) { notice(error.message); }
});
$('allocate').addEventListener('click', () => {
  if (busy || watching) return;
  try { const grants = allocateTreasury(state, `allocation-${state.events.length + 1}`); save(); render(); notice(`${grants.length} bounded grants recorded. Trading P&L excludes grants.`); }
  catch (error) { notice(error.message); }
});
$('tournament').addEventListener('click', () => {
  if (busy || watching) return;
  try { startTournament(state); save(); render(); notice('Tournament opened. Press Start watching or Next match.'); }
  catch (error) { notice(error.message); }
});
// Loading checks hashes and reconstructs accounting before enabling gameplay.
if(!sharedRoom){
document.querySelectorAll('button').forEach(button => button.disabled = true);
document.body.setAttribute('aria-busy', 'true');
notice('Verifying saved ledger…');
try { const restored = await loadState(); if (restored) { state = restored; selected = state.agents[0].id; notice('Verified saved run restored.'); } else notice('Ready · completed matches will be saved locally.'); }
catch (error) { notice(`Saved run could not be verified: ${error.message}. A fresh run is ready; the saved data remains until the next saved transition.`); }
document.querySelectorAll('button').forEach(button => button.disabled = false);
document.body.removeAttribute('aria-busy');
connect(); render();
}else{
  document.querySelector('.return-link').href='/arena';document.querySelector('.return-link').textContent='← BACK TO ARENA';
  document.querySelector('.intro h1').textContent=`ROOM ${sharedRoom.toUpperCase()}`;
  document.querySelector('.intro .lede').textContent='Shared live simulation. The server runs the existing rules; spectators cannot change moves.';
  let stopped=false;window.addEventListener('pagehide',()=>{stopped=true;roomPageStopped=true;});
  const returnLink=document.querySelector('.return-link');
  returnLink?.addEventListener('click',event=>{
    if(!spectatorLease&&!spectatorOperation)return;
    event.preventDefault();roomPageStopped=true;
    void (async()=>{
      while(spectatorOperation)await new Promise(resolve=>setTimeout(resolve,20));
      await leaveRoomSpectator();location.assign(returnLink.href);
    })();
  });
  async function observe(){
    if(stopped)return;
    void maintainRoomSpectator();
    try{
      const response=await fetch(`/api/arena/rooms/${sharedRoom}`,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('Room unavailable');
      const snapshot=await response.json();state=snapshot.state;current=snapshot.current;phase=snapshot.phase;sharedRunId=snapshot.room.runId;
      render();$('run-status').textContent=snapshot.room.status.toUpperCase()+' · SHARED';
      notice(snapshot.room.status==='failed'?'This room has stopped. Return to the Arena and choose another room.':'LIVE · adaptive local agents · internal credits · shared server room');
    }catch{notice('Connection interrupted. Reconnecting to the room…');$('run-status').textContent='RECONNECTING';}
    if(!stopped)setTimeout(observe,750);
  }
  observe();
}
