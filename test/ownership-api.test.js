import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {encodeBase58} from '../service/wallet-auth.js';

test('owner API supports guest and wallet identity, private agent management, and restart persistence',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'aae-owner-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let child,output='',stderr='',base;
 const start=async()=>{
  output='';stderr='';child=spawn(process.execPath,['server.js'],{cwd:path.resolve('.'),env:{...process.env,NODE_ENV:'test',APP_MODE:'mock',HOST:'127.0.0.1',PORT:'0',MATCHES_DIR:directory},stdio:['ignore','pipe','pipe']});
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
  const guest=await call('/api/auth/anonymous',{method:'POST',body:'{}'});assert.equal(guest.response.status,201);assert.ok(guest.cookie);
  const created=await call('/api/me/agents',{method:'POST',cookie:guest.cookie,body:JSON.stringify({name:'Owner Agent',avatar:'visitor_ember',strategy:'conservative'})});
  assert.equal(created.response.status,201,JSON.stringify(created.value));const id=created.value.agent.id;
  const imported=await call('/api/me/agents/import',{method:'POST',cookie:guest.cookie,body:JSON.stringify({format:'aae-agent-v1',name:'Imported',avatar:'visitor_atlas',strategy:'cooperative',personality:'Calm.'})});
  assert.equal(imported.response.status,201,JSON.stringify(imported.value));
  const rejectedImport=await call('/api/me/agents/import',{method:'POST',cookie:guest.cookie,body:JSON.stringify({format:'aae-agent-v1',name:'Unsafe',avatar:'visitor_ember',strategy:'cooperative',private_key:'do-not-accept'})});
  assert.equal(rejectedImport.response.status,400);
  const publicResult=await call(`/api/agents/${id}`);assert.equal(publicResult.value.agent.owner_id,undefined);assert.equal(publicResult.value.agent.treasury,undefined);
  const funded=await call(`/api/me/agents/${id}/mock-fund`,{method:'POST',cookie:guest.cookie,body:JSON.stringify({amount:123})});assert.equal(funded.value.treasury.available_base_units,'123');
  const isolated=await call('/api/auth/anonymous',{method:'POST',body:'{}'});
  assert.equal((await call(`/api/me/agents/${id}/export`,{cookie:isolated.cookie})).response.status,404);

  const pair=generateKeyPairSync('ed25519'),publicKey=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  const issued=await call('/api/auth/wallet/challenge',{method:'POST',body:JSON.stringify({public_key:publicKey})});assert.equal(issued.response.status,200);
  const signature=sign(null,Buffer.from(issued.value.message),pair.privateKey).toString('base64url');
  const verified=await call('/api/auth/wallet/verify',{method:'POST',body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})});
  assert.equal(verified.response.status,200);assert.equal(verified.value.owner.identity_type,'solana');assert.ok(verified.cookie);
  assert.equal((await call('/api/auth/wallet/verify',{method:'POST',body:JSON.stringify({challenge_id:issued.value.challenge_id,public_key:publicKey,signature})})).response.status,401);
  await stop();base=undefined;await start();
  const restored=await call('/api/me/agents',{cookie:guest.cookie});assert.equal(restored.response.status,200);assert.equal(restored.value.agents[0].treasury.available_base_units,'123');
 }finally{await stop();}
});
