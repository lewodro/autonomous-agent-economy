import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsSurvivalUpdate, parseSurvivalSnapshot, hitTest, hitEffectAgent } from '../web/dist/world/survival.js';

const agent=(id,x,status='alive',hp=status==='eliminated'?0:70,target_id=null)=>({id,name:id.toUpperCase(),sprite:'assets/agents/01-founder.png',x,y:100,hp,max_hp:100,status,target_id,strategy:'careful',recent_action:'Repositioned',research:null,wins:1,losses:0,direction:'right',movement_intent:'chase',metrics:{damage_dealt:10,damage_taken:2,attacks_landed:1,target_changes:0,retreat_count:0,time_alive:3,eliminations:0,times_cornered:0,escapes:0,final_placement:null}});
const snapshot=()=>({schema_version:1,match_id:'survival-1',status:'live',sequence:1,updated_at:'2026-10-07T20:00:00.000Z',round:3,map:{width:400,height:300,obstacles:[{id:'wall',x:10,y:10,width:30,height:10,kind:'wall'}]},agents:[agent('ember',100,'alive',70,'atlas'),agent('atlas',200)],engagements:[{id:'ember-atlas',attacker_id:'ember',target_id:'atlas',status:'fighting',recent_damage:4,recent_actions:['Ember hit Atlas']}],leader_id:'ember',events:[{seq:1,type:'AttackLanded',agent_id:'ember',target_id:'atlas',round:3,summary:'Ember hit Atlas for 4'}]});

test('Survival snapshot accepts bounded, authoritative render data and selects agents/fights',()=>{
 const state=parseSurvivalSnapshot(snapshot());assert.equal(state.agents.length,2);
 assert.deepEqual(hitTest(state,150,100),{kind:'fight',id:'ember-atlas'});
 assert.deepEqual(hitTest(state,100,100),{kind:'agent',id:'ember'});
 assert.equal(hitTest(state,350,250),undefined);
 const displayed=new Map([['ember',{x:115,y:120}],['atlas',{x:205,y:120}]]);
 assert.deepEqual(hitTest(state,115,120,displayed),{kind:'agent',id:'ember'},'selection follows the interpolated sprite');
 assert.deepEqual(hitTest(state,160,120,displayed),{kind:'fight',id:'ember-atlas'},'fight selection follows its displayed line');
});

test('Survival snapshot rejects invalid authority, references, bounds, and unregistered sprite URLs',()=>{
 for(const mutate of [
  s=>s.agents.push(agent('third',50)),
  s=>s.agents[0].hp=101,
  s=>s.agents[0].x=999,
  s=>s.agents[0].sprite='https://evil.example/avatar.png',
  s=>s.agents[0].target_id='missing',
  s=>s.engagements[0].target_id='missing',
  s=>s.leader_id='missing',
  s=>s.events[0].type='WinnerInvented',
  s=>s.agents[0].metrics.damage_taken=Number.NaN,
  s=>s.agents[0].movement_intent='teleport',
  s=>s.agents[0].status='eliminated',
  s=>s.events.length=51
 ])assert.throws(()=>parseSurvivalSnapshot(mutate(snapshot())),/Survival/);
});

test('damage events flash the agent whose HP changed, not the attacker',()=>{
 assert.equal(hitEffectAgent({seq:2,type:'AttackLanded',agent_id:'ember',target_id:'atlas',round:3,summary:'Ember hit Atlas'}),'atlas');
 assert.equal(hitEffectAgent({seq:3,type:'DamageTaken',agent_id:'atlas',target_id:'ember',round:3,summary:'Atlas lost 10 HP'}),'atlas');
 assert.equal(hitEffectAgent({seq:4,type:'ChaseStarted',agent_id:'ember',target_id:'atlas',round:3,summary:'Ember closes on Atlas'}),undefined);
});

test('a new Survival match replaces the finished snapshot even when its sequence restarts',()=>{
 const finished=parseSurvivalSnapshot({...snapshot(),status:'finished',sequence:400});
 const next=parseSurvivalSnapshot({...snapshot(),match_id:'survival-2',sequence:1});
 assert.equal(acceptsSurvivalUpdate(finished,next),true);
 assert.equal(acceptsSurvivalUpdate(finished,parseSurvivalSnapshot({...snapshot(),sequence:399})),false);
});
