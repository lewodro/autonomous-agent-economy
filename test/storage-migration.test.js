import test from 'node:test';
import assert from 'node:assert/strict';
import { configureRun } from '../src/config.js';
import { validateState } from '../src/storage.js';

test('verified Arena checkpoints migrate only the known legacy agent sprite paths', async () => {
  const saved = configureRun({ agents: 20, seed: 78123 });
  for (const agent of saved.agents) agent.sprite = agent.sprite.replace('assets/agents/', 'assets/sprites-agent/');

  const restored = await validateState(saved);
  assert.deepEqual(restored.agents.map(agent => agent.sprite), saved.agents.map(agent => agent.sprite.replace('assets/sprites-agent/', 'assets/agents/')));
  assert.deepEqual(restored.events, saved.events);
});

test('checkpoint migration does not permit a legacy sprite path for another agent', async () => {
  const saved = configureRun({ agents: 20, seed: 78123 });
  saved.agents[0].sprite = 'assets/sprites-agent/02-trader.png';
  await assert.rejects(validateState(saved), /Saved agents does not match the verified ledger/);
});

