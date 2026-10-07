import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { Core } from '../service/core.js';
import { decisionsFor } from '../service/adapters.js';

test('offline Rust wallet demo is byte reproducible and rejects unknown or incomplete flags',()=>{
  const run=args=>spawnSync('rust/target/debug/wallet-demo',args,{encoding:'utf8'});
  const first=run([]),second=run([]);
  assert.equal(first.status,0);assert.equal(first.stdout,second.stdout);
  assert.equal(JSON.parse(first.stdout).wallet.balance,1_999_000_000);
  assert.notEqual(run(['--mainnet']).status,0);
  assert.notEqual(run(['--load-test-wallet']).status,0);
});

test('HTTP decisions store only generated public summaries and replay without provider calls',async()=>{
  let calls=0;
  const adapter=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const input=JSON.parse(text);calls++;
    assert.equal(input.agent.prompt,'Choose work in the integration test.');
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({action:'work',target:null,reason:'This is a recorded external decision.'}));
  });
  adapter.listen(0,'127.0.0.1');await once(adapter,'listening');
  const prior=process.env.AGENT_HTTP_ENDPOINT;
  process.env.AGENT_HTTP_ENDPOINT=`http://127.0.0.1:${adapter.address().port}`;
  const core=new Core();
  try{
    const config=await core.request({command:'defaults',count:2});config.max_turns=1;
    config.agents.forEach(a=>{a.provider='http';a.prompt='Choose work in the integration test.';});
    await core.request({command:'start',config});
    const info=await core.request({command:'observe'});
    const decisions=await decisionsFor(config,info.observation);
    const {replay}=await core.request({command:'step',decisions});
    assert.equal(calls,2);
    assert.equal(replay.events.filter(e=>e.type==='AgentActionSelected'&&e.reason==='Worked to earn credits.').length,2);
    assert.equal(JSON.stringify(replay).includes('recorded external decision'),false,'provider rationale must not enter persisted replay data');
    assert.deepEqual((await core.request({command:'verify',replay})).replay,replay);
    assert.equal(calls,2);
    process.env.AGENT_HTTP_ENDPOINT='http://127.0.0.1:1';
    assert.ok((await decisionsFor(config,info.observation)).every(d=>d.action==='guard'&&d.reason.includes('fallback')));
  }finally{core.stop();adapter.close();if(prior===undefined)delete process.env.AGENT_HTTP_ENDPOINT;else process.env.AGENT_HTTP_ENDPOINT=prior;}
});

test('HTTP replay sharing verifies the exact prefix and refuses tampering or cross-origin commands',async()=>{
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',MATCHES_DIR:await mkdtemp(os.tmpdir()+'/last-seat-share-')},stdio:['ignore','pipe','pipe']});
  try{
    const base=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server startup timed out')),5000);
      child.once('error',reject);
      child.stdout.on('data',chunk=>{const port=chunk.toString().match(/localhost:(\d+)/)?.[1];if(port){clearTimeout(timer);resolve(`http://127.0.0.1:${port}`);}});
    });
    const post=(route,data,extra={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(data)});
    const config=await fetch(base+'/api/config?agents=4').then(r=>r.json());
    const start=await post('/api/matches',{config}).then(r=>r.json());
    const step=await post(`/api/matches/${start.session}/step`,{}).then(r=>r.json());
    await post(`/api/matches/${start.session}/step`,{});
    const result=await post('/api/replays/share',{replay:step.replay});assert.equal(result.status,200);
    const {match_id}=await result.json();assert.equal(match_id,step.replay.match_id);
    assert.deepEqual((await fetch(base+'/api/replays/'+match_id).then(r=>r.json())).replay,step.replay);
    const bad=structuredClone(step.replay);bad.final_state.agents[0].credits++;
    assert.equal((await post('/api/replays/share',{replay:bad})).status,400);
    for(let index=0;index<8;index++)assert.equal((await post('/api/replays/share',{replay:bad})).status,400);
    const limitedShare=await post('/api/replays/share',{replay:bad});assert.equal(limitedShare.status,429);assert.equal((await limitedShare.json()).code,'RATE_LIMITED');
    assert.equal((await post('/api/matches',{config},{Origin:'https://unrelated.example'})).status,403);
    const spoofedHost=await new Promise((resolve,reject)=>{
      const req=http.request(base+'/api/matches',{method:'POST',headers:{'Content-Type':'application/json',Host:'attacker.example',Origin:'http://attacker.example'}},res=>{res.resume();resolve(res.statusCode);});
      req.on('error',reject);req.end(JSON.stringify({config}));
    });
    assert.equal(spoofedHost,421);
    assert.equal((await fetch(base+'/rust/Cargo.toml')).status,404);
    const wallet=await post('/api/wallet-demo',{}).then(r=>r.json());assert.equal(wallet.mode,'mock');assert.ok(wallet.events.some(e=>e.type==='WalletTransferConfirmed'));
  }finally{if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
});
