import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createServer as createNetServer} from 'node:net';
import {encodeBase58} from '../service/wallet-auth.js';
import {ownerCookie} from '../service/owner-auth.js';

test('owner API supports guest and wallet identity, private agent management, and restart persistence',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'aae-owner-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let child,output='',stderr='',base;
 const start=async()=>{
  output='';stderr='';child=spawn(process.execPath,['server.js'],{cwd:path.resolve('.'),env:{...process.env,NODE_ENV:'test',HOST_SESSION_SECRET:'test-owner-session-secret-for-api',APP_MODE:'mock',TRUST_PROXY:'true',HOST:'127.0.0.1',PORT:'0',MATCHES_DIR:directory},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{output+=chunk.toString();const found=output.match(/http:\/\/localhost:(\d+)/);if(found)base=`http://127.0.0.1:${found[1]}`;});
  child.stderr.on('data',chunk=>stderr+=chunk.toString());
  const until=Date.now()+12_000;while(!base&&Date.now()<until){if(child.exitCode!==null)throw Error(`server exited ${child.exitCode}: ${stderr}`);await new Promise(resolve=>setTimeout(resolve,30));}
  if(!base)throw Error(`server did not become ready: ${stderr}`);
 };
 const stop=async()=>{if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timeout=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timeout);resolve();});});}};
 const call=async(route,{cookie,...options}={})=>{
  const response=await fetch(base+route,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...options.headers}});
  const value=await response.json().catch(()=>({}));return {response,value,cookie:response.headers.getSetCookie?.().find(value=>value.startsWith('aae_owner='))?.split(';')[0]};
 };
 try{
  await start();
  assert.equal((await fetch(`${base}/profile/`)).status,200);
  const {value:capabilities}=await call('/api/capabilities');assert.equal(capabilities.ownership.agent_creation_available,true);assert.equal(capabilities.ownership.mainnet_match_wagering_enabled,false);
  const {value:health}=await call('/api/health');assert.equal(health.identity_storage,'ok');assert.equal(health.mainnet_match_wagering_enabled,false);
  const staleSession=await call('/api/me',{cookie:ownerCookie(randomUUID(),{NODE_ENV:'test',HOST_SESSION_SECRET:'test-owner-session-secret-for-api'}).split(';')[0]});
  assert.equal(staleSession.response.status,401);assert.equal(staleSession.value.code,'OWNER_SESSION_REQUIRED');assert.match(staleSession.response.headers.get('set-cookie')||'',/^aae_owner=;/);
  const oversizedGuest=await call('/api/auth/anonymous',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({padding:'x'.repeat(2048)})});assert.equal(oversizedGuest.response.status,413);
  const missingGuestKey=await call('/api/auth/anonymous',{method:'POST',body:'{}'});assert.equal(missingGuestKey.response.status,400);assert.equal(missingGuestKey.value.code,'IDEMPOTENCY_KEY_REQUIRED');
  const guestKey=randomUUID(),guestHeaders={'Idempotency-Key':guestKey};
  const guest=await call('/api/auth/anonymous',{method:'POST',headers:guestHeaders,body:'{}'});assert.equal(guest.response.status,201);assert.ok(guest.cookie);const guestOwnerId=guest.value.owner.id;
  const guestRetry=await call('/api/auth/anonymous',{method:'POST',headers:guestHeaders,body:'{}'});assert.equal(guestRetry.response.status,201);assert.equal(guestRetry.value.owner.id,guestOwnerId,'retrying an owner creation request must reuse its durable identity');
  const guestResume=await call('/api/auth/anonymous',{method:'POST',cookie:guest.cookie,body:'{}'});assert.equal(guestResume.response.status,200);assert.equal(guestResume.value.owner.id,guestOwnerId);guest.cookie=guestResume.cookie;
  const me=await call('/api/me',{cookie:guest.cookie});assert.equal(me.response.status,200);assert.equal(Object.hasOwn(me.value.owner,'session_version'),false,'internal revocation state is not part of the public owner contract');
  const createKey=randomUUID(),createBody=JSON.stringify({name:'Owner Agent',avatar:'visitor_ember',strategy:'conservative'});
  const missingKey=await call('/api/me/agents',{method:'POST',cookie:guest.cookie,body:createBody});assert.equal(missingKey.response.status,400);assert.equal(missingKey.value.code,'IDEMPOTENCY_KEY_REQUIRED');
  const created=await call('/api/me/agents',{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':createKey},body:createBody});
  assert.equal(created.response.status,201,JSON.stringify(created.value));const id=created.value.agent.id;
  const worldDirectory=await call('/api/arena/agents');const worldAgent=worldDirectory.value.agents.find(agent=>agent.id===id);
  assert.ok(worldAgent,'a created owner agent should be inspectable in the world profile feed');assert.equal(worldAgent.arenaStatus,'owned');assert.equal(worldAgent.sprite,'assets/avatars/clean/ember.png');assert.equal(worldAgent.owner_wallet,null);assert.equal(worldAgent.treasury,undefined);
  const research=await call('/api/arena/statistics');assert.equal(research.value.agents.some(agent=>agent.id===id),false,'created agents must not fabricate match research before playing');
  const duplicate=await call('/api/me/agents',{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':createKey},body:createBody});assert.equal(duplicate.response.status,201);assert.equal(duplicate.value.agent.id,id);
  const reused=await call('/api/me/agents',{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':createKey},body:JSON.stringify({name:'Different',avatar:'visitor_ember',strategy:'conservative'})});assert.equal(reused.response.status,409);assert.equal(reused.value.code,'IDEMPOTENCY_KEY_REUSED');
  const importKey=randomUUID(),importBody=JSON.stringify({format:'aae-agent-v1',name:'Imported',avatar:'visitor_atlas',strategy:'cooperative',personality:'Calm.'});
  const imported=await call('/api/me/agents/import',{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':importKey},body:importBody});
  assert.equal(imported.response.status,201,JSON.stringify(imported.value));
  const rejectedImport=await call('/api/me/agents/import',{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({format:'aae-agent-v1',name:'Unsafe',avatar:'visitor_ember',strategy:'cooperative',private_key:'do-not-accept'})});
  assert.equal(rejectedImport.response.status,400);
  const publicResult=await call(`/api/agents/${id}`);assert.equal(publicResult.value.agent.owner_id,undefined);assert.equal(publicResult.value.agent.treasury,undefined);
  const publicPage=await call('/api/agents?limit=1');assert.equal(publicPage.value.agents.length,1);assert.equal(publicPage.value.next_cursor,id);
  const nextPublicPage=await call(`/api/agents?limit=1&after=${encodeURIComponent(publicPage.value.next_cursor)}`);assert.equal(nextPublicPage.value.agents.length,1);assert.equal(nextPublicPage.value.next_cursor,null);
  assert.equal((await call('/api/agents?limit=101')).response.status,400);
  const fundingKey=randomUUID(),fundingBody=JSON.stringify({amount:123});
  const funded=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':fundingKey},body:fundingBody});assert.equal(funded.value.treasury.available_base_units,'123');
  const fundingRetry=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':fundingKey},body:fundingBody});assert.equal(fundingRetry.value.receipt.id,funded.value.receipt.id);assert.equal(fundingRetry.value.treasury.available_base_units,'123');
  const missingFundingKey=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,body:fundingBody});assert.equal(missingFundingKey.response.status,400);assert.equal(missingFundingKey.value.code,'IDEMPOTENCY_KEY_REQUIRED');
  const isolated=await call('/api/auth/anonymous',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:'{}'});
  assert.equal((await call(`/api/me/agents/${id}/export`,{cookie:isolated.cookie})).response.status,404);

  const pair=generateKeyPairSync('ed25519'),publicKey=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  let issued=await call('/api/auth/wallet/challenge',{method:'POST',cookie:guest.cookie,body:JSON.stringify({public_key:publicKey})});assert.equal(issued.response.status,200);
  let signature=sign(null,Buffer.from(issued.value.message),pair.privateKey).toString('base64url');
  const switched=await call('/api/auth/wallet/verify',{method:'POST',cookie:isolated.cookie,body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})});assert.equal(switched.response.status,401);assert.equal(switched.value.code,'CHALLENGE_OWNER_MISMATCH');
  issued=await call('/api/auth/wallet/challenge',{method:'POST',cookie:guest.cookie,body:JSON.stringify({public_key:publicKey})});assert.equal(issued.response.status,200);
  signature=sign(null,Buffer.from(issued.value.message),pair.privateKey).toString('base64url');
  const verified=await call('/api/auth/wallet/verify',{method:'POST',cookie:guest.cookie,body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})});
  assert.equal(verified.response.status,200);assert.equal(verified.value.owner.identity_type,'solana');assert.equal(verified.value.owner.id,guestOwnerId);assert.ok(verified.cookie);
  const linkedAgents=await call('/api/me/agents',{cookie:verified.cookie});assert.ok(linkedAgents.value.agents.some(agent=>agent.id===id),'guest-created agent should remain accessible after wallet linking');
  const secondPair=generateKeyPairSync('ed25519'),secondPublicKey=encodeBase58(secondPair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  const secondChallenge=await call('/api/auth/wallet/challenge',{method:'POST',cookie:verified.cookie,body:JSON.stringify({public_key:secondPublicKey})});
  const secondSignature=sign(null,Buffer.from(secondChallenge.value.message),secondPair.privateKey).toString('base64url');
  const secondWallet=await call('/api/auth/wallet/verify',{method:'POST',cookie:verified.cookie,body:JSON.stringify({challenge_id:secondChallenge.value.challenge_id,public_key:secondPublicKey,signature:secondSignature})});
  assert.equal(secondWallet.response.status,409);assert.equal(secondWallet.value.code,'OWNER_WALLET_ALREADY_LINKED');
  assert.equal((await call('/api/me',{cookie:verified.cookie})).value.owner.wallet_public_key,publicKey,'a rejected second wallet must leave the existing owner session unchanged');
  assert.equal((await call('/api/me',{cookie:guest.cookie})).response.status,401,'wallet linking invalidates the old anonymous session');
  guest.cookie=verified.cookie;
  assert.equal((await call('/api/auth/wallet/verify',{method:'POST',body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})})).response.status,401);
  await stop();base=undefined;await start();
  const retriedAfterRestart=await call('/api/me/agents',{method:'POST',cookie:verified.cookie,headers:{'Idempotency-Key':createKey},body:createBody});assert.equal(retriedAfterRestart.response.status,201);assert.equal(retriedAfterRestart.value.agent.id,id);
  const restored=await call('/api/me/agents',{cookie:verified.cookie});assert.equal(restored.response.status,200);assert.equal(restored.value.agents[0].treasury.available_base_units,'123');
  const fundingRetryAfterRestart=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:verified.cookie,headers:{'Idempotency-Key':fundingKey},body:fundingBody});assert.equal(fundingRetryAfterRestart.value.receipt.id,funded.value.receipt.id);assert.equal(fundingRetryAfterRestart.value.treasury.available_base_units,'123');
  for(let index=0;index<29;index++){
    const response=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':randomUUID()},body:'{"amount":1}'});
    assert.equal(response.response.status,200);
  }
  const limitedFunding=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,headers:{'Idempotency-Key':randomUUID()},body:'{"amount":1}'});
  assert.equal(limitedFunding.response.status,429);assert.equal(limitedFunding.value.code,'RATE_LIMITED');
  const roster=await call('/api/me/agents',{cookie:guest.cookie});assert.equal(roster.value.agents[0].treasury.receipt_count,30);assert.equal(roster.value.agents[0].treasury.receipts.length,3);
  const treasury=await call(`/api/me/agents/${id}/treasury`,{cookie:guest.cookie});assert.equal(treasury.value.treasury.receipt_count,30);assert.equal(treasury.value.treasury.receipts.length,3);
  const firstTransactions=await call(`/api/me/agents/${id}/transactions?limit=2`,{cookie:guest.cookie});assert.equal(firstTransactions.value.transactions.length,2);assert.ok(firstTransactions.value.next_cursor);
  const olderTransactions=await call(`/api/me/agents/${id}/transactions?limit=2&before=${encodeURIComponent(firstTransactions.value.next_cursor)}`,{cookie:guest.cookie});assert.equal(olderTransactions.value.transactions.length,2);assert.ok(olderTransactions.value.transactions.every(receipt=>!firstTransactions.value.transactions.some(recent=>recent.id===receipt.id)));
  assert.equal((await call(`/api/me/agents/${id}/transactions?limit=101`,{cookie:guest.cookie})).response.status,400);
  for(let index=0;index<30;index++){
    const response=await call(`/api/me/agents/${id}/spending-policy`,{method:'POST',cookie:guest.cookie,body:'{"mode":"read_only"}'});
    assert.equal(response.response.status,200);
  }
  const limitedPolicy=await call(`/api/me/agents/${id}/spending-policy`,{method:'POST',cookie:guest.cookie,body:'{"mode":"read_only"}'});
  assert.equal(limitedPolicy.response.status,429);assert.equal(limitedPolicy.value.code,'RATE_LIMITED');
  for(let index=0;index<20;index++)assert.equal((await call('/api/auth/anonymous',{method:'POST',headers:{'Idempotency-Key':randomUUID(),'X-Forwarded-For':'192.0.2.20'},body:'{}'})).response.status,201);
  assert.equal((await call('/api/auth/anonymous',{method:'POST',headers:{'Idempotency-Key':randomUUID(),'X-Forwarded-For':'192.0.2.20'},body:'{}'})).response.status,429);
  assert.equal((await call('/api/auth/anonymous',{method:'POST',headers:{'Idempotency-Key':randomUUID(),'X-Forwarded-For':'198.51.100.30'},body:'{}'})).response.status,201,'one visitor rate limit must not block other addresses');
 }finally{await stop();}
});

test('production-shaped free deployment serves the profile and sets secure owner sessions',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'aae-owner-production-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const reservation=createNetServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve('.'),env:{...process.env,NODE_ENV:'production',APP_MODE:'free',SOLANA_NETWORK:'none',HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:'https://ci.example',MATCHES_DIR:directory,HOST_SESSION_SECRET:'production-shape-secret-0123456789abcdef'},stdio:['ignore','pipe','pipe']});
 let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk.toString());child.stderr.on('data',chunk=>stderr+=chunk.toString());
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timeout=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timeout);resolve();});});}});
 const until=Date.now()+10_000;while(!output.includes('server_started')&&Date.now()<until){if(child.exitCode!==null)throw Error(`production-shaped server exited: ${stderr}`);await new Promise(resolve=>setTimeout(resolve,25));}
 assert.ok(output.includes('server_started'),`production-shaped service failed startup: ${stderr}`);
 const base=`http://127.0.0.1:${port}`,headers={Host:'ci.example'};
 const page=await fetch(base+'/profile/',{headers});assert.equal(page.status,200);
 const health=await fetch(base+'/api/health',{headers}).then(response=>response.json());assert.equal(health.mainnet_agent_funding_enabled,false);assert.equal(health.mainnet_match_wagering_enabled,false);
 const response=await fetch(base+'/api/auth/anonymous',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:'{}'});
 assert.equal(response.status,201);assert.match(response.headers.get('set-cookie')||'',/; HttpOnly; SameSite=Strict;.*Secure/);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const me=await fetch(base+'/api/me',{headers:{...headers,Cookie:cookie}});assert.equal(me.status,200);
 const pair=generateKeyPairSync('ed25519'),publicKey=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const walletHeaders={...headers,Origin:'https://ci.example','Content-Type':'application/json'};
 const challengeResponse=await fetch(base+'/api/auth/wallet/challenge',{method:'POST',headers:walletHeaders,body:JSON.stringify({public_key:publicKey})});
 assert.equal(challengeResponse.status,200);const challenge=await challengeResponse.json();assert.match(challenge.message,/Origin: https:\/\/ci\.example/);
 const signature=sign(null,Buffer.from(challenge.message),pair.privateKey).toString('base64url');
 const verifiedResponse=await fetch(base+'/api/auth/wallet/verify',{method:'POST',headers:walletHeaders,body:JSON.stringify({challenge_id:challenge.challenge_id,public_key:publicKey,signature})});
 assert.equal(verifiedResponse.status,200);const verified=await verifiedResponse.json();assert.equal(verified.owner.identity_type,'solana');
 const walletCookie=verifiedResponse.headers.get('set-cookie')||'';assert.match(walletCookie,/; HttpOnly; SameSite=Strict;.*Secure/);
 const ownerCookie=walletCookie.split(';')[0];
 const freeResume=await fetch(base+'/api/auth/anonymous',{method:'POST',headers:{...headers,Cookie:ownerCookie,'Content-Type':'application/json'},body:'{}'});assert.equal(freeResume.status,200);assert.equal((await freeResume.json()).owner.identity_type,'solana','the free-entry action must not replace a signed-in wallet owner');
 const created=await fetch(base+'/api/me/agents',{method:'POST',headers:{...headers,Cookie:ownerCookie,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({name:'Production Agent',avatar:'visitor_nova',strategy:'opportunist'})});
 assert.equal(created.status,201);const createdValue=await created.json();
 const rejectedFund=await fetch(`${base}/api/me/agents/${createdValue.agent.id}/mock-fund`,{method:'POST',headers:{...headers,Cookie:ownerCookie,'Content-Type':'application/json'},body:JSON.stringify({amount:100})});
 assert.equal(rejectedFund.status,409);assert.equal((await rejectedFund.json()).code,'MOCK_MODE_REQUIRED');
 const config=await fetch(base+'/api/config?agents=2',{headers}).then(response=>response.json());
 const started=await fetch(base+'/api/matches',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({config})});assert.equal(started.status,201);
 const run=await started.json();
 const imported=await fetch(base+'/api/replays/import',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({replay:run.replay})});assert.equal(imported.status,200);
 const importedRun=await imported.json(),hostCookie=imported.headers.get('set-cookie')||'';assert.match(hostCookie,/; Path=\/api\/matches\/[^;]+; HttpOnly;.*Secure/);
 const blockedAdvance=await fetch(`${base}/api/matches/${importedRun.session}/step`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(blockedAdvance.status,403);
 const resumed=await fetch(`${base}/api/matches/${importedRun.session}/step`,{method:'POST',headers:{...headers,Cookie:hostCookie.split(';')[0],'Content-Type':'application/json'},body:'{}'});assert.equal(resumed.status,200);
 const crossOrigin=await fetch(base+'/api/auth/wallet/challenge',{method:'POST',headers:{...headers,Origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({public_key:publicKey})});assert.equal(crossOrigin.status,403);
 const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{...headers,Cookie:ownerCookie,'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);
 const revoked=await fetch(base+'/api/me',{headers:{...headers,Cookie:ownerCookie}});assert.equal(revoked.status,401,'logout revokes copied owner cookies on the server');
});
