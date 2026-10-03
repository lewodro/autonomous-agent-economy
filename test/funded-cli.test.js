import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
test('funded CLI bounds population before allocation, keys or persistent sessions',()=>{
 for(const count of ['0','1','21','18446744073709551615','invalid']){
  const directory=join(tmpdir(),`funded-invalid-${randomUUID()}`);
  const result=spawnSync('rust/target/debug/funded-local-demo',['--mode','mock','--agents',count],{env:{...process.env,ECONOMY_DIR:directory},encoding:'utf8',timeout:3000});
  assert.equal(result.status,1,result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code,'invalid_input');
  assert.equal(existsSync(directory),false);
 }
});
