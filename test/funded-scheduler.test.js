import test from 'node:test';
import assert from 'node:assert/strict';
import {FundedRuntime} from '../service/funded-runtime.js';
function fixture(state='settlement_pending'){
 const result={session:'test',replay:{final_state:{ended:true,turn:5}},economy:{economy:{state,payment_mode:'mock'},funding_deadline:0}};
 const calls=[];let failing=true;
 const core={request:async request=>{calls.push(request.action);if(request.action!=='get'&&failing)throw Error('RPC unavailable');return structuredClone(result);}};
 const runtime={busy:new Set(),checkpoint:async()=>{}};
 const host=new FundedRuntime(core,runtime,{publishEconomy(){}},new Map());host.remember(structuredClone(result));
 return {host,calls,succeed:()=>{failing=false;}};
}
test('automatic financial retries back off, stop after eight failures, and preserve the pending match',async()=>{
 const {host,calls}=fixture();for(let i=1;i<=8;i++){host.matches.get('test').nextAttempt=0;await host.tick();const row=host.matches.get('test');assert.equal(row.failures,i);assert.ok(row.nextAttempt>Date.now());assert.equal(row.economy.economy.state,'settlement_pending');}
 host.matches.get('test').nextAttempt=0;await host.tick();assert.equal(calls.filter(c=>c==='settle').length,8);assert.equal(host.health().automatic_retries_exhausted,1);
});
test('explicit retry clears exhausted automatic retry state after a successful operation',async()=>{
 const {host,succeed}=fixture();host.matches.get('test').failures=8;succeed();await host.act('test','reconcile');assert.equal(host.health().automatic_retries_exhausted,0);assert.equal(host.matches.get('test').nextAttempt,0);
});
test('a recovered funded match past its deadline is expired instead of started',async()=>{
 const {host,calls,succeed}=fixture('funded');succeed();await host.tick();assert.deepEqual(calls,['expire']);
});
