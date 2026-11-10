import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const base = process.env.GAME_URL || 'http://127.0.0.1:3000';
const chromePath = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const profile = await mkdtemp(path.join(os.tmpdir(), 'last-seat-clerk-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--disable-extensions', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
  '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
for (const stream of [chrome.stdout, chrome.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-4_000); });

async function debugUrl() {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools was ready:\n${output}`);
    try {
      const [port] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      if (/^\d+$/.test(port || '')) return `http://127.0.0.1:${port}`;
    } catch { /* Chrome has not written the port yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome DevTools did not become ready:\n${output}`);
}

async function stop() {
  if (chrome.exitCode !== null) return;
  const exited = once(chrome, 'exit');
  chrome.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3_000))]);
  if (chrome.exitCode === null) chrome.kill('SIGKILL');
}

let socket;
try {
  const debug = await debugUrl();
  const target = await fetch(`${debug}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' }).then(response => response.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  const browserErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.reject(message.error) : request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression, label) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  await send('Runtime.enable');
  await wait("document.getElementById('intro-google') && !document.getElementById('intro-google').disabled", 'configured Google button');
  await evaluate("document.getElementById('intro-google').click()");
  try {
    await wait("document.body.textContent.includes('Sign in') && !!document.querySelector('[data-clerk-component], .cl-modalBackdrop, .cl-rootBox')", 'Clerk sign-in dialog');
  } catch (error) {
    const state = await evaluate("({note:document.getElementById('intro-auth-note')?.textContent,clerk:!!window.Clerk,loaded:window.Clerk?.loaded,ui:!!window.__internal_ClerkUICtor,classes:[...document.querySelectorAll('[class*=cl-]')].slice(0,12).map(node=>node.className),scripts:[...document.scripts].filter(script=>script.src.includes('clerk')).map(script=>script.src)})");
    throw new Error(`${error.message}; state=${JSON.stringify(state)}; browserErrors=${JSON.stringify(browserErrors)}`);
  }
  assert.equal(await evaluate("document.getElementById('intro-auth-note').textContent.includes('did not complete')"), false);
  await evaluate("window.Clerk.closeSignIn()");
  await wait("!document.querySelector('.cl-modalBackdrop')", 'Clerk sign-in dialog to close');
  console.log('Clerk browser smoke passed: the sign-in dialog opened and closed.');
} finally {
  socket?.close();
  await stop();
}
