import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ReplayArchive} from '../service/replay-archive.js';

test('public replay archive bounds count and reads without following arbitrary IDs',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'aae-replay-'));
  const archive=new ReplayArchive(directory,{maxRecords:2,maxBytes:100_000,maxReplayBytes:10_000});
  const replay=i=>({match_id:`seat-${i.toString(16).padStart(64,'0')}`,events:[],final_state:{ended:true}});
  try{
    await archive.save(replay(1));await archive.save(replay(2));await archive.save(replay(3));
    assert.equal(await archive.load(replay(1).match_id),null);
    assert.equal((await archive.load(replay(3).match_id)).match_id,replay(3).match_id);
    assert.throws(()=>archive.file('../secrets'));
    await assert.rejects(archive.save({...replay(4),events:[{reason:'x'.repeat(20_000)}]}),{status:413});
  }finally{await rm(directory,{recursive:true,force:true});}
});
