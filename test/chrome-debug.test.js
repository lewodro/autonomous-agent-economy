import test from 'node:test';
import assert from 'node:assert/strict';
import { listChromeTargets } from '../scripts/chrome-debug.js';

test('Chrome DevTools preflight returns a valid target list',async()=>{
  const targets=[{type:'page',url:'http://localhost:3000'}];
  assert.deepEqual(await listChromeTargets('http://127.0.0.1:9322',async()=>new Response(JSON.stringify(targets))),targets);
});
test('Chrome DevTools preflight gives setup guidance for unreachable or malformed endpoints',async()=>{
  for(const fetchImpl of [
    async()=>{throw new TypeError('fetch failed');},
    async()=>new Response('{"not":"a target list"}')
  ])await assert.rejects(()=>listChromeTargets('http://127.0.0.1:9322',fetchImpl),/Start the app and Chrome with --remote-debugging-port=9322.*CHROME_DEBUG_URL/);
});
