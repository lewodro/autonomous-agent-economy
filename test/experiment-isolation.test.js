import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {visitorSession} from '../service/visitor-session.js';
import {ExperimentStore,experimentExport} from '../service/experiment-store.js';

test('visitor cookies are random, signed, scoped and reject fixation',()=>{
  const env={NODE_ENV:'production',HOST_SESSION_SECRET:'a'.repeat(64)};
  const a=visitorSession({headers:{}},env,1_000_000_000_000);
  const b=visitorSession({headers:{}},env,1_000_000_000_000);
  assert.notEqual(a.id,b.id);
  assert.match(a.cookie,/HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  assert.match(a.cookie,/Path=\/api\/experiments/);
  const token=a.cookie.split(';')[0];
  assert.equal(visitorSession({headers:{cookie:token}},env,1_000_000_000_000).id,a.id);
  assert.notEqual(visitorSession({headers:{cookie:token.replace(a.id,b.id)}},env,1_000_000_000_000).id,a.id);
  assert.notEqual(visitorSession({headers:{cookie:`aae_visitor=${a.id}`}},env,1_000_000_000_000).id,a.id);
  assert.notEqual(visitorSession({headers:{cookie:token}},env,1_000_000_000_000+91*86_400_000).id,a.id);
});

test('experiment metadata persists owner, bounds creation and prunes expired completed runs',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'aae-experiments-'));
  const deleted=[];
  const sessionStore={delete:async id=>deleted.push(id)};
  const store=new ExperimentStore(dir,sessionStore,{maxMatches:1,retentionDays:1,exportMaxBytes:32_000_000});
  const alice='11111111-1111-4111-8111-111111111111',bob='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
  const replay={seed:42,match_id:'seat-'+'a'.repeat(64),config:{max_turns:2,agents:[{id:'a',name:'Alice',prompt:'hidden',api_key:'secret'}]},final_state:{ended:true,turn:2,end_reason:'done',agents:[{id:'a',credits:1,alive:true,stats:{}}]},winner:'a',events:[{seq:0,turn:1,type:'MatchEnded',reason:'done',hidden:'secret'}],statistics:[{actions:1}]};
  try{
    const record=await store.create(id,alice,replay,1000);
    assert.equal(JSON.parse(await readFile(path.join(dir,`${id}.json`),'utf8')).owner_session_id,alice);
    assert.equal(store.list(bob).length,0);
    assert.throws(()=>store.get(id,bob),{status:404});
    assert.throws(()=>store.checkCapacity(alice),{status:429});
    assert.equal(JSON.stringify(experimentExport(record,replay)).includes('secret'),false);
    const restored=new ExperimentStore(dir,sessionStore,{maxMatches:1,retentionDays:1,exportMaxBytes:32_000_000});
    await restored.restore(1000+2*86_400_000);
    assert.deepEqual(deleted,[id]);assert.equal(restored.list(alice).length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
