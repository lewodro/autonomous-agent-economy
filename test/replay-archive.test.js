import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ReplayArchive} from '../service/replay-archive.js';

const matchId=`seat-${'a'.repeat(64)}`;
const replay={match_id:matchId,final_state:{ended:true,winner:'agent-a'},events:[{seq:1,type:'MatchEnded'}]};

test('completed replay archives survive reopening and reject invalid identifiers',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'replay-archive-'));
  try{
    const archive=new ReplayArchive(directory);
    await archive.save(replay);
    assert.deepEqual(await new ReplayArchive(directory).load(matchId),replay);
    await assert.rejects(archive.load('../outside'),/Invalid replay match identifier/);
    await assert.rejects(archive.save({...replay,final_state:{ended:false}}),/Only completed/);
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
