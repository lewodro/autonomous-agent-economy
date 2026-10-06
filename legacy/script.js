import { createState, assertAccounting, record } from '../src/economy.js';
import { SOL } from '../src/policy.js';
import { configureRun } from '../src/config.js';
import { Orchestrator, eligibility } from '../src/orchestrator.js';
import { verifyProof } from '../src/rps.js';
import { verifyTicTacToeProof } from '../src/tictactoe.js';
import { loadState, saveState } from '../src/storage.js';
import { receiveRevenue, allocateTreasury } from '../src/treasury.js';
import { toLamports } from '../src/policy.js';
import { startTournament, nextTournamentPair, scoreTournament } from '../src/tournament.js';

const $ = id => document.getElementById(id);
const sharedRoom = location.pathname.match(/^\/arena\/(?:rps|tictactoe)\/(rps-[12]|ttt-[12])$/)?.[1] || null;
const fmt = n => (n / SOL).toFixed(3);
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
function render() {
  const settled = state.matches.filter(m => m.status === 'settled');
  const available = state.agents.filter(a => eligibility(state, a).eligible);
  $('active-count').textContent = `${available.length} / ${state.agents.length}`;
  $('match-count').textContent = String(settled.length).padStart(4, '0');
  $('capital').textContent = fmt(state.agents.reduce((sum, a) => sum + a.balance, 0) + state.matches.reduce((sum, m) => sum + m.escrow, 0));
  $('treasury-total').textContent = fmt(state.treasury);
  $('seed-label').textContent = `SEED ${state.seed}`;
  $('run-status').textContent = state.paused ? 'PAUSED' : watching ? 'LIVE' : settled.length >= state.config.maxRounds || available.length < 2 ? 'COMPLETE' : 'READY';
  $('arena-caption').textContent = state.mode === 'survival' ? 'Survival · out when the next stake cannot be covered' : 'Bounded · reserve, exposure, and loss limits enforced';
  $('run').textContent = watching ? '■ Stop watching' : '▶ Start watching';
  $('step').disabled = busy || watching || state.paused;
  $('run').disabled = state.paused;
  $('pause').textContent = state.paused ? 'Resume economy' : 'Pause economy';
  document.querySelectorAll('#new-run input,#new-run select,#new-run button').forEach(el => el.disabled = busy || watching);
  document.querySelectorAll('#treasury-controls input,#treasury-controls button').forEach(el => el.disabled = busy || watching || state.paused);
  $('sprite-field').innerHTML = state.agents.map(a => `<button class="sprite-token ${a.id === selected ? 'selected' : ''} ${!eligibility(state, a).eligible ? 'out' : ''} ${busy && current?.players.includes(a.id) ? 'fighting' : ''}" data-agent="${a.id}" aria-label="Inspect ${a.name}"><img src="/${a.sprite}" alt=""><span>${a.name.toUpperCase()}</span></button>`).join('');
  if (current) {
    const ttt = current.type === 'tictactoe';
    $('match-title').textContent = `${current.id} · ${ttt ? 'TIC-TAC-TOE' : 'RPS'} · ${fmt(current.stake)} simulated SOL each`;
    $('duel').innerHTML = current.players.map((id, i) => `${i ? '<span>VS</span>' : ''}<div class="duelist"><img src="/${agent(id).sprite}" alt="">${agent(id).name}<b>${ttt ? i ? 'O' : 'X' : ['reveal', 'settle'].includes(phase) ? esc(current.reveals[id]?.move || '…') : '?'}</b></div>`).join('');
    $('ttt-board').hidden = !ttt;
    if (ttt) $('ttt-board').innerHTML = current.board.map(cell => `<span>${cell === 'a' ? 'X' : cell === 'b' ? 'O' : '·'}</span>`).join('');
    $('match-result').textContent = current.status === 'settled' ? current.result === 'draw' ? 'Draw. Both simulated stakes returned.' : `${agent(current.players[current.result === 'a' ? 0 : 1]).name} wins. ${fmt(current.stake * 2)} simulated SOL pot settled.` : ttt ? `Move ${current.moves.length + 1} · ${agent(current.players[current.moves.length % 2]).name} to play.` : phase === 'commit' ? 'Both SHA-256 commitments are locked.' : phase === 'reveal' ? 'Both reveals verified. Preparing settlement.' : 'Entry intents passed policy. Stakes held in escrow.';
  } else {
    $('match-title').textContent = 'Waiting for rivals';
    $('duel').innerHTML = '<b>?</b><span>VS</span><b>?</b>';
    $('match-result').textContent = 'Moves stay hidden until both commitments are locked.';
    $('ttt-board').hidden = true;
  }
  const tttPhases = current?.type === 'tictactoe' ? ['evaluate', 'play', 'verify', 'settle'] : ['evaluate', 'commit', 'reveal', 'settle'];
  document.querySelectorAll('[data-phase]').forEach((el, i) => { el.dataset.phase = tttPhases[i]; el.textContent = tttPhases[i].toUpperCase(); el.classList.toggle('active', el.dataset.phase === phase); });
  const sort = $('sort').value;
  const ranked = [...state.agents].sort((a, b) => sort === 'drawdown' ? a.drawdown - b.drawdown : b[sort] - a[sort]);
  $('leaderboard').innerHTML = ranked.map((a, i) => `<tr><td><button data-agent="${a.id}"><span class="rank">${i + 1}</span><img class="table-agent" src="/${a.sprite}" alt="">${a.name}</button></td><td>${fmt(a.balance)}</td><td class="${a.pnl < 0 ? 'negative' : 'positive'}">${a.pnl >= 0 ? '+' : ''}${fmt(a.pnl)}<span class="tiny">${(a.pnl / a.capital * 100).toFixed(1)}% ROI</span></td><td>${a.wins} / ${a.losses} / ${a.draws}</td><td class="${eligibility(state, a).eligible ? 'positive' : 'muted'}">${eligibility(state, a).eligible ? 'READY' : 'OUT'}</td></tr>`).join('');
  renderDetail();
  const t = state.tournament;
  if ($('tournament-status')) $('tournament-status').textContent = t ? `${t.status.toUpperCase()} · ${t.matchIds.length}/${t.schedule.length} matches · ${Object.entries(t.points).map(([id, points]) => `${agent(id).name} ${points}pt`).join(' / ')}${t.skipped ? ` · ${t.skipped} skipped by policy` : ''}` : 'Four eligible rivals · round robin · win 3pt / draw 1pt';
  $('history-list').innerHTML = settled.length ? [...settled].reverse().slice(0, 40).map(m => `<button class="history-card" data-match="${m.id}">${m.id.toUpperCase()} · ${m.type === 'tictactoe' ? 'TIC-TAC-TOE' : 'RPS'}<strong>${agent(m.players[0]).name} vs ${agent(m.players[1]).name}</strong>${m.result === 'draw' ? 'DRAW · REFUNDED' : `${agent(m.players[m.result === 'a' ? 0 : 1]).name.toUpperCase()} WINS`}<span class="tiny">${fmt(m.stake * 2)} simulated SOL pot · view proof ↗</span></button>`).join('') : '<p class="empty">The story begins with the first match.</p>';
  if(sharedRoom){
    $('run-status').textContent='LIVE · SHARED ROOM';
    document.querySelectorAll('.play-controls,.speed-label,#new-run,#treasury-controls').forEach(el=>el.hidden=true);
    $('share').hidden=true;
  }
}
function renderDetail() {
  const a = agent(selected) || state.agents[0]; selected = a.id;
  const count = games(a);
  $('agent-detail').innerHTML = `<div class="agent-head"><img src="/${a.sprite}" alt="${a.name} pixel sprite"><div><h2>${a.name}</h2><span class="muted">${a.strategy}</span></div></div><p class="muted">${eligibility(state, a).eligible ? 'Ready for the next opportunity.' : `Out of play: ${esc(eligibility(state, a).reason)}.`}</p><dl class="detail-grid"><div><dt>WIN RATE / ALL GAMES</dt><dd>${count ? (a.wins / count * 100).toFixed(1) : '0.0'}%</dd></div><div><dt>MAX DRAWDOWN</dt><dd>${fmt(a.drawdown)} SOL</dd></div><div><dt>AVERAGE STAKE</dt><dd>${fmt(count ? a.staked / count : 0)} SOL</dd></div><div><dt>GAMES PLAYED</dt><dd>${count}</dd></div></dl><h3>Deterministic limits</h3><p class="muted">Max stake ${fmt(a.policy.maxStake)} SOL · reserve ${fmt(a.policy.reserve)} SOL · exposure ${a.policy.maxExposureBps / 100}% · loss budget ${fmt(a.policy.maxLoss)} SOL.</p><h3>What this agent learns</h3><p class="muted">RPS move frequencies inform counter-moves; tic-tac-toe records board outcomes. Exploration ${(a.exploration * 100).toFixed(0)}%. Memory comes only from settled matches.</p>${a.memory.slice(-4).reverse().map(m => `<div class="memory-item">${m.matchId} · ${agent(m.opponent).name} played ${m.observed}<br>${m.delta >= 0 ? '+' : ''}${fmt(m.delta)} simulated SOL</div>`).join('') || '<p class="muted">No opponent observations yet.</p>'}`;
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
    notice('Simulated settlement verified · saved locally · capital conserved');
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
    $('proof').innerHTML = `<p class="${valid ? 'positive' : 'negative'}">${esc(match.id)} · ${valid ? match.type === 'tictactoe' ? 'Board and deterministic result verified' : 'SHA-256 reveals and deterministic result verified' : 'Verification failed'}</p>${match.players.map(id => `<p>${agent(id).name}: ${esc(match.type === 'tictactoe' ? `${match.moves.filter(m => m.agentId === id).length} moves` : match.reveals[id].move)} · payout ${fmt(match.payouts[id])} simulated SOL</p>`).join('')}<details><summary>Inspect complete proof</summary><pre>${esc(JSON.stringify(match, null, 2))}</pre></details>`;
  }
});
$('new-run').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || watching) return;
  try { state = configureRun(Object.fromEntries(new FormData(event.target))); selected = state.agents[0].id; current = null; phase = ''; $('proof').hidden = true; connect(); save(state); render(); notice('New experiment ready. Previous run replaced.'); }
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
  const summary = `I made ${state.agents.length} pixel agents compete in RPS and tic-tac-toe. Seed ${state.seed}, ${state.matches.filter(m => m.status === 'settled').length} settled matches, ${state.agents.filter(a => eligibility(state, a).eligible).length} still eligible. ${top.name} leads by P&L (${fmt(top.pnl)} simulated SOL). Run yours: https://github.com/lewodro/autonomous-agent-economy`;
  try { await navigator.clipboard.writeText(summary); notice('Run summary copied.'); }
  catch { notice(summary); }
});
$('treasury-controls').innerHTML = `<form id="revenue-form" class="settings-form"><label>Simulated receipt ID<input name="receipt" value="demo-receipt-1" required></label><label>Creator revenue · SOL<input name="revenue" inputmode="decimal" value="1" required></label><button type="submit">Record receipt → allocate 30% to treasury</button></form><div class="button-row" style="margin-top:12px"><button id="allocate">Distribute bounded grants</button><button id="tournament">Start tournament</button></div><p id="tournament-status" class="muted"></p><p class="muted">Duplicate receipt IDs cannot create funds twice. Grants go to lower balances first, capped at 10% of each agent's capital per allocation. Grants never reset loss limits.</p>`;
$('revenue-form').addEventListener('submit', event => {
  event.preventDefault(); if (busy || watching) return;
  try { const form = new FormData(event.target); const deposit = receiveRevenue(state, form.get('receipt'), toLamports(form.get('revenue'))); save(); render(); notice(`${fmt(deposit)} simulated SOL recorded for treasury.`); }
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
  let stopped=false;window.addEventListener('pagehide',()=>{stopped=true;});
  async function observe(){
    if(stopped)return;
    try{
      const response=await fetch(`/api/arena/rooms/${sharedRoom}`,{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error('Room unavailable');
      const snapshot=await response.json();state=snapshot.state;current=snapshot.current;phase=snapshot.phase;sharedRunId=snapshot.room.runId;
      render();$('run-status').textContent=snapshot.room.status.toUpperCase()+' · SHARED';
      notice(snapshot.room.status==='failed'?'This room has stopped. Return to the Arena and choose another room.':'LIVE · adaptive local algorithms · simulated SOL only · shared server room');
    }catch{notice('Connection interrupted. Reconnecting to the room…');$('run-status').textContent='RECONNECTING';}
    if(!stopped)setTimeout(observe,750);
  }
  observe();
}
