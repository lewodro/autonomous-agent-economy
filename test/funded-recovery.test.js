import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reduceEconomy,parseEconomyEvent} from '../web/dist/economy.js';

// Each restart reuses durable storage but replaces the entire Node/Rust process group.
async function fixture(extra={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'funded-recovery-'));
 let child,base;
 async function start(env={}){
  child=spawn(process.execPath,['server.js'],{detached:true,env:{...process.env,...extra,...env,PORT:'0',MATCHES_DIR:directory,ECONOMY_DIR:path.join(directory,'economy'),FUNDED_AUTO_RUN:'0',ECONOMY_LAB:'1'},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stderr.on('data',c=>{errors+=c;});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Startup timeout ${errors}`)),20000);child.stdout.on('data',c=>{output+=c;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});child.once('exit',()=>{clearTimeout(timer);reject(Error(`Server exited ${errors}`));});});
 }
 async function stop(){if(!child||child.exitCode!==null)return;const ended=new Promise(resolve=>child.once('exit',resolve));process.kill(-child.pid,'SIGKILL');await ended;}
 const request=async(route,body)=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 await start();
 return {request,restart:async env=>{await stop();await start(env);},close:async()=>{await stop();await rm(directory,{recursive:true,force:true});}};
}
const config=(count=4)=>({seed:count===8?44:42,max_turns:5,agents:Array.from({length:count},(_,i)=>({id:`agent-${i+1}`,name:`Agent ${i+1}`}))});
async function create(host,mode='mock',entry='0.02',count=4){const r=await host.request('/api/funded-matches',{mode,entry_amount_sol:entry,config:config(count)});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.session;}
async function command(host,id,action,body={}){const r=await host.request(`/api/funded-matches/${id}/${action}`,body);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function finish(host,id,mayCrash=false){for(let i=0;i<10;i++){const before=await host.request(`/api/funded-matches/${id}`);if(before.data.replay.final_state.ended)return before.data;const step=await host.request(`/api/matches/${id}/step`,{expected_turn:before.data.replay.final_state.turn});if(mayCrash&&step.status!==200)return step;assert.equal(step.status,200,JSON.stringify(step.data));}throw Error('Match failed to finish');}
function balances(result){return Object.fromEntries(result.economy.wallets.map(w=>[w.account,w.balance]));}

test('partial funding survives process kill, completes admission and pays only once after restart',async()=>{
 const host=await fixture();try{
  const id=await create(host);await command(host,id,'fund',{agent_id:'agent-1'});await command(host,id,'fund',{agent_id:'agent-2'});
  await host.restart();const restored=await host.request(`/api/funded-matches/${id}`);assert.equal(restored.data.economy.economy.pot_amount,'40000000');assert.equal(restored.data.economy.economy.funded_agents.length,2);
  await command(host,id,'fund-all');const completed=await finish(host,id);assert.ok(completed.replay.winner);
  const first=await command(host,id,'settle');await host.restart();const again=await command(host,id,'settle');
  assert.deepEqual(again.economy.operations,first.economy.operations);assert.deepEqual(balances(again),balances(first));assert.equal(again.economy.settlement.status,'confirmed');assert.equal(again.economy.attestation.claims.winner_id,completed.replay.winner);
  const events=again.economy.events;assert.deepEqual(events,first.economy.events);
  let projected=null;for(const event of events)projected=reduceEconomy(projected,event);assert.deepEqual(projected.match,again.economy.economy);
  for(const type of ['EntryPaymentCreated','EntryPaymentSubmitted','EntryPaymentConfirmed'])assert.equal(events.filter(e=>e.type===type).length,4);
  for(const type of ['SettlementPending','SettlementSubmitted','SettlementConfirmed'])assert.equal(events.filter(e=>e.type===type).length,1);
  const confirmed=events.find(e=>e.type==='EntryPaymentConfirmed');assert.throws(()=>parseEconomyEvent({...confirmed,operation_id:'../invalid'}));assert.throws(()=>parseEconomyEvent({...confirmed,agent_id:'stranger'}));
 }finally{await host.close();}
});
test('partial cancellation remains refunded after a real process restart',async()=>{
 const host=await fixture();try{const id=await create(host);for(const agent_id of ['agent-1','agent-2'])await command(host,id,'fund',{agent_id});const first=await command(host,id,'cancel');await host.restart();const again=await command(host,id,'cancel');assert.equal(again.economy.economy.state,'refunded');assert.equal(again.replay.final_state.turn,0);assert.deepEqual(balances(again),balances(first));assert.equal(again.economy.operations.filter(r=>r.purpose==='refund').length,2);}finally{await host.close();}
});

const local=process.env.FUNDED_LOCAL_TESTS==='1';
test('local validator verifies exact funded pots, payouts and restarts across five entry configurations',{skip:!local,timeout:180000},async()=>{
 const host=await fixture();try{for(const [count,entry,pot] of [[2,'0.05','100000000'],[4,'0.02','80000000'],[4,'0.03','120000000'],[4,'0.05','200000000'],[8,'0.02','160000000']]){
  const id=await create(host,'local',entry,count);const funded=await command(host,id,'fund-all');assert.equal(funded.economy.economy.state,'running');assert.equal(funded.economy.economy.pot_amount,pot);
  const escrow=funded.economy.wallets.find(w=>w.account.startsWith('escrow-'));assert.equal(escrow.balance,pot);
  await finish(host,id);const first=await command(host,id,'settle');assert.equal(first.economy.economy.state,'settled');assert.equal(first.economy.settlement.payout_amount,pot);assert.equal(first.economy.settlement.fee_amount,'0');
  const expected=1000000000n-BigInt(entry.replace('0.',''))*10n**BigInt(9-entry.split('.')[1].length)+BigInt(pot);assert.equal(balances(first)[first.replay.winner],String(expected));
  await host.restart();const again=await command(host,id,'settle');assert.deepEqual(again.economy.operations,first.economy.operations);assert.deepEqual(balances(again),balances(first));
 }}finally{await host.close();}
});
test('local submitted payout recovers from worker crash by verification without a second broadcast',{skip:!local,timeout:90000},async()=>{
 const host=await fixture({ECONOMY_TEST_CRASH_AFTER_SUBMIT:'payout'});try{
  const id=await create(host,'local');await command(host,id,'fund-all');const crashed=await finish(host,id,true);assert.notEqual(crashed.status,200);
  await host.restart({ECONOMY_TEST_CRASH_AFTER_SUBMIT:''});const recovered=await command(host,id,'reconcile');assert.equal(recovered.economy.economy.state,'settled');assert.equal(recovered.economy.settlement.status,'confirmed');assert.equal(recovered.economy.operations.filter(r=>r.purpose==='payout').length,1);
  assert.equal(balances(recovered)[recovered.replay.winner],'1060000000');const again=await command(host,id,'settle');assert.deepEqual(again.economy.operations,recovered.economy.operations);
 }finally{await host.close();}
});
test('local partial refunds resume the original transactions after worker crash',{skip:!local,timeout:90000},async()=>{
 const host=await fixture({ECONOMY_TEST_CRASH_AFTER_SUBMIT:'refund'});try{
  const id=await create(host,'local');for(const agent_id of ['agent-1','agent-2'])await command(host,id,'fund',{agent_id});assert.notEqual((await host.request(`/api/funded-matches/${id}/cancel`,{})).status,200);
  await host.restart({ECONOMY_TEST_CRASH_AFTER_SUBMIT:''});const recovered=await command(host,id,'cancel');assert.equal(recovered.economy.economy.state,'refunded');assert.equal(recovered.replay.final_state.turn,0);assert.equal(balances(recovered)['agent-1'],'1000000000');assert.equal(balances(recovered)['agent-2'],'1000000000');assert.equal(recovered.economy.operations.filter(r=>r.purpose==='refund').length,2);
  await host.restart({ECONOMY_TEST_CRASH_AFTER_SUBMIT:''});const again=await command(host,id,'cancel');assert.deepEqual(again.economy.operations,recovered.economy.operations);
 }finally{await host.close();}
});
test('RPC failure preserves an unsubmitted intent and retries it after restart',{skip:!local,timeout:60000},async()=>{
 const host=await fixture({ECONOMY_TEST_RPC_FAIL_METHOD:'getLatestBlockhash'});try{
  const id=await create(host,'local');assert.notEqual((await host.request(`/api/funded-matches/${id}/fund`,{agent_id:'agent-1'})).status,200);const failed=await host.request(`/api/funded-matches/${id}`);assert.equal(failed.data.economy.operations.length,1);assert.equal(failed.data.economy.operations[0].status,'created');assert.equal(failed.data.economy.operations[0].retry_count,1);
  await host.restart({ECONOMY_TEST_RPC_FAIL_METHOD:''});const funded=await command(host,id,'fund',{agent_id:'agent-1'});assert.equal(funded.economy.operations.length,1);assert.equal(funded.economy.operations[0].status,'confirmed');assert.equal(balances(funded)['agent-1'],'980000000');await command(host,id,'cancel');
 }finally{await host.close();}
});
