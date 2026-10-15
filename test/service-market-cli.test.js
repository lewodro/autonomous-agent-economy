import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('service-market CLI runs without a storage argument using disposable state', async () => {
  const binary = path.resolve('rust/target/debug/service-market-demo');
  await access(binary);
  const run = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.mode, 'SIMULATED');
  assert.equal(result.real_revenue, false);
  assert.equal(result.verified_jobs.agent_alpha, 1);
  assert.equal(result.mock_units_earned.agent_alpha, '12');
});
