import test from 'node:test';import assert from 'node:assert/strict';
import {Core} from '../service/core.js';
import {applyEvent} from '../web/dist/replay.js';
import {mapEvent,CanvasAnimationDriver,dispatchAnimation} from '../web/dist/animation.js';
import {HttpMatchTransport} from '../web/dist/transport.js';
import {Player} from '../web/dist/player.js';
import {LiveObserver} from '../web/dist/live-observer.js';
test('live observer receives semantic transitions without HTTP turn requests',async()=>{
 const prior=globalThis.EventSource;let source;
 class Source extends EventTarget{constructor(url){super();this.url=url;source=this;}close(){this.closed=true;}send(type,data){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));}}
 globalThis.EventSource=Source;
 const histories=[],connected=[];
 const observer=new LiveObserver('session',run=>histories.push(run),value=>connected.push(value));
 try{
  assert.equal(source.url,'/api/matches/session/events');
  source.send('snapshot',{replay:{events:[{seq:0}],final_state:{turn:0}}});
  source.send('transition',{events:[{seq:1}],final_state:{turn:1},winner:null,statistics:[],match_id:'new'});
  assert.equal(histories.length,2);assert.equal(histories[1].events.length,2);
  source.send('transition',{events:[{seq:1}],final_state:{turn:1}});
  assert.equal(histories.length,2);assert.deepEqual(connected,[true]);
  source.send('transition',{events:[{seq:4}],final_state:{turn:2}});
  assert.equal(source.closed,true);assert.deepEqual(connected,[true,false]);
 }finally{observer.close();globalThis.EventSource=prior;}
 assert.equal(source.closed,true);
});
test('live observer closes after receiving an archived finished-match snapshot',async()=>{
 const prior=globalThis.EventSource;let source;class Source extends EventTarget{constructor(url){super();this.url=url;source=this;}close(){this.closed=true;}send(type,data){this.dispatchEvent(new MessageEvent(type,{data:JSON.stringify(data)}));}}
 globalThis.EventSource=Source;const statuses=[],histories=[];const observer=new LiveObserver('finished-session',run=>histories.push(run),value=>statuses.push(value));
 try{source.send('snapshot',{replay:{events:[],final_state:{turn:4,ended:true}}});source.onerror?.();assert.equal(source.closed,true);assert.equal(histories.length,1);assert.deepEqual(statuses,[true]);}
 finally{observer.close();globalThis.EventSource=prior;}
});
test('observer player can pause and inspect without advancing the Rust session',async()=>{
 const core=new Core();let advances=0;
 const player=new Player(()=>{},()=>{}, {advance:async()=>{advances++;throw new Error('Viewer must not advance');}});
 try{
  const config=await core.request({command:'defaults',count:2});
  const {replay}=await core.request({command:'start',config});
  player.receive(replay);assert.equal(player.observing,true);await player.step();
  const next=await core.request({command:'step'});player.receive(next.replay);
  assert.equal(player.state.turn,0);assert.equal(player.run.final_state.turn,1);
  player.seek(1);assert.equal(player.state.turn,1);assert.equal(advances,0);
 }finally{player.load(player.run);core.stop();}
});
test('every Rust v2 event projects to its authoritative final state without mutating input',async()=>{
 const core=new Core();try{const config=await core.request({command:'defaults',count:4});const start=await core.request({command:'start',config});let state=start.replay.starting_state;
 for(let turn=0;turn<3;turn++){const {events,replay}=await core.request({command:'step'});for(const event of events){const input=state,before=structuredClone(state);state=applyEvent(state,event);assert.deepEqual(input,before);if(event.projection)assert.deepEqual(state.agents.filter(a=>event.projection.agents.some(p=>p.id===a.id)),event.projection.agents);}assert.deepEqual(state,replay.final_state);}
 }finally{core.stop();}
});
test('animation mapper targets damage, transitions and resource values without computing rules',()=>{
 const e={type:'ChallengeResolved',actor:'a',target:'b',amount:4};const commands=mapEvent(e);assert.equal(commands[0].id,'b');assert.ok(commands.some(c=>c.type==='camera'));
 assert.deepEqual(mapEvent({type:'ResourceChanged',actor:'a',amount:-4,after:7}),[{type:'resource',id:'a',amount:-4,after:7,duration:750}]);
 assert.deepEqual(mapEvent({type:'RoundEnded'}),[]);
 assert.deepEqual(mapEvent({type:'ResourceChanged',actor:'a',amount:0,after:7}),[]);
});
test('animation driver freezes when paused, caps effects and suppresses motion on request',()=>{
 const driver=new CanvasAnimationDriver();driver.playAgentAnimation('b','hit');driver.tick(0,false,1);const first=driver.tick(100,false,1);const frozen=driver.tick(400,true,4);assert.deepEqual(first.poses,frozen.poses);
 for(let i=0;i<200;i++)driver.spawnParticles('b','confetti',100);const frame=driver.tick(500,false,1);assert.ok(frame.active<=96);assert.ok(frame.particles.length<=160);
 driver.setReducedMotion(true);const reduced=driver.tick(550,false,1);assert.equal(reduced.particles.length,0);assert.deepEqual(reduced.camera,{x:0,y:0});driver.reset();assert.equal(driver.tick(600,false,1).active,0);
});
test('compact transport rejects out-of-order transitions and reconciles stale requests',async()=>{
 const prior=globalThis.fetch,current={events:[{seq:0}],final_state:{turn:0}};
 try{globalThis.fetch=async()=>new Response(JSON.stringify({events:[{seq:4}],final_state:{turn:1}}));await assert.rejects(new HttpMatchTransport().advance('x',current),/Out-of-order/);
 let calls=0;globalThis.fetch=async()=>++calls===1?new Response(JSON.stringify({error:'Stale turn'}),{status:409}):new Response(JSON.stringify({replay:{...current,final_state:{turn:1}}}));assert.equal((await new HttpMatchTransport().advance('x',current)).final_state.turn,1);
 }finally{globalThis.fetch=prior;}
});
test('compact transport keeps runtime budget metadata out of canonical match history',async()=>{
 const prior=globalThis.fetch,current={version:5,seed:9,events:[{seq:0}],final_state:{turn:0}};
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({events:[{seq:1}],match_id:'updated',final_state:{turn:1},winner:null,statistics:[],budget:{requests_remaining:12}}));
  const next=await new HttpMatchTransport().advance('x',current);
  assert.equal(next.version,5);assert.equal(next.seed,9);assert.equal(next.match_id,'updated');
  assert.equal(next.events.length,2);assert.equal(current.events.length,1);
  assert.equal(Object.hasOwn(next,'budget'),false);
 } finally {globalThis.fetch=prior;}
});

test('a failed request from an old match cannot stop a newly loaded match',async()=>{
 const core=new Core();
 try {
  const config=await core.request({command:'defaults',count:2});
  const {replay}=await core.request({command:'start',config});
  const pending=[],errors=[];
  const transport={advance:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
  const player=new Player(()=>{},message=>errors.push(message),transport);
  player.load(replay,'old-session');const oldPlay=player.play();
  player.load(replay,'new-session');const newPlay=player.play();
  try {
   pending[0].reject(new Error('Old request failed after remix'));
   await oldPlay;
   assert.equal(player.playing,true);assert.equal(player.busy,true);assert.equal(player.waiting,true);
   assert.deepEqual(errors,[]);
  } finally {
   player.load(replay);
   pending[1].reject(new Error('Canceled newer request'));
   await newPlay;
  }
 }finally{core.stop();}
});

import {parseConfig} from '../web/dist/config.js';
import {expandConfig} from '../service/config.js';
test('short agent configs expand provider/prompt/avatar fields without putting rules in the browser',()=>{
 const short={seed:12,agents:[{name:'Builder',strategy:'aggressive'},{name:'Survivor',strategy:'defensive',system_prompt:'Stay alive',starting_stats:{credits:20}}]};
 assert.deepEqual(parseConfig(JSON.stringify(short)),short);assert.throws(()=>parseConfig('[]'),/agents/);
 const expanded=expandConfig(short,{seed:42,max_turns:40,agents:[{id:'agent-1',provider:'mock',strategy:'aggressive',starting_credits:12},{id:'agent-2',provider:'mock',strategy:'conservative',starting_credits:12}]});
 assert.equal(expanded.agents[1].strategy,'conservative');assert.equal(expanded.agents[1].prompt,'Stay alive');assert.equal(expanded.agents[1].starting_credits,20);
});
