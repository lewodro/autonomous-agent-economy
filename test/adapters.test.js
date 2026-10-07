import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionsFor } from '../service/adapters.js';

const config = { agents: [{ id: 'agent-1', provider: 'http', model: 'test', personality: '', prompt: '' }] };
const observation = { agents: [{ id: 'agent-1', alive: true }] };
async function withResponse(response, callback) {
  const priorFetch = globalThis.fetch, priorEndpoint = process.env.AGENT_HTTP_ENDPOINT;
  globalThis.fetch = async () => response;
  process.env.AGENT_HTTP_ENDPOINT = 'http://adapter.test';
  try { await callback(); }
  finally {
    globalThis.fetch = priorFetch;
    if (priorEndpoint === undefined) delete process.env.AGENT_HTTP_ENDPOINT;
    else process.env.AGENT_HTTP_ENDPOINT = priorEndpoint;
  }
}

test('oversized streamed decisions are canceled before the entire body is buffered', async () => {
  let pulls = 0, canceled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024)); },
    cancel() { canceled = true; },
  }));
  await withResponse(response, async () => {
    const [decision] = await decisionsFor(config, observation);
    assert.equal(decision.action, 'guard');
    assert.match(decision.reason, /invalid output/);
    assert.equal(canceled, true);
    assert.ok(pulls <= 10);
  });
});

test('valid decisions handle split UTF-8 model text without exposing it publicly', async () => {
  const result = { action: 'work', target: null, reason: 'private thoughts 🌱' };
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  let offset = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, ++offset));
    },
  }));
  await withResponse(response, async () => {
    const [decision] = await decisionsFor(config, observation);
    assert.equal(decision.action,'work','the JSON response was decoded despite a split multibyte character');
    assert.equal(decision.reason,'Worked to earn credits.');
    assert.doesNotMatch(decision.reason,/private thoughts/);
  });
});
