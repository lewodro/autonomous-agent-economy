import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const debug = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9322';
const targets = await fetch(`${debug}/json`).then(response => response.json());
const target = targets.find(candidate => candidate.type === 'page');
assert.ok(target, 'Start Chrome with remote debugging enabled');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0; const pending = new Map(); const errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
const wait = async expression => { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(`Timed out: ${expression}`); };
try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${process.env.GAME_URL || 'http://localhost:3000'}/rps` });
  await wait("document.getElementById('run-status')?.textContent==='READY'");
  await evaluate("localStorage.removeItem('agent-arena-v1');location.reload()");
  await wait("document.getElementById('run-status')?.textContent==='READY'");
  await evaluate("document.getElementById('speed').value='0';document.getElementById('game-type').value='tictactoe';document.getElementById('step').click()");
  await wait("document.querySelector('#history-list .history-card')?.textContent.includes('TIC-TAC-TOE')");
  assert.equal(await evaluate("document.querySelectorAll('#ttt-board span').length"), 9);
  assert.equal(await evaluate("document.getElementById('match-result').textContent.includes('settled')||document.getElementById('match-result').textContent.includes('wins')||document.getElementById('match-result').textContent.includes('Draw')"), true);
  await evaluate("document.querySelector('#history-list .history-card').click()");
  await wait("!document.getElementById('proof').hidden");
  assert.equal(await evaluate("document.getElementById('proof').textContent.includes('verified')"), true);
  await send('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(path.join(os.tmpdir(), 'agent-arena-tictactoe.png'), Buffer.from(result.data, 'base64')));
  await evaluate("document.getElementById('game-type').value='rps';document.getElementById('step').click()");
  await wait("document.querySelectorAll('#history-list .history-card').length===2");
  assert.equal(await evaluate("[...document.querySelectorAll('#history-list .history-card')].some(card=>card.textContent.includes('RPS'))"), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth<=390'), true);
  await send('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(path.join(os.tmpdir(), 'agent-arena-tictactoe-mobile.png'), Buffer.from(result.data, 'base64')));
  assert.deepEqual(errors, []);
  console.log('PASS: tic-tac-toe board/result/proof, RPS selection, saved history, and 390px layout');
} finally { socket.close(); }
