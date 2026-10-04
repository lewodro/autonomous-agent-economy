import {FundedRuntime} from './service/funded-runtime.js';
import {resolveConfig} from './service/config.js';
import {MachinePayments} from './service/payments.js';
import http from 'node:http';
import { readFile, writeFile, mkdir, rename, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Core } from './service/core.js';
import { MatchRuntime } from './service/runtime.js';
import { SessionStore } from './service/session-store.js';
import { MatchEventStream } from './service/event-stream.js';
import { authorizeRequest } from './service/http-policy.js';
import { validateDeploymentConfig } from './service/deployment-config.js';
import { hostCookie, hasHostCookie } from './service/host-auth.js';
const root = fileURLToPath(new URL('.', import.meta.url));
const deployment = validateDeploymentConfig();
const { production, publicOrigins } = deployment;
const directory = path.resolve(process.env.MATCHES_DIR || path.join(root,'matches'));
const core = new Core(), runtime = new MatchRuntime(new SessionStore(path.join(directory,'sessions'))), sessions = new Map();
const payments=new MachinePayments();
const liveEvents=new MatchEventStream();
const funded=new FundedRuntime(core,runtime,liveEvents,sessions);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const json = (res, status, data, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(data));
async function createSession(command, data) {
  if (sessions.size >= 100) throw new Error('Local session limit reached; restart the service to clear sessions');
  const session = randomUUID();
  sessions.set(session, true);
  try {
    const { replay } = await core.request({ command, session, ...data });
    await runtime.checkpoint(session,replay);
    sessions.set(session,{kind:'free',replay});
    return { session, replay };
  } catch (error) { sessions.delete(session);runtime.budgets.delete(session);await core.request({command:'drop',session});throw error; }
}
async function body(req, limit = 1_000_000) {
  const chunks = []; let length = 0;
  const tooLarge = () => { req.resume(); return Object.assign(new Error('Request exceeds the supported size'), { status: 413 }); };
  if (Number(req.headers['content-length']) > limit) throw tooLarge();
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { length += chunk.length; if (length > limit) throw tooLarge(); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}
async function persist(replay) {
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${replay.match_id}.json`), temp = target + `.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(replay)); await rename(temp, target);
}
const server = http.createServer(async (req, res) => {
  try {
    const denied = authorizeRequest(req, req.socket.localPort, publicOrigins);
    if (denied) return json(res, denied.status, { error: denied.error });
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json' });
    }
    if(route==='/api/labs/economy'||route==='/labs/economy'){
      if(process.env.ECONOMY_LAB!=='1')return json(res,404,{error:'Economy lab disabled'});
      if(req.method==='POST'&&route==='/api/labs/economy'){
        const data=await body(req,2048);
        return json(res,200,await core.request({command:'economy-lab',action:data.action,agent_id:data.agent_id}));
      }
      if(req.method==='GET'&&route==='/labs/economy'){
        res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
        return res.end(await readFile(path.join(root,'labs/economy.html')));
      }
      return json(res,405,{error:'Method not allowed'});
    }
    if(req.method==='GET'&&route==='/labs/funded'){
      if(process.env.ECONOMY_LAB!=='1')return json(res,404,{error:'Economy lab disabled'});
      res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});return res.end(await readFile(path.join(root,'labs/funded.html')));
    }
    if(req.method==='GET'&&route==='/api/funded-matches'){
      if(process.env.ECONOMY_LAB!=='1')return json(res,404,{error:'Funded match API disabled'});
      return json(res,200,{matches:[...funded.matches.entries()].map(([session,value])=>({session,state:value.economy.economy.state,mode:value.economy.economy.payment_mode}))});
    }
    if(req.method==='GET'&&route==='/api/economy/health')return json(res,200,funded.health());
    if(req.method==='POST'&&route==='/api/funded-matches'){
      if(process.env.ECONOMY_LAB!=='1')return json(res,404,{error:'Funded match API disabled'});
      const data=await body(req);return json(res,201,await funded.create(await resolveConfig(core,data.config),data));
    }
    const economyRoute=route.match(/^\/api\/funded-matches\/([a-f0-9-]{36})(?:\/(fund|fund-all|cancel|settle|reconcile))?$/);
    if(economyRoute){
      if(process.env.ECONOMY_LAB!=='1')return json(res,404,{error:'Funded match API disabled'});
      if(req.method==='GET'&&!economyRoute[2])return json(res,200,await funded.command(economyRoute[1],'get'));
      if(req.method==='POST'&&economyRoute[2])return json(res,200,await funded.act(economyRoute[1],economyRoute[2],await body(req)));
      return json(res,405,{error:'Method not allowed'});
    }
    if (req.method === 'POST' && route === '/api/replays/share') {
      const data = await body(req, 32_000_000);
      const { replay } = await core.request({ command: 'verify', replay: data.replay });
      await persist(replay);
      return json(res, 200, { match_id: replay.match_id });
    }
    if(req.method==='GET'&&route==='/premium-tool'){
      if(process.env.MACHINE_PAYMENTS_DEMO!=='1')return json(res,404,{error:'Machine payment demo disabled'});
      const receipt=req.headers['x-demo-payment'];
      if(!receipt)return json(res,402,{payment_required:payments.quote(),protocol:'experimental-local'});
      return json(res,200,payments.verify(receipt));
    }
    if(req.method==='POST'&&route==='/api/payments/pay'){
      if(process.env.MACHINE_PAYMENTS_DEMO!=='1')return json(res,404,{error:'Machine payment demo disabled'});
      const data=await body(req);const receipt=payments.pay(data.challenge_id,data.payer);return json(res,200,{receipt,events:payments.events.slice(-2),mode:'mock'});
    }
    if (route === '/api/health') {
      const metadata=await core.request({command:'metadata'});
      await mkdir(directory,{recursive:true});
      await access(directory,constants.W_OK);
      return json(res,200,{ok:true,engine:'Rust',storage:'ok',payments:'disabled',...metadata});
    }
    if(req.method==='GET'&&route==='/api/capabilities')return json(res,200,{
      public_site:production,
      game_modes:['last-seat','rps','tictactoe'],
      funded_modes:production?[]:process.env.ECONOMY_LAB==='1'?['mock','local']:[],
      payment_notice:production?'Public matches are free. RPS and tic-tac-toe use simulated stakes; no public SOL entry is accepted.':'Funded mock/local-validator matches require the local economy lab.'
    });
    if (req.method === 'GET' && route === '/api/config') return json(res, 200, await core.request({ command: 'defaults', count: Number(url.searchParams.get('agents') || 4) }));
    if (req.method === 'POST' && route === '/api/matches') {
      const data = await body(req);
      const created=await createSession('start', { config: await resolveConfig(core,data.config) });
      return json(res,201,created,{'Set-Cookie':hostCookie(created.session)});
    }
    if (req.method === 'POST' && route === '/api/replays/import') {
      const data = await body(req, 32_000_000);
      const created=await createSession('import', { replay: data.replay });
      return json(res,200,created,{'Set-Cookie':hostCookie(created.session)});
    }
    if(req.method==='GET'&&route==='/api/games/ongoing'){
      const games=[...sessions.entries()].flatMap(([session,value])=>{
        const replay=value&&typeof value==='object'&&'replay' in value?value.replay:funded.matches.get(session)?.replay;
        if(!replay||replay.final_state.ended||(production&&funded.matches.has(session)))return [];
        return [{session,match_id:replay.match_id,turn:replay.final_state.turn,
          alive:replay.final_state.agents.filter(agent=>agent.alive).length,
          seats:replay.config.agents.length,agents:replay.config.agents.map(agent=>({id:agent.id,name:agent.name,provider:agent.provider})),
          funded:Boolean(funded.matches.has(session))}];
      }).slice(-20).reverse();
      return json(res,200,{games});
    }
    const archived = route.match(/^\/api\/replays\/(seat-[a-f0-9]{64})$/);
    if (req.method === 'GET' && archived) {
      const replay = JSON.parse(await readFile(path.join(directory, `${archived[1]}.json`), 'utf8'));
      const { replay: checked } = await core.request({ command: 'verify', replay });
      return json(res, 200, { replay: checked });
    }
    const match = route.match(/^\/api\/matches\/([a-f0-9-]{36})(?:\/(step|share|events))?$/);
    if(match&&!sessions.has(match[1]))await funded.register(match[1]);
    if (match && sessions.has(match[1])) {
      const session = match[1];
      if (req.method === 'GET' && !match[2]) return json(res, 200, await core.request({ command: 'get', session }));
      if (req.method === 'GET' && match[2] === 'events') {const {replay,economy}=await core.request({command:'get',session});liveEvents.connect(session,replay,res,economy);return;}
      if (req.method === 'POST' && match[2] === 'share') {
        if(production&&!hasHostCookie(req,session))return json(res,403,{error:'Only the match host can share this game'});
        const { replay } = await core.request({ command: 'get', session }); await persist(replay); return json(res, 200, { match_id: replay.match_id });
      }
      if (req.method === 'POST' && match[2] === 'step') {
        if(production&&!hasHostCookie(req,session))return json(res,403,{error:'Only the match host can advance this game'});
        const data = await body(req);
        const result = await runtime.step(core,session,data);
        if(sessions.get(session)?.kind==='free')sessions.set(session,{kind:'free',replay:result.replay});
        liveEvents.publish(session,result);
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
  } catch (error) {
    let detail;try{detail=JSON.parse(error.message);}catch{}
    const status=error.status||(error.code==='ENOENT'?404:400);
    const code=error.code||detail?.code;
    if(status>=500)console.error(JSON.stringify({event:'request_failed',code:typeof code==='string'?code:'INTERNAL_ERROR'}));
    const safeMessage=production?(status===404?'Not found':status===413?'Request too large':status===429?'Too many requests':status<500?'Request rejected':'Service temporarily unavailable'):error.message;
    json(res,status,{error:safeMessage,...(typeof code==='string'?{code}:{})});
  }
});
try{await runtime.restore(core,sessions);await funded.restore();funded.start();}catch(error){console.error(`Session recovery failed: ${error.message}`);core.stop();process.exit(1);}
const {host,port}=deployment;
server.listen(port, host, () => {
  const actualPort=server.address().port;
  console.log(production?JSON.stringify({event:'server_started',host,port:actualPort,environment:'production'}):`Last Seat · Rust core · http://localhost:${actualPort}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { funded.close();liveEvents.close();core.stop(); server.close(); process.exit(0); });
server.on('error', error => { console.error(error.message); core.stop(); process.exit(1); });
