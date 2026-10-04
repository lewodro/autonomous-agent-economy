import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Core } from '../service/core.js';

function fixture() {
  const worker = new EventEmitter();
  worker.stdin = new PassThrough();
  worker.stdout = new PassThrough();
  worker.kill = () => worker.emit('exit', 0);
  return { core: new Core({ worker }), worker };
}

test('unserializable requests cannot consume the next worker response', async () => {
  const { core, worker } = fixture();
  try {
    const input = {}; input.self = input;
    await assert.rejects(core.request(input), /circular/i);
    const next = core.request({ command: 'defaults' });
    worker.stdout.write(JSON.stringify({ ok: true, result: { seed: 42 } }) + '\n');
    assert.deepEqual(await next, { seed: 42 });
    assert.equal(core.pending.length, 0);
  } finally { core.stop(); }
});

test('worker pipe failures reject every pending request and future requests', async () => {
  const { core, worker } = fixture();
  const first = assert.rejects(core.request({ command: 'get' }), /pipe closed/);
  const second = assert.rejects(core.request({ command: 'observe' }), /pipe closed/);
  worker.stdin.emit('error', new Error('pipe closed'));
  await Promise.all([first, second]);
  await assert.rejects(core.request({ command: 'get' }), /unavailable/);
  core.stop();
});
test('malformed worker envelopes cannot masquerade as successful responses',async()=>{
 for(const value of [{ok:'false',result:{}},{ok:true},{ok:false},{ok:true,result:{},error:'contradiction'},null]){
  const {core,worker}=fixture();
  try{const pending=assert.rejects(core.request({command:'get'}),/protocol/i);worker.stdout.write(JSON.stringify(value)+'\n');await pending;await assert.rejects(core.request({command:'get'}),/unavailable/);}finally{core.stop();}
 }
});
test('worker stdout EOF rejects every pending request instead of hanging',async()=>{
 const {core,worker}=fixture();
 const first=assert.rejects(core.request({command:'get'}),/response stream closed/);
 const second=assert.rejects(core.request({command:'observe'}),/response stream closed/);
 worker.stdout.end();await Promise.all([first,second]);await assert.rejects(core.request({command:'get'}),/unavailable/);core.stop();
});
test('ordinary typed worker errors preserve the next request and its response',async()=>{
 const {core,worker}=fixture();try{
  const failed=assert.rejects(core.request({command:'get'}),error=>error.code==='funding_closed');
  worker.stdout.write(JSON.stringify({ok:false,error:'{"code":"funding_closed"}'})+'\n');await failed;
  const next=core.request({command:'defaults'});worker.stdout.write(JSON.stringify({ok:true,result:{seed:42}})+'\n');assert.deepEqual(await next,{seed:42});
 }finally{core.stop();}
});
