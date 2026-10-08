import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Core} from '../service/core.js';
import {ArenaSurvivalService} from '../service/arena-survival.js';
import {createState} from '../src/economy.js';
import {parseSurvivalSnapshot} from '../web/dist/world/survival.js';

const profiles=()=>createState().agents;
const service=(core,directory)=>new ArenaSurvivalService(core,directory,{profiles,seedFactory:()=>731,syncFolder:async()=>{}});

test('authoritative Survival service checkpoints, recovers, records research, and supplies it to the next match',{timeout:30000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'arena-survival-'));
 let core=new Core(),survival=service(core,directory);
 try{
  await survival.restore();
  let current=survival.snapshot();
  const frontend=parseSurvivalSnapshot(current);
  assert.equal(frontend.agents.length,20);
  assert.equal(frontend.status,'live');
  assert.ok(frontend.map.obstacles.length>0);
  assert.ok(frontend.agents.every(agent=>agent.hp===100&&agent.status==='alive'&&agent.target_id===null));
  for(let i=0;i<12;i++)await survival.stepOnce();
  const savedBeforeRestart=structuredClone(survival.snapshot());
  await survival.close();core.stop();

  core=new Core();survival=service(core,directory);await survival.restore();
  assert.deepEqual(survival.snapshot(),savedBeforeRestart,'restart must restore the exact authoritative match revision');
  current=survival.snapshot();
  let ticks=0;
  while(current.status!=='finished'&&ticks<1800){current=await survival.stepOnce();ticks++;}
  assert.equal(current.status,'finished','20-agent public Survival match should resolve');
  assert.ok(current.events.some(event=>event.type==='AttackLanded'));
  assert.ok(current.events.some(event=>event.type==='AgentEliminated'));
  assert.ok(current.events.some(event=>event.type==='WinnerDeclared'));
  assert.ok(current.events.some(event=>event.type==='ResearchUpdated'));
  assert.ok(current.leader_id);
  assert.ok(current.agents.every(agent=>agent.metrics.final_placement!==null));
  const profile=survival.mergeProfiles(profiles()).find(agent=>agent.id===current.leader_id);
  assert.equal(profile.survival.latest_placement,1);
  assert.equal(profile.survival.average_placement,1);

  const firstMatch=current.match_id;
  const historyBefore=structuredClone(survival.saved.history);
  assert.ok(historyBefore[0].events.length<=512);
  assert.ok(historyBefore[0].events.some(event=>event.type==='ResearchUpdated'));
  assert.ok(historyBefore[0].events.every((event,index,events)=>index===0||events[index-1].seq<event.seq));
  assert.equal(survival.log(historyBefore[0].run_id).events.length,historyBefore[0].events.length);
  const winnerBefore=survival.saved.records[current.leader_id].wins;
  const emptyTotals={scope:'verified retained arena runs',updated_at:null,totals:{matches:0,decisions:0,draws:0},games:{rps:{matches:0,draws:0,decisions:0},tictactoe:{matches:0,draws:0,decisions:0}},agents:profiles()};
  const statistics=survival.statistics(emptyTotals);
  assert.equal(statistics.games.survival.matches,1);
  assert.equal(statistics.totals.decisions,survival.saved.history[0].agents.reduce((sum,agent)=>sum+agent.metrics.attacks_landed+agent.metrics.target_changes,0));
  await survival.commitFinished();
  assert.deepEqual(survival.saved.history,historyBefore,'committing a completed match twice cannot duplicate history');
  assert.equal(survival.saved.records[current.leader_id].wins,winnerBefore,'committing a completed match twice cannot duplicate research rollups');
  assert.equal(JSON.parse(await readFile(path.join(directory,'survival.json'),'utf8')).history.length,1);
  await survival.startMatch(2);
  const next=survival.snapshot();
  assert.ok(next.agents.every(agent=>agent.research!==null),'previous structured research is visible to the next match');
  assert.ok(next.events.some(event=>event.type==='AgentSpawned'&&event.summary.includes(firstMatch)),'spawn event explains which prior run supplied its memory');
  assert.ok(survival.saved.current.config.agents.some(agent=>agent.research_hint?.source_match===firstMatch),'next-match strategy configuration consumes the persisted research hint');
  assert.equal(survival.saved.records[current.leader_id].matches,1);
  await survival.close();core.stop();

  core=new Core();survival=service(core,directory);await survival.restore();
  assert.equal(survival.saved.history.length,1,'completed research survives a process restart');
  assert.equal(survival.saved.records[current.leader_id].matches,1);
  assert.equal(survival.saved.current.match_number,2);
  parseSurvivalSnapshot(survival.snapshot());
 }finally{await survival.close();core.stop();await rm(directory,{recursive:true,force:true});}
});

test('public Survival scheduler retains a result then automatically opens the next live match',{timeout:10000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'arena-survival-cycle-'));
 const core=new Core(),survival=new ArenaSurvivalService(core,directory,{profiles,tickMs:50,checkpointTicks:20,resultMs:500,maxRounds:20,seedFactory:()=>997,syncFolder:async()=>{}});
 try{
  await survival.restore();
  survival.start();
  const deadline=Date.now()+8000;
  while(survival.saved.current.match_number<2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(survival.saved.current.match_number,2,'the scheduler must restart after the completed result window');
  assert.equal(survival.saved.current.status,'live');
  assert.equal(survival.saved.history.length,1);
  assert.equal(survival.saved.history[0].match_id,'survival-997-1');
  assert.equal(survival.saved.current.match_id,'survival-997-2');
 }finally{await survival.close();core.stop();await rm(directory,{recursive:true,force:true});}
});
