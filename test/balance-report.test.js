import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const run=args=>spawnSync('rust/target/debug/balance-report',args,{encoding:'utf8',timeout:10000});
test('balance report rejects empty or overflowing seed ranges and malformed inputs',()=>{
 for(const args of [['0'],['nonsense'],['1','last-seat-v5','0'],['2','last-seat-v5','4294967295'],['1','last-seat-v5','1','21']]){
  const result=run(args);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(result.stderr.length>0);
 }
});
test('balance report supports the maximum seed and configurable cohorts without non-finite metrics',()=>{
 const result=run(['1','last-seat-v5','4294967295','2']);assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(result.stdout);assert.equal(report.seeds,'4294967295..=4294967295');assert.equal(report.seats,2);
 assert.equal(Object.values(report.wins).reduce((a,b)=>a+b,0)+report.draws,report.matches);
 assert.ok(Number.isFinite(report.mean_elimination_turn));assert.ok(report.mean_turns>0);
});
