import test from 'node:test';
import assert from 'node:assert/strict';
import {FundedRuntime} from '../service/funded-runtime.js';

test('failed funded-match checkpoint discards only the fresh host and releases its session',async()=>{
 const calls=[],sessions=new Map(),removed=[],requests=[];
 const result={session:'fresh-session',replay:{match_id:'seat-a',final_state:{turn:0,ended:false}},economy:{economy:{state:'unfunded',payment_mode:'mock'},events:[]}};
 const core={request:async request=>{calls.push(request.action);requests.push(request);if(request.action==='create')return {...result,session:request.session};if(request.action==='discard-unfunded')return {removed:true};throw Error(`unexpected ${request.action}`);}};
 const runtime={checkpoint:async()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});},remove:async session=>removed.push(session)};
 const host=new FundedRuntime(core,runtime,{publishEconomy(){}},sessions);
 await assert.rejects(host.create({agents:[]},{mode:'mock'}),{code:'ENOSPC'});
 assert.deepEqual(calls,['create','discard-unfunded']);
 assert.deepEqual(removed,[requests[0].session]);
 assert.equal(requests[1].session,requests[0].session);
 assert.equal(sessions.size,0);
 assert.equal(host.matches.size,0);
});

test('failed cleanup preserves the funded-host session for reconciliation',async()=>{
 const calls=[],sessions=new Map();
 const result={session:'uncertain-session',replay:{final_state:{turn:0,ended:false}},economy:{economy:{state:'unfunded',payment_mode:'mock'},events:[]}};
 const core={request:async request=>{calls.push(request.action);if(request.action==='create')return {...result,session:request.session};throw Object.assign(new Error('worker unavailable'),{code:'engine_unavailable'});}};
 const runtime={checkpoint:async()=>{throw Error('disk full');},remove:async()=>assert.fail('must retain checkpoint state after uncertain host cleanup')};
 const host=new FundedRuntime(core,runtime,{publishEconomy(){}},sessions);
 await assert.rejects(host.create({agents:[]},{mode:'mock'}),/disk full/);
 assert.deepEqual(calls,['create','discard-unfunded']);
 assert.equal(sessions.size,1);
 assert.equal(host.matches.size,1,'the in-memory scheduler retains a host that could not be safely discarded');
});

test('a worker error after durable host creation still attempts guarded cleanup',async()=>{
 const calls=[],sessions=new Map(),removed=[];
 const core={request:async request=>{
  calls.push(request);
  if(request.action==='create')throw Object.assign(new Error('worker response lost'),{code:'engine_unavailable'});
  if(request.action==='discard-unfunded')return {removed:true};
  throw Error('unexpected request');
 }};
 const runtime={checkpoint:async()=>{},remove:async session=>removed.push(session)};
 const host=new FundedRuntime(core,runtime,{publishEconomy(){}},sessions);
 await assert.rejects(host.create({agents:[]},{mode:'mock'}),{code:'engine_unavailable'});
 assert.deepEqual(calls.map(call=>call.action),['create','discard-unfunded']);
 assert.equal(calls[0].session,calls[1].session);
 assert.deepEqual(removed,[calls[0].session]);
 assert.equal(sessions.size,0);
});
