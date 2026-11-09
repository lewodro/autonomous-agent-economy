import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DurableStateDatabase } from '../service/durable-state.js';

class MemoryPool {
  constructor(){this.rows=new Map();}
  async query(sql,params=[]){
    if(sql.startsWith('create table'))return{rows:[]};
    const key=params.length>=2?`${params[0]}:${params[1]}`:null;
    if(sql.startsWith('select state'))return{rows:this.rows.has(key)?[{state:structuredClone(this.rows.get(key))}]:[]};
    if(sql.startsWith('insert into')){if(sql.includes('do nothing')&&this.rows.has(key))return{rows:[]};this.rows.set(key,JSON.parse(params[2]));return{rows:[]};}
    if(sql.startsWith('delete from')){this.rows.delete(key);return{rows:[]};}
    if(sql.startsWith('select record_id')){
      const prefix=`${params[0]}:`;
      return{rows:[...this.rows.entries()].filter(([value])=>value.startsWith(prefix)).sort().slice(0,params[1]).map(([value,state])=>({record_id:value.slice(prefix.length),state:structuredClone(state)}))};
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

test('durable collections survive reopen without mixing namespaces',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'durable-state-'));
  try{
    const first=new DurableStateDatabase({directory});await first.open();
    await first.collection('arena').put('run-1',{winner:'agent-1'});
    await first.collection('compound').put('run-1',{winner:'agent-2'});
    await first.close();
    const second=new DurableStateDatabase({directory});await second.open();
    assert.deepEqual(await second.collection('arena').get('run-1'),{winner:'agent-1'});
    assert.deepEqual(await second.collection('compound').get('run-1'),{winner:'agent-2'});
    await second.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('legacy JSON import is idempotent and never overwrites a Postgres record',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'durable-import-')),legacy=path.join(directory,'legacy');
  try{
    await mkdir(legacy,{recursive:true});
    await writeFile(path.join(legacy,'run-1.json'),JSON.stringify({source:'legacy'}));
    const pool=new MemoryPool(),database=new DurableStateDatabase({directory,pool});await database.open();
    const collection=database.collection('arena',{directory:legacy,legacyIdPattern:/^run-[0-9]+$/});
    assert.deepEqual(await collection.get('run-1'),{source:'legacy'});
    await collection.put('run-1',{source:'postgres'});
    await writeFile(path.join(legacy,'run-1.json'),JSON.stringify({source:'changed-legacy'}));
    await collection.entries();
    assert.deepEqual(await collection.get('run-1'),{source:'postgres'});
    await database.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});
