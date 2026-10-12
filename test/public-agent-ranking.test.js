import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPublicAgents } from '../service/public-agent-ranking.js';

const candidate = (agent_id, overrides = {}) => ({
  agent_id,
  source: 'canonical_public',
  public_matches: 20,
  recent_performance_bps: 5_000,
  cross_game_performance_bps: 5_000,
  survival_placement_bps: 5_000,
  research_progress_bps: 5_000,
  reliability_bps: 9_000,
  activity_bps: 5_000,
  ...overrides,
});

test('public ranking combines several canonical metrics with deterministic ties', () => {
  const result = rankPublicAgents([
    candidate('steady', { recent_performance_bps: 6_000, cross_game_performance_bps: 7_000 }),
    candidate('flashy', { recent_performance_bps: 10_000, reliability_bps: 2_000 }),
    candidate('alpha'),
    candidate('beta'),
  ]);
  assert.deepEqual(result.map(entry => entry.agent_id), ['steady', 'alpha', 'beta', 'flashy']);
  assert.equal(result[0].eligible, true);
  assert.equal(result[3].eligible, false);
  assert.equal(result[1].score_bps, result[2].score_bps);
  assert.deepEqual(result.map(entry => entry.rank), [1, 2, 3, 4]);
});

test('private experiment metrics cannot enter the public ranking', () => {
  assert.throws(
    () => rankPublicAgents([candidate('private-run', { source: 'private_experiment' })]),
    /canonical public metrics only/,
  );
});

test('ranking validates IDs, metric bounds, uniqueness and policy', () => {
  assert.throws(() => rankPublicAgents([]), /1-1000/);
  assert.throws(() => rankPublicAgents([candidate('../agent')]), /valid agent_id/);
  assert.throws(() => rankPublicAgents([candidate('same'), candidate('same')]), /unique/);
  assert.throws(() => rankPublicAgents([candidate('overflow', { activity_bps: 10_001 })]), /activity_bps/);
  assert.throws(() => rankPublicAgents([candidate('agent')], {
    minimum_public_matches: 0,
    minimum_reliability_bps: 0,
    weights: Object.fromEntries([
      'recent_performance_bps', 'cross_game_performance_bps', 'survival_placement_bps',
      'research_progress_bps', 'reliability_bps', 'activity_bps',
    ].map(metric => [metric, 0])),
  }), /At least one/);
});
