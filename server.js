import {FundedRuntime} from './service/funded-runtime.js';
import {resolveConfig} from './service/config.js';
import {MachinePayments} from './service/payments.js';
import http from 'node:http';
import { readFile, mkdir, access } from 'node:fs/promises';
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
import { KeyedSlidingWindowLimiter, SlidingWindowLimiter } from './service/rate-limit.js';
import { clientRateKey } from './service/client-ip.js';
import { ArenaRoomPool } from './service/arena-rooms.js';
import { TableSession, visitorIdentity } from './service/world-table.js';
import { requestErrorStatus } from './service/http-error.js';
import { ReplayArchive } from './service/replay-archive.js';
import { WorldPresenceService } from './service/world-presence.js';
import { RoomSpectators } from './service/room-spectators.js';
import { OwnershipStore } from './service/ownership-store.js';
import { approvedAvatarSpritesFromManifest, toWorldAgentProfiles } from './service/world-agent-profiles.js';
import { WalletChallengeService } from './service/wallet-auth.js';
import { ownerCookie, ownerCookieClear, ownerSessionFromRequest } from './service/owner-auth.js';
const root = fileURLToPath(new URL('.', import.meta.url));
const avatarManifest = JSON.parse(await readFile(path.join(root, 'assets/avatars/index.json'), 'utf8'));
const approvedAvatarIds = avatarManifest.avatars?.filter(avatar => avatar.approved === true).map(avatar => avatar.id) || [];
const approvedAvatarSet = new Set(approvedAvatarIds);
const approvedAvatarSprites=approvedAvatarSpritesFromManifest(avatarManifest);
const deployment = validateDeploymentConfig();
const { production, publicDevnet, publicOrigins, appMode, solanaNetwork, trustProxy, publicModelInferenceEnabled, mainnetAgentFundingEnabled, mainnetMatchWageringEnabled } = deployment;
const fundedApiEnabled=!production||process.env.ECONOMY_LAB==='1'||publicDevnet;
const directory = path.resolve(process.env.MATCHES_DIR || path.join(root,'matches'));
const replayArchive=new ReplayArchive(directory);
const core = new Core(), runtime = new MatchRuntime(new SessionStore(path.join(directory,'sessions'))), sessions = new Map();
const payments=new MachinePayments();
const liveEvents=new MatchEventStream();
const funded=new FundedRuntime(core,runtime,liveEvents,sessions,{ensureCapacity:ensureSessionCapacity});
const publicMatchCreates=new SlidingWindowLimiter({limit:30,windowMs:60_000});
const publicModelMatchCreates=new SlidingWindowLimiter({limit:2,windowMs:60_000});
const publicReplayShares=new KeyedSlidingWindowLimiter({limit:10,windowMs:60_000});
const publicReplayImports=new KeyedSlidingWindowLimiter({limit:6,windowMs:60_000});
const publicFundedCreates=new SlidingWindowLimiter({limit:6,windowMs:10*60_000});
const arenaRooms=new ArenaRoomPool(path.join(directory,'arena'));
const worldTable=new TableSession(path.join(directory,'world'));
const walletChallenges=new WalletChallengeService();
const ownershipStore=new OwnershipStore(path.join(directory,'identity'));
function authenticatedOwner(req){const session=ownerSessionFromRequest(req);if(!session)return null;const owner=ownershipStore.owner(session.ownerId);return owner?.session_version===session.sessionVersion?owner:null;}
const identityCreates=new KeyedSlidingWindowLimiter({limit:20,windowMs:60_000});
const walletChallengeRequests=new KeyedSlidingWindowLimiter({limit:20,windowMs:60_000});
const walletVerifyRequests=new KeyedSlidingWindowLimiter({limit:12,windowMs:60_000});
const walletDemoRequests=new KeyedSlidingWindowLimiter({limit:10,windowMs:60_000});
const agentCreates=new KeyedSlidingWindowLimiter({limit:30,windowMs:60_000});
const agentFundingRequests=new KeyedSlidingWindowLimiter({limit:30,windowMs:60_000});
const agentPolicyChanges=new KeyedSlidingWindowLimiter({limit:30,windowMs:60_000});
const presenceJoins=new KeyedSlidingWindowLimiter({limit:12,windowMs:60_000});
const spectatorJoins=new KeyedSlidingWindowLimiter({limit:30,windowMs:60_000});
const tableActions=new KeyedSlidingWindowLimiter({limit:120,windowMs:60_000});
let shuttingDown=false;
let capacityQueue=Promise.resolve(),pendingSessionAdmissions=0;
const worldPresence=new WorldPresenceService({allowedAvatars:approvedAvatarIds});
const roomSpectators=new RoomSpectators();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const json = (res, status, data, headers = {}) => res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(data));
function enforcePublicModelAdmission(config){
  const usesServerModel=config?.agents?.some(agent=>['http','openai-compatible'].includes(agent.provider));
  if(!production||!usesServerModel)return;
  if(!publicModelInferenceEnabled)throw Object.assign(new Error('Server-paid model inference is disabled for public matches.'),{status:403,code:'PUBLIC_MODEL_INFERENCE_DISABLED'});
  if(!publicModelMatchCreates.allow())throw Object.assign(new Error('Model-backed match creation is temporarily limited.'),{status:429,code:'PUBLIC_MODEL_MATCH_RATE_LIMITED'});
}
async function createSession(command, data) {
  const config=command==='start'?data.config:data.replay?.config;
  enforcePublicModelAdmission(config);
  const releaseAdmission=await ensureSessionCapacity();
  const session = randomUUID();
  sessions.set(session, true);
  releaseAdmission();
  try {
    const { replay } = await core.request({ command, session, ...data });
    await runtime.checkpoint(session,replay);
    if(replay.final_state.ended){await persist(replay);await runtime.store?.archive(session,replay.match_id);}
    sessions.set(session,{kind:'free',replay});
    return { session, replay };
  } catch (error) { sessions.delete(session);await core.request({command:'drop',session}).catch(()=>{});await runtime.remove(session).catch(()=>{});throw error; }
}
async function body(req, limit = 1_000_000) {
  const chunks = []; let length = 0;
  const tooLarge = () => { req.resume(); return Object.assign(new Error('Request exceeds the supported size'), { status: 413 }); };
  if (Number(req.headers['content-length']) > limit) throw tooLarge();
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { length += chunk.length; if (length > limit) throw tooLarge(); chunks.push(chunk); }
  const value=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
  if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('Request body must be a JSON object'),{status:400,code:'INVALID_BODY'});
  return value;
}
async function persist(replay) {
  await replayArchive.save(replay);
}
async function ensureSessionCapacity(){
  let unlock;
  const previous=capacityQueue;
  capacityQueue=new Promise(resolve=>{unlock=resolve;});
  await previous;
  try{
    for(const [session,value] of sessions){
      if(sessions.size+pendingSessionAdmissions<100)break;
      if(value?.kind!=='free'||!value.replay?.final_state?.ended||liveEvents.hasViewers(session))continue;
      await persist(value.replay);
      await runtime.store?.archive(session,value.replay.match_id);
      await core.request({command:'drop',session});
      await runtime.remove(session);
      sessions.delete(session);
    }
    if(sessions.size+pendingSessionAdmissions>=100)throw Object.assign(new Error('Session capacity reached: all retained sessions are active or currently watched'),{status:429,code:'SESSION_CAPACITY'});
    pendingSessionAdmissions++;
  }finally{unlock();}
  let released=false;
  return ()=>{if(!released){pendingSessionAdmissions--;released=true;}};
}
const server = http.createServer(async (req, res) => {
  try {
    if(shuttingDown){req.resume();return json(res,503,{error:'Service is shutting down'});}
    const denied = authorizeRequest(req, req.socket.localPort, publicOrigins);
    if (denied) return json(res, denied.status, { error: denied.error });
    const url = new URL(req.url, 'http://localhost'), route = url.pathname;
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Use application/json' });
    }
    if(req.method==='POST'&&route==='/api/auth/anonymous'){
      await body(req,1024);
      const currentOwner=authenticatedOwner(req);
      if(currentOwner)return json(res,200,{owner:{id:currentOwner.id,created_at:currentOwner.created_at,identity_type:currentOwner.identity_type,wallet_public_key:currentOwner.wallet_public_key||null}},{'Set-Cookie':ownerCookie(currentOwner.id,process.env,Date.now(),currentOwner.session_version)});
      if(!identityCreates.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Identity creation is temporarily limited',code:'RATE_LIMITED'});
      const owner=await ownershipStore.createAnonymous(req.headers['idempotency-key']);
      console.log(JSON.stringify({event:'owner_created',identity_type:'anonymous'}));
      return json(res,201,{owner},{'Set-Cookie':ownerCookie(owner.id,process.env,Date.now(),0)});
    }
    if(req.method==='POST'&&route==='/api/auth/wallet/challenge'){
      if(!walletChallengeRequests.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Wallet sign-in is temporarily limited',code:'RATE_LIMITED'});
      const data=await body(req,2048),origin=req.headers.origin||deployment.publicOrigin||`http://${req.headers.host}`,owner=authenticatedOwner(req);
      const ownerContext=owner?{ownerId:owner.id,sessionVersion:owner.session_version}:null;
      const challenge=walletChallenges.issue(data.public_key,origin,ownerContext);
      return json(res,200,challenge);
    }
    if(req.method==='POST'&&route==='/api/auth/wallet/verify'){
      if(!walletVerifyRequests.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Wallet verification is temporarily limited',code:'RATE_LIMITED'});
      const data=await body(req,4096),origin=req.headers.origin||deployment.publicOrigin||`http://${req.headers.host}`,currentOwner=authenticatedOwner(req);
      const ownerContext=currentOwner?{ownerId:currentOwner.id,sessionVersion:currentOwner.session_version}:null;
      const verified=walletChallenges.verify(data.challenge_id,data.public_key,data.signature,origin,ownerContext);
      if(currentOwner?.identity_type==='solana'&&currentOwner.wallet_public_key!==verified.publicKey)return json(res,409,{error:'This profile already has a different wallet. Sign out before signing in with another wallet.',code:'OWNER_WALLET_ALREADY_LINKED'});
      const owner=currentOwner?.identity_type==='anonymous'
        ?await ownershipStore.linkWalletOwner(currentOwner.id,verified.publicKey)
        :await ownershipStore.createWalletOwner(verified.publicKey);
      console.log(JSON.stringify({event:'wallet_login_verified'}));
      const current=ownershipStore.owner(owner.id);
      return json(res,200,{owner},{'Set-Cookie':ownerCookie(owner.id,process.env,Date.now(),current.session_version)});
    }
    if(req.method==='POST'&&route==='/api/auth/logout'){const owner=authenticatedOwner(req);if(owner)await ownershipStore.revokeSessions(owner.id,owner.session_version);return json(res,200,{ok:true},{'Set-Cookie':ownerCookieClear()});}
    if(route==='/api/me'){
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
      const owner=authenticatedOwner(req);
      if(!owner)return json(res,401,{error:'Sign in or continue as a guest',code:'OWNER_SESSION_REQUIRED'},{'Set-Cookie':ownerCookieClear()});
      return json(res,200,{owner:{id:owner.id,created_at:owner.created_at,identity_type:owner.identity_type,wallet_public_key:owner.wallet_public_key||null}});
    }
    if(route==='/api/me/agents'){
      const owner=authenticatedOwner(req);if(!owner)return json(res,401,{error:'Sign in or continue as a guest',code:'OWNER_SESSION_REQUIRED'});
      if(req.method==='GET')return json(res,200,{agents:ownershipStore.agentsForOwner(owner.id).map(agent=>({...agent,owner_id:undefined}))});
      if(req.method==='POST'){
        if(!agentCreates.allow(owner.id))return json(res,429,{error:'Agent creation is temporarily limited',code:'RATE_LIMITED'});
        const data=await body(req,8192),agent=await ownershipStore.createAgent(owner.id,data,approvedAvatarSet,{idempotencyKey:req.headers['idempotency-key']});
        console.log(JSON.stringify({event:'agent_created',ownership_status:'user',provider:'mock'}));
        return json(res,201,{agent:{...agent,owner_id:undefined}});
      }
      return json(res,405,{error:'Method not allowed'});
    }
    if(route==='/api/me/agents/import'&&req.method==='POST'){
      const owner=authenticatedOwner(req);if(!owner)return json(res,401,{error:'Sign in or continue as a guest',code:'OWNER_SESSION_REQUIRED'});
      if(!agentCreates.allow(owner.id))return json(res,429,{error:'Agent creation is temporarily limited',code:'RATE_LIMITED'});
      const data=await body(req,8192),agent=await ownershipStore.createAgent(owner.id,data,approvedAvatarSet,{importing:true,idempotencyKey:req.headers['idempotency-key']});
      console.log(JSON.stringify({event:'agent_imported',ownership_status:'user',provider:'mock'}));
      return json(res,201,{agent:{...agent,owner_id:undefined}});
    }
    const agentExport=route.match(/^\/api\/me\/agents\/(u-[a-f0-9-]{36})\/export$/);
    if(agentExport&&req.method==='GET'){
      const owner=authenticatedOwner(req),agent=owner?ownershipStore.exportAgent(owner.id,agentExport[1]):null;
      return agent?json(res,200,{agent}):json(res,owner?404:401,{error:owner?'Agent not found':'Owner session required',code:owner?'AGENT_NOT_FOUND':'OWNER_SESSION_REQUIRED'});
    }
    const agentAction=route.match(/^\/api\/me\/agents\/(u-[a-f0-9-]{36})\/(mock-fund|spending-policy|treasury|transactions)$/);
    if(agentAction){
      const owner=authenticatedOwner(req);if(!owner)return json(res,401,{error:'Owner session required',code:'OWNER_SESSION_REQUIRED'});
      const ownerId=owner.id,[,id,action]=agentAction;if(!ownershipStore.agentExists(ownerId,id))return json(res,404,{error:'Agent not found',code:'AGENT_NOT_FOUND'});
      if(action==='treasury'&&req.method==='GET')return json(res,200,{treasury:ownershipStore.agentSummaryForOwner(ownerId,id).treasury});
      if(action==='transactions'&&req.method==='GET'){
        const rawLimit=url.searchParams.get('limit'),limit=rawLimit===null?50:Number(rawLimit);
        if(rawLimit!==null&&!/^(?:[1-9][0-9]?)$|^100$/.test(rawLimit))return json(res,400,{error:'Page size must be an integer from 1 to 100',code:'INVALID_PAGE_SIZE'});
        try{return json(res,200,ownershipStore.transactionsForOwner(ownerId,id,{limit,before:url.searchParams.get('before')}));}
        catch(error){if(error.status)return json(res,error.status,{error:error.message,code:error.code});throw error;}
      }
      if(action==='mock-fund'&&req.method==='POST'){
        if(appMode!=='mock')return json(res,409,{error:'Simulated credits are available only in mock mode',code:'MOCK_MODE_REQUIRED'});
        if(!agentFundingRequests.allow(ownerId))return json(res,429,{error:'Agent funding requests are temporarily limited',code:'RATE_LIMITED'});
        const data=await body(req,1024),result=await ownershipStore.mockFund(ownerId,id,data.amount,{idempotencyKey:req.headers['idempotency-key']});
        console.log(JSON.stringify({event:'agent_mock_funded',network:'mock'}));return json(res,200,result);
      }
      if(action==='spending-policy'&&req.method==='POST'){
        if(!agentPolicyChanges.allow(ownerId))return json(res,429,{error:'Agent policy changes are temporarily limited',code:'RATE_LIMITED'});
        return json(res,200,{spending_policy:await ownershipStore.setSpendingPolicy(ownerId,id,await body(req,2048))});
      }
      return json(res,405,{error:'Method not allowed'});
    }
    if(route==='/api/agents'&&req.method==='GET'){
      const rawLimit=url.searchParams.get('limit'),limit=rawLimit===null?50:Number(rawLimit);
      if(rawLimit!==null&&!/^(?:[1-9][0-9]?)$|^100$/.test(rawLimit))return json(res,400,{error:'Page size must be an integer from 1 to 100',code:'INVALID_PAGE_SIZE'});
      const page=ownershipStore.listPublicAgents({after:url.searchParams.get('after'),limit});return json(res,200,page);
    }
    const publicAgent=route.match(/^\/api\/agents\/(u-[a-f0-9-]{36})$/);
    if(publicAgent&&req.method==='GET'){
      const agent=ownershipStore.publicAgent(publicAgent[1]);return agent?json(res,200,{agent}):json(res,404,{error:'Agent not found',code:'AGENT_NOT_FOUND'});
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
    if(route==='/labs/world'&&(production||process.env.WORLD_LAB!=='1'))return json(res,404,{error:'World lab disabled'});
    const presenceRoute=route.match(/^\/api\/worlds\/([a-zA-Z0-9_-]{1,64})\/presence(?:\/(join|move|heartbeat|leave|events))?$/);
    if(presenceRoute) {
      const [,worldId,action]=presenceRoute;
      if(req.method==='GET'&&!action)return json(res,200,worldPresence.snapshot(worldId));
      if(req.method==='GET'&&action==='events'){
        if(!worldPresence.connect(worldId,res))return json(res,429,{error:'Too many world spectators. Try again shortly.'});
        return;
      }
      if(req.method!=='POST'||!['join','move','heartbeat','leave'].includes(action))return json(res,405,{error:'Method not allowed'});
      if(action==='join'&&!presenceJoins.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'World join requests are temporarily limited',code:'RATE_LIMITED'});
      const data=await body(req,4096);
      const result=action==='join'?worldPresence.join(worldId,data):action==='move'?worldPresence.move(worldId,data):action==='heartbeat'?worldPresence.heartbeat(worldId,data):worldPresence.leave(worldId,data);
      return json(res,action==='join'?201:200,result);
    }
    if(req.method==='GET'&&route==='/api/funded-matches'){
      if(!fundedApiEnabled)return json(res,404,{error:'Funded match API disabled'});
      return json(res,200,{matches:[...funded.matches.entries()].map(([session,value])=>({session,state:value.economy.economy.state,mode:value.economy.economy.payment_mode}))});
    }
    if(req.method==='GET'&&route==='/api/economy/health')return json(res,200,funded.health());
    if(route==='/api/world/table'||/^\/api\/world\/table\/(join|leave|start|move)$/.test(route)){
      const visitor=visitorIdentity(req);
      if(req.method==='GET'&&route==='/api/world/table')return json(res,200,worldTable.snapshot(visitor.hash));
      if(req.method==='POST'&&route!=='/api/world/table'){
        if(!tableActions.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Table actions are temporarily limited. Try again shortly.'});
        const snapshot=await worldTable.act(visitor.hash,route.split('/').at(-1),await body(req,2048));
        return json(res,200,snapshot,{'Set-Cookie':`world_visitor=${visitor.token}; HttpOnly; SameSite=Strict; Path=/api/world/table; Max-Age=86400${production?'; Secure':''}`});
      }
      return json(res,405,{error:'Method not allowed'});
    }
    const roomSpectatorRoute=route.match(/^\/api\/arena\/rooms\/(rps-[12]|ttt-[12])\/spectators\/(join|heartbeat|leave)$/);
    if(roomSpectatorRoute){
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      const [,roomId,action]=roomSpectatorRoute;arenaRooms.getRoom(roomId);
      if(action==='join'&&!spectatorJoins.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Room spectator joins are temporarily limited. Try again shortly.',code:'RATE_LIMITED'});
      const data=await body(req,2048);
      const result=action==='join'?roomSpectators.join(roomId,data):action==='heartbeat'?roomSpectators.heartbeat(roomId,data):roomSpectators.leave(roomId,data);
      return json(res,action==='join'?201:200,result);
    }
    if(route.startsWith('/api/arena/')){
      if(req.method!=='GET')return json(res,405,{error:'Arena rooms are read-only'});
      if(route==='/api/arena/rooms')return json(res,200,{rooms:arenaRooms.listRooms().map(room=>({...room,spectators:roomSpectators.count(room.id)}))});
      if(route==='/api/arena/agents')return json(res,200,{agents:[...arenaRooms.profiles(),...toWorldAgentProfiles(ownershipStore.recentPublicAgents(100),approvedAvatarSprites)]});
      if(route==='/api/arena/statistics')return json(res,200,arenaRooms.statistics());
      if(route==='/api/arena/history')return json(res,200,{matches:arenaRooms.history()});
      const room=route.match(/^\/api\/arena\/rooms\/(rps-[12]|ttt-[12])$/);
      if(room)return json(res,200,arenaRooms.getRoom(room[1]));
      const log=route.match(/^\/api\/arena\/logs\/([a-f0-9-]{36})$/);
      if(log)return json(res,200,arenaRooms.log(log[1]),{'Content-Disposition':`attachment; filename="arena-${log[1]}.json"`});
      return json(res,404,{error:'Arena resource not found'});
    }
    if(req.method==='POST'&&route==='/api/funded-matches'){
      if(!fundedApiEnabled)return json(res,404,{error:'Funded match API disabled'});
      if(production&&!publicFundedCreates.allow())return json(res,429,{error:'Funded match creation is temporarily limited. Try again later.'});
      const data=await body(req);
      if(publicDevnet&&data.mode!=='devnet')return json(res,400,{error:'Public funded matches require Devnet test SOL'});
      const config=await resolveConfig(core,data.config);
      enforcePublicModelAdmission(config);
      const created=await funded.create(config,data);
      return json(res,201,created,{'Set-Cookie':hostCookie(created.session,process.env,Date.now(),'funded-matches')});
    }
    const economyRoute=route.match(/^\/api\/funded-matches\/([a-f0-9-]{36})(?:\/(fund|fund-all|cancel|settle|reconcile))?$/);
    if(economyRoute){
      if(!fundedApiEnabled)return json(res,404,{error:'Funded match API disabled'});
      if(req.method==='GET'&&!economyRoute[2])return json(res,200,await funded.command(economyRoute[1],'get'));
      if(req.method==='POST'&&economyRoute[2]){
        if(production&&!hasHostCookie(req,economyRoute[1]))return json(res,403,{error:'Only the match host can change funding or settlement'});
        return json(res,200,await funded.act(economyRoute[1],economyRoute[2],await body(req)));
      }
      return json(res,405,{error:'Method not allowed'});
    }
    if (req.method === 'POST' && route === '/api/replays/share') {
      if(!publicReplayShares.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Replay sharing is temporarily limited. Try again shortly.',code:'RATE_LIMITED'});
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
      return json(res,200,{ok:true,engine:'Rust',storage:'ok',identity_storage:'ok',runtime_mode:appMode,solana_network:solanaNetwork,wallet_auth_available:true,public_model_inference_enabled:publicModelInferenceEnabled,agent_funding:appMode==='mock'?'simulated_only':'disabled',mainnet_agent_funding_enabled:mainnetAgentFundingEnabled,mainnet_match_wagering_enabled:mainnetMatchWageringEnabled,presence:worldPresence.health(),arena:arenaRooms.health(),payments:publicDevnet?'devnet_test_sol':'disabled',...metadata});
    }
    if(req.method==='GET'&&route==='/api/capabilities')return json(res,200,{
      public_site:production,runtime_mode:appMode,solana_network:solanaNetwork,public_model_inference_enabled:publicModelInferenceEnabled,ownership:{wallet_auth_available:true,agent_creation_available:true,mock_agent_funding:appMode==='mock',mainnet_agent_funding_enabled:mainnetAgentFundingEnabled,mainnet_match_wagering_enabled:mainnetMatchWageringEnabled},
      game_modes:['last-seat','rps','tictactoe'],
      funded_modes:publicDevnet?['devnet']:production?[]:['mock','local'],
      payment_notice:publicDevnet?'Devnet test SOL only. Agent addresses and transactions are public on Solscan; test SOL has no monetary value.':production?'Public matches are free. RPS and tic-tac-toe use simulated stakes; no public SOL entry is accepted.':'Funded mock/local-validator matches require the local economy lab.'
    });
    if (req.method === 'GET' && route === '/api/config') return json(res, 200, await core.request({ command: 'defaults', count: Number(url.searchParams.get('agents') || 4) }));
    if (req.method === 'POST' && route === '/api/matches') {
      if(production&&!publicMatchCreates.allow())return json(res,429,{error:'Match creation is temporarily limited. Try again later.'});
      const data = await body(req);
      const created=await createSession('start', { config: await resolveConfig(core,data.config) });
      return json(res,201,created,{'Set-Cookie':hostCookie(created.session)});
    }
    if (req.method === 'POST' && route === '/api/replays/import') {
      if(!publicReplayImports.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Replay imports are temporarily limited. Try again shortly.',code:'RATE_LIMITED'});
      const data = await body(req, 32_000_000);
      const created=await createSession('import', { replay: data.replay });
      return json(res,200,created,{'Set-Cookie':hostCookie(created.session)});
    }
    if(req.method==='GET'&&route==='/api/games/ongoing'){
      const games=[...sessions.entries()].flatMap(([session,value])=>{
        const replay=value&&typeof value==='object'&&'replay' in value?value.replay:funded.matches.get(session)?.replay;
        if(!replay||replay.final_state.ended)return [];
        return [{session,match_id:replay.match_id,turn:replay.final_state.turn,
          alive:replay.final_state.agents.filter(agent=>agent.alive).length,
          seats:replay.config.agents.length,agents:replay.config.agents.map(agent=>({id:agent.id,name:agent.name,provider:agent.provider})),
          funded:Boolean(funded.matches.has(session))}];
      }).slice(-20).reverse();
      return json(res,200,{games});
    }
    const archived = route.match(/^\/api\/replays\/(seat-[a-f0-9]{64})$/);
    if (req.method === 'GET' && archived) {
      const replay = await replayArchive.load(archived[1]);
      if(!replay)return json(res,404,{error:'Replay not found',code:'REPLAY_NOT_FOUND'});
      const { replay: checked } = await core.request({ command: 'verify', replay });
      return json(res, 200, { replay: checked });
    }
    const match = route.match(/^\/api\/matches\/([a-f0-9-]{36})(?:\/(step|share|events|observe))?$/);
    if(match&&!sessions.has(match[1]))await funded.register(match[1]);
    if(match&&!sessions.has(match[1])){
      const archivedMatch=await runtime.store?.archivedMatch(match[1]);
      if(archivedMatch){
        const archived=await replayArchive.load(archivedMatch);
        if(!archived)return json(res,404,{error:'Replay not found',code:'REPLAY_NOT_FOUND'});
        const {replay}=await core.request({command:'verify',replay:archived});
        if(req.method==='GET'&&!match[2])return json(res,200,{replay});
        if(req.method==='GET'&&match[2]==='events'){liveEvents.connect(match[1],replay,res);return;}
        return json(res,410,{error:'This match has finished; open its archived replay instead',match_id:archivedMatch});
      }
    }
    if (match && sessions.has(match[1])) {
      const session = match[1];
      if (req.method === 'GET' && !match[2]) return json(res, 200, await core.request({ command: 'get', session }));
      if (req.method === 'GET' && match[2] === 'observe') return json(res, 200, await core.request({ command: 'observe', session }));
      if (req.method === 'GET' && match[2] === 'events') {const {replay,economy}=await core.request({command:'get',session});liveEvents.connect(session,replay,res,economy);return;}
      if (req.method === 'POST' && match[2] === 'share') {
        if(production&&!hasHostCookie(req,session))return json(res,403,{error:'Only the match host can share this game'});
        const { replay } = await core.request({ command: 'get', session }); await persist(replay); return json(res, 200, { match_id: replay.match_id });
      }
      if (req.method === 'POST' && match[2] === 'step') {
        if(production&&!hasHostCookie(req,session))return json(res,403,{error:'Only the match host can advance this game'});
        const data = await body(req);
        let result;
        try{result=await runtime.step(core,session,data);}
        catch(error){
          // A post-rename directory-sync failure means the engine transition
          // is readable and committed, even though the request reports that
          // durability could not be confirmed. Keep live viewers in sync.
          const committed=error?.committed_result;
          if(committed){
            if(sessions.get(session)?.kind==='free')sessions.set(session,{kind:'free',replay:committed.replay});
            liveEvents.publish(session,committed);
          }
          throw error;
        }
        if(sessions.get(session)?.kind==='free')sessions.set(session,{kind:'free',replay:result.replay});
        liveEvents.publish(session,result);
        if(result.replay.final_state.ended)await persist(result.replay);
        if(data.compact)return json(res,200,{events:result.events,match_id:result.replay.match_id,final_state:result.replay.final_state,winner:result.replay.winner,statistics:result.replay.statistics,budget:runtime.budget(session).view()});
        return json(res,200,result);
      }
    }
    if (req.method === 'POST' && route === '/api/wallet-demo') {
      // Only the offline capability is callable from the browser. No model-supplied CLI args.
      if(!walletDemoRequests.allow(clientRateKey(req,{trustProxy})))return json(res,429,{error:'Wallet demo requests are temporarily limited',code:'RATE_LIMITED'});
      await body(req,1024);
      const child = spawn(path.join(root, 'rust/target/debug/wallet-demo'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => errors += b);
      await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(errors))); });
      return json(res, 200, JSON.parse(output));
    }
    if (route.startsWith('/api/')) return json(res, 404, { error: 'Route or local session not found' });
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    const pathname = decodeURIComponent(route), page = pathname === '/' ? '/index.html' : ['/world','/world/','/labs/world'].includes(pathname) ? '/world/index.html' : ['/arena','/arena/'].includes(pathname) ? '/world/arena.html' : ['/profile','/profile/'].includes(pathname) ? '/profile/index.html' : pathname === '/rps' || /^\/arena\/(rps\/rps-[12]|tictactoe\/ttt-[12])$/.test(pathname) ? '/legacy/index.html' : ['/post', '/post/'].includes(pathname) ? '/post/index.html' : pathname;
    const target = path.resolve(root, `.${page}`), relative = path.relative(root, target);
    if (relative.startsWith('..') || !/^(index\.html|styles\.css|entry\.(css|js)|legacy\/(index\.html|styles.css|script\.js)|post\/(index\.html|styles.css)|profile\/(index.html|profile.js)|world\/(index\.html|arena.html|styles.css)|src\/[\w-]+\.js|web\/dist\/(world\/)?[\w-]+\.js|assets\/(agents|sprites-agent)\/[\w-]+\.png|assets\/avatars\/(index\.json|clean\/(ember|atlas|nova|echo)(_preview)?\.png))$/.test(relative)) { res.writeHead(404).end('Not found'); return; }
    const bytes = await readFile(target);res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(bytes);
  } catch (error) {
    let detail;try{detail=JSON.parse(error.message);}catch{}
    const status=requestErrorStatus(error);
    const code=error.code||detail?.code;
    if(status>=500)console.error(JSON.stringify({event:'request_failed',code:typeof code==='string'?code:'INTERNAL_ERROR'}));
    const safeMessage=production?(status===404?'Not found':status===413?'Request too large':status===429?'Too many requests':status<500?'Request rejected':'Service temporarily unavailable'):error.message;
    json(res,status,{error:safeMessage,...(typeof code==='string'?{code}:{})});
  }
});
try{await ownershipStore.init();await replayArchive.reconcile();await runtime.restore(core,sessions);await funded.restore();await arenaRooms.restore();await worldTable.restore();funded.start();arenaRooms.start();}catch(error){console.error(`Session recovery failed: ${error.message}`);core.stop();process.exit(1);}
const {host,port}=deployment;
server.listen(port, host, () => {
  const actualPort=server.address().port;
  console.log(production?JSON.stringify({event:'server_started',host,port:actualPort,environment:'production'}):`Last Seat · Rust core · http://localhost:${actualPort}`);
});
let shutdownTask;
async function shutdown(signal){
  if(shutdownTask)return shutdownTask;
  shuttingDown=true;
  shutdownTask=(async()=>{
    console.log(JSON.stringify({event:'server_shutdown_started',signal}));
    liveEvents.close();
    const httpDrained=new Promise(resolve=>server.close(resolve));
    server.closeIdleConnections?.();
    let timeout;
    const drained=Promise.allSettled([httpDrained,worldPresence.close(),roomSpectators.close(),arenaRooms.close(),funded.close()]).then(()=>true);
    const completed=await Promise.race([drained,new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),10_000);})]);
    clearTimeout(timeout);
    if(!completed){
      console.error(JSON.stringify({event:'server_shutdown_timeout',timeout_ms:10_000}));
      server.closeAllConnections?.();
    }
    core.stop();
    console.log(JSON.stringify({event:'server_shutdown_complete',drained:completed}));
  })();
  return shutdownTask;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void shutdown(signal); });
server.on('error', error => { console.error(error.message); core.stop(); process.exit(1); });
