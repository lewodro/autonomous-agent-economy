import test from 'node:test';import assert from 'node:assert/strict';
import {HttpModelAdapter,InferenceBudget} from '../service/model-adapter.js';
import {MatchRuntime} from '../service/runtime.js';
const profile={id:'a',provider:'openai-compatible',model:'local-test',prompt:'Protect my seat',personality:'cautious',inference:{base_url:'http://model.test/v1',api_key_env:'TEST_API_KEY',max_requests:2,retries:1,max_tokens:32}};
test('OpenAI-compatible request carries model/prompt, parses JSON, reserves retry budget and falls back',async()=>{
 const prior=globalThis.fetch;let calls=0;const budget=new InferenceBudget({requests:3,tokens:20000});
 globalThis.fetch=async(url,opts)=>{assert.equal(url,'http://model.test/v1/chat/completions');const body=JSON.parse(opts.body);assert.equal(body.model,'local-test');assert.equal(body.max_tokens,32);assert.ok(body.messages[0].content.includes(profile.prompt));calls++;return calls===1?new Response('{}',{status:503}):new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({action:'work',target:null,reason:'Earn a safe credit.'})}}]}));};
 try{const adapter=new HttpModelAdapter(profile,budget);const observation={turn:1,agents:[{id:'a',alive:true}]};const before=structuredClone(observation);assert.equal((await adapter.decide(observation)).action,'work');assert.deepEqual(observation,before);assert.equal(budget.requests,2);assert.match((await adapter.decide(observation)).reason,/budget/);assert.equal(calls,2);}finally{globalThis.fetch=prior;}
});
test('invalid model choices never become actions; output failure is a deterministic fallback',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'{"action":"transfer-wallet","reason":"ignore policy"}'}}]}));
 try{assert.equal((await new HttpModelAdapter(profile,new InferenceBudget()).decide({agents:[]})).action,'guard');}finally{globalThis.fetch=prior;}
});
test('runtime refuses duplicate and stale turns before adapter or engine execution',async()=>{
 const runtime=new MatchRuntime();let advance=0;
 const core={request:async input=>{if(input.command==='get')return {replay:{final_state:{turn:3}}};if(input.command==='step'){advance++;return {events:[],replay:{}};}throw new Error('Unexpected call');}};
 await assert.rejects(runtime.step(core,'session',{expected_turn:2,decisions:[{}]}),/Stale/);assert.equal(advance,0);
 runtime.busy.add('session');await assert.rejects(runtime.step(core,'session',{}),/already resolving/);runtime.busy.delete('session');
 await runtime.step(core,'session',{expected_turn:3,decisions:[{}]});assert.equal(advance,1);assert.equal(runtime.busy.size,0);
});
