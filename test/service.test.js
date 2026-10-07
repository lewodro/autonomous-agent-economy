import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import nodePath from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('service reclaims completed sessions while preserving their replay and spectator URL', {
  skip: !existsSync(new URL('../rust/target/debug/table-core', import.meta.url)) && 'Build the Rust worker to run service integration tests',
  timeout: 20000,
}, async () => {
  const matchesDir=await mkdtemp(os.tmpdir()+'/last-seat-service-');
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '0', MATCHES_DIR: matchesDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => stderr += chunk);
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Service startup timed out: ${stderr}`)), 5000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Service stopped: ${stderr}`)); });
      child.stdout.on('data', chunk => {
        const port = chunk.toString().match(/http:\/\/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
      });
    });
    const post = async (path, body) => {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    for(const value of [null,[],"text",7]){
      const invalidBody=await post('/api/matches',value);
      assert.equal(invalidBody.status,400);
      assert.equal(invalidBody.data.code,'INVALID_BODY');
      assert.equal(invalidBody.data.error,'Request body must be a JSON object');
    }
    const config = await fetch(base + '/api/config?agents=2').then(r => r.json());
    const invalid = await post('/api/matches', { config: { ...config, max_turns: 0 } });
    assert.equal(invalid.status, 400);
    config.max_turns = 1;
    const started = await post('/api/matches', { config });
    assert.equal(started.status, 201);
    const path = `/api/matches/${started.data.session}/step`;
    const firstStep=await post(path, {});
    assert.equal(firstStep.status, 200);
    const ended = await post(path, {});
    assert.equal(ended.status, 400);
    assert.match(ended.data.error, /already ended/);
    const oversized = await fetch(base + '/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(1_000_001) });
    assert.equal(oversized.status, 413);
    await oversized.json();
    const largeImport = await fetch(base + '/api/replays/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(8_100_000) + JSON.stringify({ replay: firstStep.data.replay }) });
    assert.equal(largeImport.status, 200);
    await largeImport.json();
    const responses = await Promise.all(Array.from({ length: 105 }, (_, i) => i % 21 === 0
      ? post('/api/replays/import', { replay: firstStep.data.replay })
      : post('/api/matches', { config })));
    assert.equal(responses.filter(r => r.status === 201 || r.status === 200).length, 105,JSON.stringify(responses.filter(r=>r.status>=300)));
    assert.equal(responses.filter(r => r.status >= 300).length, 0,JSON.stringify(responses.filter(r=>r.status>=300)));
    const limitedImport=await post('/api/replays/import',{replay:firstStep.data.replay});assert.equal(limitedImport.status,429);assert.equal(limitedImport.data.code,'RATE_LIMITED');
    const archived = await fetch(base + `/api/matches/${started.data.session}`).then(r => r.json());
    assert.equal(archived.replay.match_id, firstStep.data.replay.match_id);
    const replayResponse=await fetch(base+`/api/replays/${firstStep.data.replay.match_id}`);
    assert.equal(replayResponse.status,200);
    assert.equal((await replayResponse.json()).replay.match_id,firstStep.data.replay.match_id);
    const snapshot = await fetch(base + `/api/matches/${started.data.session}/events`).then(r => r.text());
    assert.match(snapshot, /event: snapshot/);
    assert.match(snapshot, new RegExp(firstStep.data.replay.match_id));
    const noAdvance = await post(`/api/matches/${started.data.session}/step`, {});
    assert.equal(noAdvance.status, 410);
    let capacityResponse;
    for(let i=0;i<100;i++){
      capacityResponse=await post('/api/matches',{config});
      if(capacityResponse.status===429)break;
      assert.equal(capacityResponse.status,201);
    }
    assert.equal(capacityResponse.status,429);
    assert.equal(capacityResponse.data.code,'SESSION_CAPACITY');
    assert.equal((await fetch(base+'/api/games/ongoing').then(r=>r.json())).games.length,20,'ongoing-game directory intentionally returns its latest twenty games');
    await writeFile(nodePath.join(matchesDir,`${firstStep.data.replay.match_id}.json`),' '.repeat(32_000_001),{mode:0o600});
    for(const url of [`/api/replays/${firstStep.data.replay.match_id}`,`/api/matches/${started.data.session}`]){
      const response=await fetch(base+url),data=await response.json();
      assert.equal(response.status,503,url);
      assert.equal(data.code,'PERSISTED_JSON_TOO_LARGE',url);
    }
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
});
