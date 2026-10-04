import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcResult,validatePin} from '../scripts/local-validator-checks.js';
test('validator preflight rejects HTTP errors, mismatched envelopes and public or changed genesis',()=>{
 for(const value of [null,{}, {id:1,result:'ok'},{jsonrpc:'2.0',id:2,result:'ok'},{jsonrpc:'2.0',id:1,error:{}},{jsonrpc:'2.0',id:1}])assert.throws(()=>rpcResult({ok:true},value));
 assert.throws(()=>rpcResult({ok:false},{jsonrpc:'2.0',id:1,result:'ok'}));
 assert.equal(rpcResult({ok:true},{jsonrpc:'2.0',id:1,result:'ok'}),'ok');
 for(const genesis of [null,'bad','EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2d'])assert.throws(()=>validatePin(genesis,null));
 const genesis='11111111111111111111111111111111';validatePin(genesis,{rpc:'http://127.0.0.1:8899',genesis});
 assert.throws(()=>validatePin(genesis,{rpc:'https://other.invalid',genesis}));
 assert.throws(()=>validatePin(genesis,{rpc:'http://127.0.0.1:8899',genesis:'different'}));
});
