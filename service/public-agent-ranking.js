const ID = /^[a-zA-Z0-9_-]{1,96}$/;
const METRICS = Object.freeze([
  'recent_performance_bps',
  'cross_game_performance_bps',
  'survival_placement_bps',
  'research_progress_bps',
  'reliability_bps',
  'activity_bps',
]);

export const DEFAULT_PUBLIC_RANKING_POLICY = Object.freeze({
  minimum_public_matches: 10,
  minimum_reliability_bps: 7_500,
  weights: Object.freeze({
    recent_performance_bps: 25,
    cross_game_performance_bps: 20,
    survival_placement_bps: 15,
    research_progress_bps: 15,
    reliability_bps: 20,
    activity_bps: 5,
  }),
});

function integer(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function validatePolicy(policy = DEFAULT_PUBLIC_RANKING_POLICY) {
  const minimumPublicMatches = integer(policy.minimum_public_matches, 'minimum_public_matches', 0, 1_000_000);
  const minimumReliability = integer(policy.minimum_reliability_bps, 'minimum_reliability_bps', 0, 10_000);
  const weights = {};
  let totalWeight = 0;
  for (const metric of METRICS) {
    const weight = integer(policy.weights?.[metric], `weights.${metric}`, 0, 10_000);
    weights[metric] = weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) throw new TypeError('At least one public ranking weight is required');
  return { minimumPublicMatches, minimumReliability, weights, totalWeight };
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || !ID.test(candidate.agent_id || '')) {
    throw new TypeError('Public ranking candidate requires a valid agent_id');
  }
  if (candidate.source !== 'canonical_public') {
    throw new TypeError('Public ranking accepts canonical public metrics only');
  }
  const metrics = {};
  for (const metric of METRICS) metrics[metric] = integer(candidate[metric], metric, 0, 10_000);
  return {
    agent_id: candidate.agent_id,
    public_matches: integer(candidate.public_matches, 'public_matches', 0, 1_000_000),
    metrics,
  };
}

/**
 * Produces a deterministic public ranking from server-derived canonical metrics.
 * It does not grant credentials, funds, publishing rights, or permanent status.
 */
export function rankPublicAgents(candidates, policy = DEFAULT_PUBLIC_RANKING_POLICY) {
  if (!Array.isArray(candidates) || candidates.length === 0 || candidates.length > 1000) {
    throw new TypeError('Public ranking requires 1-1000 candidates');
  }
  const validatedPolicy = validatePolicy(policy);
  const seen = new Set();
  const ranked = candidates.map(candidate => {
    const value = validateCandidate(candidate);
    if (seen.has(value.agent_id)) throw new TypeError('Public ranking agent IDs must be unique');
    seen.add(value.agent_id);
    const weighted = METRICS.reduce(
      (sum, metric) => sum + value.metrics[metric] * validatedPolicy.weights[metric],
      0,
    );
    const score = Math.floor(weighted / validatedPolicy.totalWeight);
    const eligible = value.public_matches >= validatedPolicy.minimumPublicMatches
      && value.metrics.reliability_bps >= validatedPolicy.minimumReliability;
    return {
      agent_id: value.agent_id,
      score_bps: score,
      eligible,
      public_matches: value.public_matches,
      metrics: value.metrics,
    };
  });
  ranked.sort((left, right) => right.score_bps - left.score_bps
    || right.metrics.reliability_bps - left.metrics.reliability_bps
    || left.agent_id.localeCompare(right.agent_id));
  return ranked.map((entry, index) => ({ rank: index + 1, ...entry }));
}
