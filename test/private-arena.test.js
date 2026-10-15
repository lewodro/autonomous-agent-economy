import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Core } from '../service/core.js';
import { PrivateArenaManager } from '../service/private-arena.js';

const ownerA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('private arena instances are owner-isolated and start fresh autonomous modes', { timeout: 15000 }, async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'private-arena-'));
  const core=new Core(),manager=new PrivateArenaManager(core,directory,{maxInstances:4,maxActive:2});
  try {
    const first=await manager.view(ownerA),second=await manager.view(ownerB);
    assert.equal(first.started,false);assert.equal(second.started,false);
    assert.equal(first.rooms.length,4);assert.equal(first.survival.agents.length,20);assert.equal(first.history.length,0);
    assert.equal(second.history.length,0);
    const started=await manager.start(ownerA);
    assert.equal(started.started,true);assert.equal((await manager.view(ownerB)).started,false);
    const exported=await manager.export(ownerA);
    assert.equal(exported.mode,'private-arena-simulation');assert.equal(exported.history.length,0);
  } finally { await manager.close();core.stop();await rm(directory,{recursive:true,force:true}); }
});
