import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Core } from './service/core.js';
import { MatchRuntime } from './service/runtime.js';
import { authorizeRequest } from './service/http-policy.js';
const root = fileURLToPath(new URL('.', import.meta.url));
const core = new Core(), runtime = new MatchRuntime(), sessions = new Map();
const directory = path.join(root, 'matches');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const json = (res, status, data) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
async function createSession(command, data) {
  if (sessions.size >= 100) throw new Error('Local session limit reached; restart the service to clear sessions');
  const session = randomUUID();
  sessions.set(session, true);
  try {
    const { replay } = await core.request({ command, session, ...data });
    return { session, replay };
  } catch (error) { sessions.delete(session); throw error; }
}
async function body(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 8_000_000) throw new Error('Request exceeds 8 MB'); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}
async function persist(replay) {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${replay.match_id}.json`), temp = target + `.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(replay)); await rename(temp, target);
}
const server = http.createServer(async (req, res) => {
  try {
    const denied = authorizeRequest(req, req.socket.localPort);
    if (denied) return json(res, denied.status, { error: denied.error });
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json' });
    }
    if (req.method === 'POST' && route === '/api/replays/share') {
      const data = await body(req);
      const { replay } = await core.request({ command: 'verify', replay: data.replay });
      await persist(replay);
      return json(res, 200, { match_id: replay.match_id });
    }
    if (route === '/api/health') return json(res, 200, { ok: true, engine: 'Rust', version: 'last-seat-v3' });
    if (req.method === 'GET' && route === '/api/config') return json(res, 200, await core.request({ command: 'defaults', count: Number(url.searchParams.get('agents') || 4) }));
    if (req.method === 'POST' && route === '/api/matches') {
      const data = await body(req);
      return json(res, 201, await createSession('start', { config: data.config }));
    }
    if (req.method === 'POST' && route === '/api/replays/import') {
      const data = await body(req);
      return json(res, 200, await createSession('import', { replay: data.replay }));
    }
    const archived = route.match(/^\/api\/replays\/(seat-[a-f0-9]{64})$/);
    if (req.method === 'GET' && archived) {
      const replay = JSON.parse(await readFile(path.join(directory, `${archived[1]}.json`), 'utf8'));
      const { replay: checked } = await core.request({ command: 'verify', replay });
      return json(res, 200, { replay: checked });
    }
    const match = route.match(/^\/api\/matches\/([a-f0-9-]{36})(?:\/(step|share))?$/);
    if (match && sessions.has(match[1])) {
      const session = match[1];
      if (req.method === 'GET' && !match[2]) return json(res, 200, await core.request({ command: 'get', session }));
      if (req.method === 'POST' && match[2] === 'share') { const { replay } = await core.request({ command: 'get', session }); await persist(replay); return json(res, 200, { match_id: replay.match_id }); }
      if (req.method === 'POST' && match[2] === 'step') {
        const data = await body(req);
        const result = await runtime.step(core,session,data);
        if(result.replay.final_state.ended)await persist(result.replay);
        if(data.compact)return json(res,200,{events:result.events,match_id:result.replay.match_id,final_state:result.replay.final_state,winner:result.replay.winner,statistics:result.replay.statistics,budget:runtime.budget(session).view()});
        return json(res,200,result);
      }
    }
    if (req.method === 'POST' && route === '/api/wallet-demo') {
      // Only the offline capability is callable from the browser. No model-supplied CLI args.
      const child = spawn(path.join(root, 'rust/target/debug/wallet-demo'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => errors += b);
      await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors))); });
      return json(res, 200, JSON.parse(output));
    }
    if (route.startsWith('/api/')) return json(res, 404, { error: 'Route or local session not found' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const pathname = decodeURIComponent(route), target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname === '/rps' ? '/legacy/index.html' : pathname}`), relative = path.relative(root, target);
    if (relative.startsWith('..') || !/^(index\.html|styles\.css|legacy\/(index\.html|styles\.css|script\.js)|src\/[\w-]+\.js|web\/dist\/[\w-]+\.js|assets\/sprites-agent\/[\w-]+\.png)$/.test(relative)) { res.writeHead(404).end('Not found'); return; }
    const bytes = await readFile(target);res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(bytes);
  } catch (error) { json(res, error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.message }); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Last Seat · Rust core · http://localhost:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { core.stop(); server.close(); process.exit(0); });
server.on('error', error => { console.error(error.message); core.stop(); process.exit(1); });
