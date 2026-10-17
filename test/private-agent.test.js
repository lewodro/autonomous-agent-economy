import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePrivateAgent } from '../service/private-arena.js';
import { ArenaRoomPool } from '../service/arena-rooms.js';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('private agent profiles are bounded and MCP credentials are excluded',()=>{
 const agent=validatePrivateAgent({name:'My Scout',strategy:'aggressive',mcp:{controller_type:'mcp',endpoint:'https://agent.example/mcp',capabilities:['observe','intent']}});
 assert.deepEqual(agent,{name:'My Scout',strategy:'aggressive',mcp:{controller_type:'mcp',endpoint:'https://agent.example/mcp',capabilities:['observe','intent']}});
 assert.throws(()=>validatePrivateAgent({name:'x',strategy:'aggressive'}));
 assert.throws(()=>validatePrivateAgent({name:'Valid Name',strategy:'aggressive',mcp:{controller_type:'mcp',endpoint:'http://localhost/mcp',capabilities:[]}}));
 assert.throws(()=>validatePrivateAgent({name:'1invalid',strategy:'balanced'}));
 const deduped=validatePrivateAgent({name:'Agent 2',strategy:'balanced',mcp:{controller_type:'mcp',endpoint:'https://agent.example/mcp',capabilities:['observe','observe','intent']}});
 assert.deepEqual(deduped.mcp.capabilities,['observe','intent']);
});
test('private agent replaces only the owner arena roster slot',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'private-agent-'));try{
  const pool=new ArenaRoomPool(directory,{agentOverride:{name:'Owner Agent',strategy:'cooperative',sprite:'assets/agents/01-founder.png'}});await pool.restore();
  const profile=pool.profiles().find(agent=>agent.id==='agent-1');assert.equal(profile.name,'Owner Agent');assert.equal(profile.strategy,'cooperative');assert.equal(pool.profiles().length,20);
 }finally{await rm(directory,{recursive:true,force:true});}
});
