import test from 'node:test';
import assert from 'node:assert/strict';
import {clientRateKey} from '../service/client-ip.js';

test('rate limits use the socket peer unless proxy trust is enabled',()=>{
 const req={headers:{'x-real-ip':'203.0.113.8','x-forwarded-for':'198.51.100.9'},socket:{remoteAddress:'10.0.0.4'}};
 assert.equal(clientRateKey(req),'10.0.0.4');
 assert.equal(clientRateKey(req,{trustProxy:true}),'203.0.113.8');
});

test('trusted proxy IP resolution validates the single IP and supports X-Forwarded-For fallback',()=>{
 const socket={remoteAddress:'10.0.0.4'};
 assert.equal(clientRateKey({headers:{'x-real-ip':'unknown','x-forwarded-for':'198.51.100.9, 10.0.0.2'},socket},{trustProxy:true}),'198.51.100.9');
 assert.equal(clientRateKey({headers:{'x-real-ip':'unknown','x-forwarded-for':'invalid'},socket},{trustProxy:true}),'10.0.0.4');
});
