// Provider I/O ends at decisions. No adapter owns game state or wallet authority.
export async function decisionsFor(config, observation) {
  if (config.agents.every(a => a.provider === 'mock')) return null; // Rust mock strategy implementation.
  // Mixed populations use Rust-produced defaults, then replace only non-mock decisions.
  return Promise.all(config.agents.filter(a => observation.agents.find(s => s.id === a.id)?.alive).map(async profile => {
    const fallback = reason => ({ agent_id: profile.id, action: 'guard', target: null, reason });
    if (profile.provider === 'recorded') return fallback('Recorded adapter needs an explicitly supplied decision; guard fallback.');
    if (profile.provider === 'mock') return null;
    const endpoint = process.env.AGENT_HTTP_ENDPOINT;
    if (!endpoint) return fallback('HTTP model adapter is not configured; guard fallback (no inference performed).');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.AGENT_HTTP_TOKEN ? { Authorization: `Bearer ${process.env.AGENT_HTTP_TOKEN}` } : {}) },
        body: JSON.stringify({ agent: { id: profile.id, model: profile.model, personality: profile.personality, prompt: profile.prompt }, observation,
          response_schema: { action: ['work', 'challenge', 'guard', 'cooperate'], target: 'agent ID or null', reason: 'brief public explanation' } }), signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text(); if (text.length > 8192) throw new Error('response too large');
      const result = JSON.parse(text);
      if (!['work', 'challenge', 'guard', 'cooperate'].includes(result.action) || typeof result.reason !== 'string' || !result.reason.trim() || result.reason.length > 300 || (result.target !== null && result.target !== undefined && typeof result.target !== 'string')) throw new Error('invalid structured decision');
      return { agent_id: profile.id, action: result.action, target: result.target || null, reason: result.reason };
    } catch { return fallback('Model adapter timed out or returned invalid output; guard fallback.'); }
  }));
}
