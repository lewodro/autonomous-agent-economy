import test from 'node:test';import assert from 'node:assert/strict';
import {HttpModelAdapter,InferenceBudget} from '../service/model-adapter.js';
import {MatchRuntime} from '../service/runtime.js';
const profile={id:'a',provider:'openai-compatible',model:'local-test',prompt:'Protect my seat',personality:'cautious',inference:{base_url:'http://model.test/v1',api_key_env:'TEST_API_KEY',max_requests:2,retries:1,max_tokens:32}};
const previousBase=process.env.MODEL_BASE_URL, previousKey=process.env.MODEL_API_KEY_ENV;
test.before(()=>{process.env.MODEL_BASE_URL='http://model.test/v1';process.env.MODEL_API_KEY_ENV='TEST_API_KEY';});
test.after(()=>{for(const [key,value] of [['MODEL_BASE_URL',previousBase],['MODEL_API_KEY_ENV',previousKey]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
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
test('public rationale strips provider metadata and mock adapters do not call inference',async()=>{
 const {publicDecisionReason,validateDecision}=await import('../service/model-adapter.js');
 const {decisionsFor}=await import('../service/adapters.js');
 const observation={agents:[{id:'a',credits:12,private_key:'never-show'},{id:'b',credits:4},{id:'c',credits:90}]};
 const choice={agent_id:'a',action:'challenge',target:'b',reason:'Challenge a vulnerable rival.',thinking:'private trace',wallet:'secret'};
 assert.deepEqual(publicDecisionReason(choice,observation),{summary:'Challenged b.',relevant_state:[{agent_id:'a',credits:12},{agent_id:'b',credits:4}]});
 const modelChoice=validateDecision({action:'challenge',target:'b',reason:'private chain of thought'},profile);
 assert.deepEqual(modelChoice,{agent_id:'a',action:'challenge',target:'b',reason:'Challenged b.'});
 assert.equal(validateDecision({action:'work',target:null,reason:'leaked trace'},profile).reason,'Worked to earn credits.');
 assert.equal(await decisionsFor({agents:[{id:'a',provider:'mock'}]},observation),null);
 assert.ok((await import('../service/adapters.js')).adapterFactories.has('http'));
 assert.ok((await import('../service/adapters.js')).adapterFactories.has('openai-compatible'));
});
