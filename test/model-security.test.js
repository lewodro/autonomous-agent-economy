import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpModelAdapter, InferenceBudget } from '../service/model-adapter.js';

test('untrusted profiles cannot choose a credential destination or server secret', async () => {
  const originalFetch = globalThis.fetch;
  const saved = Object.fromEntries(['MODEL_BASE_URL', 'MODEL_API_KEY_ENV', 'OPENAI_API_KEY'].map(k => [k, process.env[k]]));
  delete process.env.MODEL_BASE_URL; delete process.env.MODEL_API_KEY_ENV;
  process.env.OPENAI_API_KEY = 'dummy-test-secret';
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Must not make a request'); };
  try {
    for (const inference of [
      { base_url: 'https://attacker.example/v1' },
      { base_url: 'http://169.254.169.254/latest' },
      { api_key_env: 'OTHER_API_KEY' },
      { base_url: 'https://api.openai.com/v1?redirect=evil' },
    ]) {
      const budget = new InferenceBudget();
      const adapter = new HttpModelAdapter({ id: 'a', provider: 'openai-compatible', model: 'test', inference }, budget);
      await assert.rejects(adapter.decide({ agents: [] }), /approved|Invalid model base/);
      assert.equal(budget.requests, 0);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('approved model requests disable automatic redirects and use the server credential', async () => {
  const originalFetch = globalThis.fetch;
  const saved = Object.fromEntries(['MODEL_BASE_URL', 'MODEL_API_KEY_ENV', 'LOCAL_API_KEY'].map(k => [k, process.env[k]]));
  process.env.MODEL_BASE_URL = 'http://model.test/v1';
  process.env.MODEL_API_KEY_ENV = 'LOCAL_API_KEY';
  process.env.LOCAL_API_KEY = 'dummy-test-key';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://model.test/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer dummy-test-key');
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'work', target: null, reason: 'Earn credits.' }) } }] }));
  };
  try {
    const adapter = new HttpModelAdapter({ id: 'a', provider: 'openai-compatible', model: 'test', prompt: '', personality: '' }, new InferenceBudget());
    assert.equal((await adapter.decide({ agents: [] })).action, 'work');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('invalid inference reservations cannot reduce or corrupt the budget', () => {
  for (const value of [-1, NaN, Infinity, 0.5, '200']) {
    assert.throws(() => new InferenceBudget({ requests: value }), /Invalid inference budget/);
    assert.throws(() => new InferenceBudget({ tokens: value }), /Invalid inference budget/);
    const budget = new InferenceBudget();
    assert.throws(() => budget.reserve('a', { max_requests: 10 }, value), /Invalid inference budget/);
    assert.throws(() => budget.reserve('a', { max_requests: value }, 1), /Invalid inference budget/);
    assert.equal(budget.requests, 0);
    assert.equal(budget.tokens, 0);
  }
  const budget = new InferenceBudget({ requests: 2, tokens: 5 });
  budget.reserve('a', { max_requests: 2 }, 5);
  assert.throws(() => budget.reserve('a', { max_requests: 2 }, 1), /exhausted/);
  assert.equal(budget.requests, 1);
  assert.equal(budget.tokens, 5);
});
