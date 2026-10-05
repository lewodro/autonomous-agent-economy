import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const session = '8d5c778d-64ee-40e1-a392-13cb3992f2da';
const agents = [
  { id: 'agent-a', name: 'A', model: 'Mock', strategy: 'aggressive', personality: 'bold', prompt: 'bold', starting_credits: 12, stats: {} },
  { id: 'agent-b', name: 'B', model: 'Mock', strategy: 'conservative', personality: 'careful', prompt: 'careful', starting_credits: 12, stats: {} }
];
const hostCookie = `last_seat_host=${session}.${Math.floor(Date.now() / 1000) + 86_400}.${'a'.repeat(43)}`;

function mcpProcess(file, port) {
  const child = spawn(process.execPath, ['mcp/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', HOST_SESSION_SECRET: '', MCP_ARENA_BASE_URL: `http://127.0.0.1:${port}`, MCP_ARENA_SESSION_FILE: file },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout });
  const pending = [];
  const waiting = [];
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  lines.on('line', line => {
    const value = JSON.parse(line);
    const resolve = waiting.shift();
    if (resolve) resolve(value); else pending.push(value);
  });
  return {
    child,
    get stderr() { return stderr; },
    async call(id, method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      if (pending.length) return pending.shift();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 3000);
        waiting.push(value => { clearTimeout(timer); resolve(value); });
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    close() {
      if (child.exitCode !== null) { lines.close(); return Promise.resolve(); }
      child.kill('SIGINT');
      return new Promise(resolve => child.once('exit', () => { lines.close(); resolve(); }));
    }
  };
}

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-seat-mcp-bridge-'));
  const storeFile = path.join(directory, 'sessions.json');
  const calls = [];
  const api = createServer(async (req, res) => {
    calls.push({ method: req.method, url: req.url, cookie: req.headers.cookie });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/config?agents=2') return res.end(JSON.stringify({ agents }));
    if (req.url === '/api/matches' && req.method === 'POST') {
      res.setHeader('set-cookie', `${hostCookie}; Path=/api/matches/${session}/; HttpOnly; SameSite=Strict`);
      return res.end(JSON.stringify({ session, replay: { match_id: 'match-one', final_state: { turn: 0 } } }));
    }
    if (req.url === `/api/matches/${session}/step` && req.method === 'POST') {
      assert.equal(req.headers.cookie, hostCookie);
      let body = ''; for await (const chunk of req) body += chunk;
      const submitted = JSON.parse(body);
      return res.end(JSON.stringify({ replay: { match_id: 'match-one', final_state: { turn: submitted.expected_turn + 1, ended: true, agents: [{ id: 'agent-a', credits: 8, alive: true }] }, winner: 'agent-a' }, events: [{ type: 'ActionResolved' }] }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve, reject) => {
    api.once('error', reject);
    api.listen(0, '127.0.0.1', () => { api.off('error', reject); resolve(); });
  });
  const port = api.address().port;
  let bridge;
  try {
    bridge = mcpProcess(storeFile, port);
    const initialized = await bridge.call(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.ok(initialized.result?.serverInfo);
    bridge.notify('notifications/initialized');
    const created = await bridge.call(2, 'tools/call', { name: 'create_arena', arguments: { seed: 42, agents: [{ id: 'agent-a' }, { id: 'agent-b' }] } });
    assert.equal(created.result.isError, undefined);
    const arena = JSON.parse(created.result.content[0].text);
    assert.equal(arena.mode, 'free_simulation');
    assert.equal(arena.arena_id, session);
    assert.equal(calls.some(call => call.cookie?.includes('last_seat_host')), false, 'cookie is not sent to non-host API calls');
    await bridge.close(); bridge = null;

    bridge = mcpProcess(storeFile, port);
    const restarted = await bridge.call(3, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.ok(restarted.result?.serverInfo);
    bridge.notify('notifications/initialized');
    const stepped = await bridge.call(4, 'tools/call', { name: 'submit_turn', arguments: { arena_id: session, expected_turn: 0, decisions: [{ agent_id: 'agent-a', action: 'work', reason: 'Gather credits.' }, { agent_id: 'agent-b', action: 'guard', reason: 'Stay safe.' }] } });
    assert.equal(stepped.result.isError, undefined);
    assert.equal(JSON.parse(stepped.result.content[0].text).winner, 'agent-a');
    assert.equal(calls.at(-1).cookie, hostCookie);
  } finally {
    if (bridge) await bridge.close();
    await new Promise(resolve => api.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
  console.log('OK MCP stdio creates and advances a free arena with its saved scoped host session.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
