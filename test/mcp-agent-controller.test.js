import test from 'node:test';
import assert from 'node:assert/strict';
import { McpAgentController, approvedObservation, validateAgentIntent, safeFallbackIntent } from '../service/mcp-agent-controller.js';

test('MCP observation is public and bounded',()=>{
 const observation=approvedObservation({agent_id:'ember',game_state:'survival',hp:42,position:{x:1,y:2},legal_actions:['attack','bad'],nearby_agents:['watcher-1'],research_summary:'public',mind:{identity:{personality:'analyst',strategy:'balanced'},long_term:[{summary:'public lesson'}]}});
 assert.deepEqual(observation.legal_actions,['attack']);assert.equal(observation.mind.identity.personality,'analyst');assert.equal(observation.private,undefined);
});
test('MCP valid intent is accepted and invalid intent is rejected',()=>{
 assert.deepEqual(validateAgentIntent({action:'move',x:1,y:-1}),{action:'move',x:1,y:-1});
 assert.throws(()=>validateAgentIntent({action:'set_hp',hp:100}));
});
test('MCP timeout and malformed responses use a safe fallback',async()=>{
 const errors=[];const controller=new McpAgentController({timeoutMs:5,adapter:{decide:()=>new Promise(()=>{})},onError:error=>errors.push(error.code)});
 assert.deepEqual(await controller.decide({agent_id:'ember',position:{x:0,y:0}}),safeFallbackIntent());assert.deepEqual(errors,['MCP_TIMEOUT']);
 const malformed=new McpAgentController({adapter:{decide:()=>({action:'set_balance'})}});
 assert.deepEqual(await malformed.decide({agent_id:'ember',position:{x:0,y:0}}),safeFallbackIntent());
});
test('MCP disconnect is recoverable without changing authority',async()=>{
 let disconnected=false;const controller=new McpAgentController({adapter:{decide:()=>({action:'defend'}),disconnect:()=>{disconnected=true;}}});
 controller.disconnect();assert.equal(disconnected,true);assert.deepEqual(await controller.decide({agent_id:'ember',position:{x:0,y:0}}),{action:'defend'});assert.equal(controller.health().connected,false);
});
