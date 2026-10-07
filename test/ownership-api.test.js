import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServer as createNetServer} from 'node:net';
import {encodeBase58} from '../service/wallet-auth.js';

test('owner API supports guest and wallet identity, private agent management, and restart persistence',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'aae-owner-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let child,output='',stderr='',base;
 const start=async()=>{
  output='';stderr='';child=spawn(process.execPath,['server.js'],{cwd:path.resolve('.'),env:{...process.env,NODE_ENV:'test',APP_MODE:'mock',TRUST_PROXY:'true',HOST:'127.0.0.1',PORT:'0',MATCHES_DIR:directory},stdio:['ignore','pipe','pipe']});
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
  const guest=await call('/api/auth/anonymous',{method:'POST',body:'{}'});assert.equal(guest.response.status,201);assert.ok(guest.cookie);const guestOwnerId=guest.value.owner.id;
  const created=await call('/api/me/agents',{method:'POST',cookie:guest.cookie,body:JSON.stringify({name:'Owner Agent',avatar:'visitor_ember',strategy:'conservative'})});
  assert.equal(created.response.status,201,JSON.stringify(created.value));const id=created.value.agent.id;
  const imported=await call('/api/me/agents/import',{method:'POST',cookie:guest.cookie,body:JSON.stringify({format:'aae-agent-v1',name:'Imported',avatar:'visitor_atlas',strategy:'cooperative',personality:'Calm.'})});
  assert.equal(imported.response.status,201,JSON.stringify(imported.value));
  const rejectedImport=await call('/api/me/agents/import',{method:'POST',cookie:guest.cookie,body:JSON.stringify({format:'aae-agent-v1',name:'Unsafe',avatar:'visitor_ember',strategy:'cooperative',private_key:'do-not-accept'})});
  assert.equal(rejectedImport.response.status,400);
  const publicResult=await call(`/api/agents/${id}`);assert.equal(publicResult.value.agent.owner_id,undefined);assert.equal(publicResult.value.agent.treasury,undefined);
  const publicPage=await call('/api/agents?limit=1');assert.equal(publicPage.value.agents.length,1);assert.equal(publicPage.value.next_cursor,id);
  const nextPublicPage=await call(`/api/agents?limit=1&after=${encodeURIComponent(publicPage.value.next_cursor)}`);assert.equal(nextPublicPage.value.agents.length,1);assert.equal(nextPublicPage.value.next_cursor,null);
  assert.equal((await call('/api/agents?limit=101')).response.status,400);
  const funded=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,body:JSON.stringify({amount:123})});assert.equal(funded.value.treasury.available_base_units,'123');
  const isolated=await call('/api/auth/anonymous',{method:'POST',body:'{}'});
  assert.equal((await call(`/api/me/agents/${id}/export`,{cookie:isolated.cookie})).response.status,404);

  const pair=generateKeyPairSync('ed25519'),publicKey=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  const issued=await call('/api/auth/wallet/challenge',{method:'POST',body:JSON.stringify({public_key:publicKey})});assert.equal(issued.response.status,200);
  const signature=sign(null,Buffer.from(issued.value.message),pair.privateKey).toString('base64url');
  const verified=await call('/api/auth/wallet/verify',{method:'POST',cookie:guest.cookie,body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})});
  assert.equal(verified.response.status,200);assert.equal(verified.value.owner.identity_type,'solana');assert.equal(verified.value.owner.id,guestOwnerId);assert.ok(verified.cookie);
  const linkedAgents=await call('/api/me/agents',{cookie:verified.cookie});assert.ok(linkedAgents.value.agents.some(agent=>agent.id===id),'guest-created agent should remain accessible after wallet linking');
  assert.equal((await call('/api/auth/wallet/verify',{method:'POST',body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})})).response.status,401);
  await stop();base=undefined;await start();
  const restored=await call('/api/me/agents',{cookie:guest.cookie});assert.equal(restored.response.status,200);assert.equal(restored.value.agents[0].treasury.available_base_units,'123');
  for(let index=0;index<20;index++)assert.equal((await call('/api/auth/anonymous',{method:'POST',body:'{}',headers:{'X-Forwarded-For':'192.0.2.20'}})).response.status,201);
  assert.equal((await call('/api/auth/anonymous',{method:'POST',body:'{}',headers:{'X-Forwarded-For':'192.0.2.20'}})).response.status,429);
  assert.equal((await call('/api/auth/anonymous',{method:'POST',body:'{}',headers:{'X-Forwarded-For':'198.51.100.30'}})).response.status,201,'one visitor rate limit must not block other addresses');
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
 const response=await fetch(base+'/api/auth/anonymous',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,201);assert.match(response.headers.get('set-cookie')||'',/; HttpOnly; SameSite=Strict;.*Secure/);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const me=await fetch(base+'/api/me',{headers:{...headers,Cookie:cookie}});assert.equal(me.status,200);
});
