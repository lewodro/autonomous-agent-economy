import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {reduceEconomy} from '../web/dist/economy.js';
const binary='rust/target/debug/economy-demo';
test('Rust economy stream projects exactly in TypeScript for free and funded examples',()=>{
 for(const name of ['free','mock-0.02','mock-0.05']){
  const run=spawnSync(binary,[`examples/economy/${name}.json`],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const demo=JSON.parse(run.stdout);let view=null;
  for(const event of demo.events)view=reduceEconomy(view,event);
  assert.deepEqual(view.match,demo.economy);assert.equal(view.sequence,demo.events.length-1);
  assert.ok(['settled','refunded'].includes(view.match.state));
  assert.equal(demo.events.filter(e=>e.type==='SettlementCompleted').length,1);
  assert.equal(demo.funded_pot,name==='free'?'0':name==='mock-0.02'?'80000000':'200000000');
 }
 const mainnet=spawnSync(binary,['--mainnet'],{encoding:'utf8'});assert.equal(mainnet.status,1);assert.equal(JSON.parse(mainnet.stdout).error.code,'mainnet_not_implemented');
});
async function launch(enabled){
 const directory=await mkdtemp(path.join(os.tmpdir(),'seat-economy-test-'));
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',MATCHES_DIR:directory,ECONOMY_LAB:enabled?'1':'0'},stdio:['ignore','pipe','pipe']});
 let text='';const base=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Startup timeout')),10000);
  child.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Server exited'));});
 });
 return {base,close:async()=>{const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;await rm(directory,{recursive:true,force:true});}};
}
test('lab HTTP route is opt-in and Rust owns funding, winner and idempotent settlement',async()=>{
 const disabled=await launch(false);try{assert.equal((await fetch(disabled.base+'/labs/economy')).status,404);assert.equal((await fetch(disabled.base+'/api/labs/economy',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"reset"}'})).status,404);}finally{await disabled.close();}
 const lab=await launch(true);try{
  assert.equal((await fetch(lab.base+'/labs/economy')).status,200);
  const command=async(action,agent_id)=>{const r=await fetch(lab.base+'/api/labs/economy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,agent_id,winner:'agent-1'})});return {status:r.status,data:await r.json()};};
  assert.equal((await command('settle')).status,400);
  const start=await command('reset');assert.equal(start.status,200);
  for(const id of start.data.economy.required_agents)assert.equal((await command('fund',id)).status,200);
  await command('lock');await command('finish');
  const first=await command('settle');const again=await command('settle');assert.deepEqual(first,again);
  assert.equal(first.data.simulation.winner,'agent-3');assert.equal(first.data.balances['agent-3'],'1060000000');
  assert.equal((await command('refund')).status,400);
 }finally{await lab.close();}
});
