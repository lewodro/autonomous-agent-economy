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
