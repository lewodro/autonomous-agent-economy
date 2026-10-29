import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldAgentPresenceService, WORLD_AGENT_ROUTE } from '../service/world-agent-presence.js';
import { NPC_WAYPOINTS } from '../web/dist/world/map.js';

const profiles = [
  {id:'agent-1',name:'Founder',strategy:'Balanced',sprite:'assets/agents/01-founder.png',arenaStatus:'queued',recentWinner:false},
  {id:'agent-2',name:'Trader',strategy:'Trader',sprite:'assets/agents/02-trader.png',arenaStatus:'queued',recentWinner:true},
  {id:'agent-3',name:'Gambler',strategy:'Gambler',sprite:'assets/agents/03-gambler.png',arenaStatus:'fighting',recentWinner:false}
];

test('server canonical route stays aligned with the browser collision-safe route',()=>{
  assert.deepEqual(WORLD_AGENT_ROUTE,NPC_WAYPOINTS);
});

test('canonical agents move concurrently on one authoritative timeline',()=>{
  let now=1_000;
  const events=[];
  const service=new WorldAgentPresenceService({profiles:()=>profiles,now:()=>now,rosterMs:100,maxAgents:6});
  service.setEmitter((type,payload)=>events.push({type,...payload}));
  service.syncRoster(true);
  const initial=service.snapshot();
  assert.equal(initial.length,2,'agents actively fighting stay inside the Arena');
  assert.notDeepEqual(initial[0].position,initial[1].position,'canonical agents start on different route points');
  now=6_000;service.tick();
  now+=250;service.tick();
  const moved=service.snapshot();
  assert.ok(moved.some((agent,index)=>agent.position.x!==initial[index].position.x||agent.position.y!==initial[index].position.y));
  assert.ok(events.some(event=>event.type==='AgentMoved'));
  assert.equal('waypoint' in moved[0],false,'private route state is not sent to browsers');
});

test('canonical roster changes are shared rather than browser-local',()=>{
  let now=1_000;
  const source=profiles.map(profile=>({...profile}));
  const events=[];
  const service=new WorldAgentPresenceService({profiles:()=>source,now:()=>now,rosterMs:100});
  service.setEmitter((type,payload)=>events.push({type,...payload}));
  service.syncRoster(true);
  source[0].arenaStatus='fighting';source[2].arenaStatus='queued';now+=101;service.syncRoster();
  assert.deepEqual(service.snapshot().map(agent=>agent.agent_id).sort(),['agent-2','agent-3']);
  assert.ok(events.some(event=>event.type==='AgentLeft'&&event.agent_id==='agent-1'));
  assert.ok(events.some(event=>event.type==='AgentJoined'&&event.agent.agent_id==='agent-3'));
});
