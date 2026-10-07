import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,writeFile,utimes} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ReplayArchive} from '../service/replay-archive.js';

const matchId=`seat-${'a'.repeat(64)}`;
const replay={match_id:matchId,final_state:{ended:true,winner:'agent-a'},events:[{seq:1,type:'MatchEnded'}]};

test('verified replay archives survive reopening and reject invalid identifiers',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-'));
  try{
    const archive=new ReplayArchive(directory);
    await archive.save(replay);
    assert.deepEqual(await new ReplayArchive(directory).load(matchId),replay);
    await assert.rejects(archive.load('../outside'),/Invalid replay match identifier/);
    const prefix={...replay,final_state:{ended:false,winner:null},events:replay.events.slice(0,1)};
    await archive.save(prefix);
    assert.deepEqual(await new ReplayArchive(directory).load(matchId),prefix);
    await assert.rejects(archive.save({...replay,events:'not-an-event-list'}),/Invalid replay archive record/);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('replay archive sync failure keeps the renamed result recoverable and removes temp files',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-sync-'));
  try{
    const archive=new ReplayArchive(directory,{syncFolder:async()=>{throw Object.assign(new Error('disk sync failure'),{code:'EIO'});}});
    await assert.rejects(archive.save(replay),error=>error.status===503&&error.code==='EIO');
    assert.deepEqual(await readdir(directory),[`${matchId}.json`]);
    assert.deepEqual(await new ReplayArchive(directory).load(matchId),replay);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('replay archive retains only the newest bounded set of records',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-retention-'));
  try{
    const archive=new ReplayArchive(directory,{maxRecords:2});
    const records=['a','b','c'].map((letter,index)=>({match_id:`seat-${letter.repeat(64)}`,final_state:{ended:true,winner:`agent-${index}`},events:[{seq:index+1,type:'MatchEnded'}]}));
    for(const record of records)await archive.save(record);
    const names=(await readdir(directory)).filter(name=>name.endsWith('.json')).sort();
    assert.deepEqual(names,[`${records[1].match_id}.json`,`${records[2].match_id}.json`].sort());
    assert.equal(await archive.load(records[0].match_id),null);
    assert.deepEqual(await archive.load(records[2].match_id),records[2]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('concurrent archive saves serialize capacity enforcement',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-concurrent-'));
  try{
    const archive=new ReplayArchive(directory,{maxRecords:2});
    const records=Array.from({length:8},(_,index)=>({match_id:`seat-${index.toString(16).padStart(64,'0')}`,final_state:{ended:true,winner:`agent-${index}`},events:[{seq:index+1,type:'MatchEnded'}]}));
    await Promise.all(records.map(record=>archive.save(record)));
    assert.equal((await readdir(directory)).filter(name=>name.endsWith('.json')).length,2);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('startup reconciliation restores replay retention after a crash before pruning',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-recovery-'));
  try{
    const archive=new ReplayArchive(directory,{maxRecords:2});
    const records=['a','b','c'].map((letter,index)=>({match_id:`seat-${letter.repeat(64)}`,final_state:{ended:true,winner:`agent-${index}`},events:[{seq:index+1,type:'MatchEnded'}]}));
    for(let index=0;index<records.length;index++){
      const file=archive.file(records[index].match_id);
      await writeFile(file,JSON.stringify(records[index]));
      const time=new Date(1_700_000_000_000+index*1000);await utimes(file,time,time);
    }
    await new ReplayArchive(directory,{maxRecords:2}).reconcile();
    assert.equal((await readdir(directory)).filter(name=>name.endsWith('.json')).length,2);
    assert.equal(await archive.load(records[0].match_id),null);
    assert.deepEqual(await archive.load(records[2].match_id),records[2]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('replay archive rejects records larger than its configured and engine limits',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-size-'));
  try{
    const archive=new ReplayArchive(directory,{maxReplayBytes:128});
    const oversized={...replay,events:[{seq:1,type:'MatchEnded',padding:'x'.repeat(256)}]};
    await assert.rejects(archive.save(oversized),{status:413,code:'REPLAY_TOO_LARGE'});
    assert.deepEqual(await readdir(directory),[]);
  }finally{await rm(directory,{recursive:true,force:true});}
});
