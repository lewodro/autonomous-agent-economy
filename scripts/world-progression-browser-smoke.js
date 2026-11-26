/**
 * Two-browser journey for the connected adventure loop:
 * discover both reward groups → claim 10 credits → buy and equip a sword →
 * verify the cave loadout → Sword Duel → both players return to their own
 * saved world position. Desktop and mobile layouts are both exercised.
 */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listChromeTargets } from './chrome-debug.js';
import { DISCOVERY_GROUPS } from '../src/world-discovery.js';
import { SWORD_DUEL } from '../src/sword-duel.js';

const base = process.env.GAME_URL || 'http://localhost:3000';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browser(debugUrl) {
  const targets = await listChromeTargets(debugUrl);
  const target = targets.find(value => value.type === 'page') || await (await fetch(debugUrl + '/json/new?' + encodeURIComponent(base), { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) { clearTimeout(request.timer); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 20_000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression, timeoutMs = 15_000) => {
    for (let attempt = 0; attempt < Math.ceil(timeoutMs / 100); attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Browser condition timed out: ${expression}`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront');
  return {
    send, evaluate, wait, errors,
    navigate: async url => { await send('Page.navigate', { url }); await wait('document.readyState === "complete"'); },
    close: () => { for (const request of pending.values()) clearTimeout(request.timer); socket.close(); },
  };
}
async function enterWorld(page) {
  await page.wait('document.getElementById("connection")?.textContent.includes("HERE")', 20_000);
  if (await page.evaluate('document.getElementById("character-dialog")?.open === true')) {
    await page.evaluate('document.getElementById("enter-world").click()');
    await page.wait('document.getElementById("character-dialog").open === false');
  }
}
const screenshot = async (page, name) => {
  if (process.env.WORLD_SCREENSHOTS !== '1') return;
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(os.tmpdir(), `agent-world-progression-${name}.png`), Buffer.from(result.data, 'base64'));
};

let first, second, failed = false;
try {
  first = await browser(process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9322');
  second = await browser(process.env.CHROME_DEBUG_URL_2 || 'http://127.0.0.1:9323');
  await first.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await second.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await first.navigate(base + '/world');
  await second.navigate(base + '/world');
  await enterWorld(first); await enterWorld(second);

  // --- discovery rewards ---
  const creditReport = async (page, found, requestIdVar) => page.evaluate(`(async()=>{
    const response = await fetch('/api/world/farm/discovery',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({found:${JSON.stringify(found)},request_id:${requestIdVar}})});
    return {status:response.status,...await response.json()};
  })()`);
  const before = await first.evaluate("fetch('/api/world/farm').then(r=>r.json()).then(s=>s.account.credits)");
  await first.evaluate('window.__claimA=crypto.randomUUID()');
  const firstClaim = await creditReport(first, DISCOVERY_GROUPS[0].sites, 'window.__claimA');
  assert.equal(firstClaim.status, 200);
  assert.equal(firstClaim.rewards.length, 1);
  assert.equal(firstClaim.rewards[0].credits, 5);
  assert.equal(firstClaim.account.credits, before + 5, 'completing a group pays exactly five credits');
  const duplicate = await creditReport(first, DISCOVERY_GROUPS[0].sites, 'window.__claimA');
  assert.deepEqual(duplicate.rewards, [], 'a replayed claim pays no second reward');
  assert.equal(duplicate.account.credits, before + 5);
  await first.evaluate('window.__claimB=crypto.randomUUID()');
  const secondClaim = await creditReport(first, DISCOVERY_GROUPS[1].sites, 'window.__claimB');
  assert.equal(secondClaim.account.credits, before + 10, 'both groups pay ten credits total');
  // A real refresh must hydrate the claimed state from the account, not memory.
  await first.navigate(base + '/world');
  await enterWorld(first);
  await first.evaluate("document.getElementById('minimap-journal').click()");
  await first.wait("document.getElementById('interaction-title').textContent==='DISCOVERIES'");
  const journal = await first.evaluate("document.getElementById('interaction-content').textContent");
  assert.ok(journal.includes('WILDERNESS TRAILS') && journal.includes('FROSTGATE ASCENT'), 'both reward groups appear in the journal');
  assert.ok(journal.includes('5 CREDITS CLAIMED'), 'claimed groups are marked in the journal');
  assert.equal(await first.evaluate("document.querySelectorAll('.discovery-group').length"), 5, 'the original kind groups stay intact');
  await screenshot(first, 'reward-journal');
  await first.evaluate("document.getElementById('interaction-close').click()");
  await first.wait('document.getElementById("interaction-dialog").open === false');

  // --- marketplace and cave loadout ---
  const purchase = await first.evaluate(`fetch('/api/world/farm/equipment',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'buy',item_id:'iron_sword',request_id:crypto.randomUUID()})}).then(async r=>({status:r.status,...await r.json()}))`);
  assert.equal(purchase.status, 200);
  assert.equal(purchase.account.credits, before, 'the ten discovery credits buy the first iron sword');
  assert.equal(purchase.account.equipment.owned.iron_sword, 1);
  const equipped = await first.evaluate(`fetch('/api/world/farm/equipment',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'equip',item_id:'iron_sword',request_id:crypto.randomUUID()})}).then(async r=>({status:r.status,...await r.json()}))`);
  assert.equal(equipped.account.equipment.equipped.weapon, 'iron_sword');

  await first.navigate(base + '/labs/world');
  await first.wait('document.getElementById("world-lab") && !document.getElementById("world-lab").hidden');
  await enterWorld(first);
  await first.evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Open Bazaar profile terminal').click()");
  await first.wait('!document.getElementById("interact").disabled');
  await first.evaluate('document.getElementById("interact").click()');
  await first.wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent.startsWith('BAZAAR')");
  await first.wait("document.querySelector('.equipment-card[data-item=\\'iron_sword\\']')", 10_000);
  assert.ok(await first.evaluate("document.querySelector('.equipment-card[data-item=\\'iron_sword\\']').textContent.includes('EQUIPPED')"), 'the bazaar shows owned and equipped gear');
  assert.ok(await first.evaluate("document.querySelector('.equipment-card[data-item=iron_sword] canvas') instanceof HTMLCanvasElement"), 'equipment icons are original pixel-art canvases');
  await screenshot(first, 'bazaar-equipment');
  await first.evaluate("document.getElementById('interaction-close').click()");
  await first.wait('document.getElementById("interaction-dialog").open === false');

  await first.wait("document.querySelector('#world-lab pre')?.textContent.includes('player')");
  await first.evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Northern cave').click()");
  await first.wait("JSON.parse(document.querySelector('#world-lab pre').textContent).player.x < -600");
  await first.wait('!document.getElementById("interact").disabled');
  await first.evaluate('document.getElementById("interact").click()');
  await first.wait("document.getElementById('interaction-title').textContent==='DANGEROUS AREA'");
  await first.evaluate("[...document.querySelectorAll('#interaction-content button')].find(b=>b.textContent==='ENTER').click()");
  await first.wait("document.body.dataset.caveReady==='1'&&document.getElementById('cave-weapon').textContent.includes('IRON SWORD')", 15_000);
  await screenshot(first, 'cave-equipped');
  await first.navigate(base + '/world?return=cave');
  await enterWorld(first);

  // --- Sword Duel with two real browser sessions ---
  // Both visitors walk the same northern trail so the challenge is genuinely
  // proximity-based; the lab teleport keeps the headless journey deterministic.
  await second.navigate(base + '/labs/world');
  await second.wait('document.getElementById("world-lab") && !document.getElementById("world-lab").hidden');
  await enterWorld(second);
  await second.wait("document.querySelector('#world-lab pre')?.textContent.includes('player')");
  await second.evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Northern cave').click()");
  await second.wait("JSON.parse(document.querySelector('#world-lab pre').textContent).player.x < -600");
  const homeA = await first.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
  const homeB = await second.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
  await enterWorld(first);
  await first.wait('!document.getElementById("quick-chat-open").hidden', 8000);
  const challenge = await first.evaluate("fetch('/api/worlds/main/presence/quick-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase_id:'sword'})}).then(async r=>({status:r.status,...await r.json()}))");
  assert.equal(challenge.status, 200);
  assert.equal(challenge.challenge.game, 'swordduel');
  await second.wait('!document.getElementById("challenge-prompt").hidden&&document.getElementById("challenge-game").textContent.includes("SWORD DUEL")', 8000);
  await second.evaluate('document.getElementById("challenge-accept").click()');
  await first.wait("location.pathname.startsWith('/duel/')", 10_000);
  await second.wait("location.pathname.startsWith('/duel/')", 10_000);
  await first.wait("document.getElementById('duel-title').textContent.includes('SWORD DUEL')&&!document.getElementById('duel-arena').hidden", 10_000);
  await second.wait("document.getElementById('duel-title').textContent.includes('SWORD DUEL')&&!document.getElementById('duel-arena').hidden", 10_000);
  assert.ok(await first.evaluate("document.getElementById('duel-hint').textContent.includes('standardised')"), 'duel UI states that gear is standardised');
  assert.equal(await first.evaluate(`fetch('/api/world/duels/'+location.pathname.split('/')[2]).then(r=>r.json()).then(s=>s.combat.standardized)`), true);

  // Mobile layout keeps touch controls reachable in the arena.
  await second.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(300);
  assert.ok(await second.evaluate('document.documentElement.scrollWidth<=390'), 'the Sword Duel arena fits a 390px viewport');
  assert.ok(await second.evaluate(`(()=>{const s=document.getElementById('duel-strike').getBoundingClientRect(),d=document.getElementById('duel-dodge').getBoundingClientRect();return s.height>=44&&d.height>=44})()`), 'mobile combat controls stay tappable');
  await screenshot(second, 'sword-duel-mobile');

  // Walk both fighters into range with the real keyboard path, then strike.
  const positions = async () => first.evaluate(`fetch('/api/world/duels/'+location.pathname.split('/')[2]).then(r=>r.json()).then(s=>({a:s.fighters[0],b:s.fighters[1]}))`);
  const hold = async (page, key, ms) => {
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
    await delay(ms);
    await page.evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true}))`);
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await positions();
    // Stop before the fighters cross so the challenger is still facing the
    // opponent; a later tick can otherwise swap their left/right order.
    if (state.a.x < state.b.x && Math.hypot(state.a.x - state.b.x, state.a.y - state.b.y) <= 100) break;
    await Promise.all([hold(first, 'ArrowRight', 260), hold(second, 'ArrowLeft', 260)]);
  }
  let inRange = await positions();
  if (inRange.a.x > inRange.b.x) {
    await hold(first, 'ArrowLeft', 70);
    inRange = await positions();
  }
  assert.ok(Math.hypot(inRange.a.x - inRange.b.x, inRange.a.y - inRange.b.y) <= 74, 'both players converge in the shared arena');
  assert.ok(inRange.a.facing === 'right' ? inRange.a.x < inRange.b.x : inRange.a.x > inRange.b.x, 'the attacker faces the opponent');
  for (let swing = 0; swing < 16; swing++) {
    if (await first.evaluate("document.getElementById('duel-status').textContent.includes('VICTORY')")) break;
    const current = await positions();
    const distance = Math.hypot(current.a.x - current.b.x, current.a.y - current.b.y);
    if (distance > 55) {
      const toward = current.a.x < current.b.x ? 'ArrowRight' : 'ArrowLeft';
      await hold(first, toward, Math.min(240, Math.max(70, (distance - 50) / SWORD_DUEL.speed * 1000)));
    }
    await first.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true}))");
    await delay(620);
  }
  await first.wait("!document.getElementById('duel-result').hidden&&document.getElementById('duel-result').textContent.includes('VICTORY')", 12_000);
  await second.wait("!document.getElementById('duel-result').hidden&&document.getElementById('duel-status').textContent.includes('DEFEAT')", 12_000);
  assert.ok(await first.evaluate("document.getElementById('duel-hint').textContent.includes('saved world position')"), 'victory explains the return to the saved position');
  await screenshot(first, 'sword-duel-victory');

  await first.evaluate('document.getElementById("duel-return").click()');
  await second.evaluate('document.getElementById("duel-return").click()');
  await first.wait("location.pathname==='/world'", 10_000);
  await second.wait("location.pathname==='/world'", 10_000);
  await enterWorld(first); await enterWorld(second);
  const returnA = await first.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
  const returnB = await second.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
  assert.ok(Math.hypot(returnA.x - homeA.x, returnA.y - homeA.y) < 1, 'the winner returns to its prior world position');
  assert.ok(Math.hypot(returnB.x - homeB.x, returnB.y - homeB.y) < 1, 'the loser returns to its prior world position');
  assert.deepEqual(first.errors, [], 'no browser exceptions in the primary session');
  assert.deepEqual(second.errors, [], 'no browser exceptions in the second session');
  console.log('PASS progression: discovery rewards, marketplace equipment, cave loadout, two-browser Sword Duel, desktop/mobile controls');
} catch (error) { failed = true; console.error(error); }
finally { first?.close(); second?.close(); process.exit(failed ? 1 : 0); }
