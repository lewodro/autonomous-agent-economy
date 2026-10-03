import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRpc,requireSimulationResult} from '../demos/solana-rpc.js';
test('Solana JS demo rejects mismatched envelopes and incomplete simulation evidence',()=>{
 for(const data of [null,{}, {id:1,result:{}},{jsonrpc:'2.0',id:2,result:{}},{jsonrpc:'2.0',id:1},{jsonrpc:'2.0',id:1,error:{code:-1}}])assert.throws(()=>decodeRpc(data));
 assert.deepEqual(decodeRpc({jsonrpc:'2.0',id:1,result:{value:123}}),{value:123});
 for(const result of [null,{}, {value:null},{value:{}}])assert.throws(()=>requireSimulationResult(result));
 assert.deepEqual(requireSimulationResult({value:{err:null}}),{err:null});
 assert.deepEqual(requireSimulationResult({value:{err:'failure'}}),{err:'failure'});
});
