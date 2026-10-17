import test from 'node:test';
import assert from 'node:assert/strict';
import { addMindLesson, createAgentMind, mindContext, migrateAgentMind } from '../service/agent-mind.js';

test('AgentMind keeps identity, controller and bounded memory structured',()=>{
 const mind=createAgentMind({agentId:'agent-1',personality:'analyst',strategy:'conservative',shortTerm:Array.from({length:20},(_,i)=>({i})),longTerm:Array.from({length:40},(_,i)=>({i})),controller:{type:'mcp'}});
 assert.equal(mind.memory.short_term.length,8);assert.equal(mind.memory.long_term.length,32);assert.equal(mind.controller.type,'mcp');assert.equal(mindContext(mind).private_secret,undefined);
});
test('AgentMind migration projects legacy match memory into structured lessons',()=>{const mind=migrateAgentMind({id:'agent-2',strategy:'Trader',memory:[{game:'rps',matchId:'game-1',opponent:'agent-3',observed:'pattern'}]});assert.equal(mind.agent_id,'agent-2');assert.equal(mind.identity.strategy,'Trader');assert.equal(mind.memory.long_term.length,1);assert.equal(mind.memory.long_term[0].lesson_type,'match_observation');assert.deepEqual(mind.memory.long_term[0].evidence_match_ids,['game-1']);});
test('AgentMind lessons are structured and compacted',()=>{let mind=createAgentMind({agentId:'agent-3'});for(let i=0;i<40;i++)mind=addMindLesson(mind,{lesson_type:'opponent_note',subject_agent_id:'agent-2',summary:`lesson ${i}`,evidence_match_ids:['game-1'],confidence:2});assert.equal(mind.memory.long_term.length,32);assert.equal(mind.memory.long_term.at(-1).confidence,1);});
