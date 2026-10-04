import test from 'node:test';
import assert from 'node:assert/strict';
import {economyLog} from '../service/economy-log.js';
import {WorkerError} from '../service/worker-error.js';
test('critical diagnostics are opt-in and omit secrets and raw error objects',()=>{
 const previous=process.env.ECONOMY_LOG;const output=[];
 try{delete process.env.ECONOMY_LOG;economyLog('EntryReceived',{session:'s'},line=>output.push(line));assert.equal(output.length,0);
 process.env.ECONOMY_LOG='1';economyLog('EntryReceived',{session:'s',operation_id:'op',private_key:'SECRET',authorization:'SECRET',error:{detail:'SECRET'}},line=>output.push(line));
 const row=JSON.parse(output[0]);assert.equal(row.operation_id,'op');assert.equal(output[0].includes('SECRET'),false);
 const error=new WorkerError('{"code":"storage_failure","detail":"Corrupt journal envelope"}');assert.equal(error.code,'storage_failure');assert.equal(error.detail,'Corrupt journal envelope');
 assert.equal(new WorkerError('Legacy failure').message,'Legacy failure');
 }finally{if(previous===undefined)delete process.env.ECONOMY_LOG;else process.env.ECONOMY_LOG=previous;}
});
