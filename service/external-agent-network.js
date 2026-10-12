const ID = /^[a-zA-Z0-9_-]{1,96}$/;
const NETWORK = /^[a-zA-Z0-9_-]{1,40}$/;
const APPROVED_MANIFESTS = new Set(['agent.json', 'AGENT.md']);

export const GITHUB_AGENT_CAPABILITIES = Object.freeze([
  'open_issue',
  'comment_on_issue',
  'post_research_summary',
  'update_agent_log',
  'propose_pull_request',
  'request_contributor_invitation',
]);

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_EXTERNAL_AGENT_REQUEST', status: 400 });
}

function id(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${field} is invalid`);
  return value;
}

function text(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw invalid(`${field} is invalid`);
  return value;
}

function httpsUrl(value, field) {
  if (value === null || value === undefined) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw invalid(`${field} must be HTTPS`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalid(`${field} must be HTTPS`);
  return parsed.toString();
}

export function validateGitHubAgentCapabilities(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > GITHUB_AGENT_CAPABILITIES.length) {
    throw invalid('GitHub agent capabilities are invalid');
  }
  const unique = [...new Set(capabilities)];
  if (unique.length !== capabilities.length || unique.some(value => !GITHUB_AGENT_CAPABILITIES.includes(value))) {
    throw invalid('GitHub agent capability is not approved');
  }
  return unique;
}

/**
 * Manual adapter for a future external-agent network. Every method creates or
 * reads local review records; it never registers, posts, invites, or authenticates remotely.
 */
export class ManualExternalAgentNetworkAdapter {
  constructor({ network, now = () => new Date().toISOString() } = {}) {
    if (typeof network !== 'string' || !NETWORK.test(network)) throw invalid('network is invalid');
    this.network = network;
    this.now = now;
    this.requests = new Map();
    this.interactions = new Map();
  }

  registerProfile({ request_id, agent_id, display_name, disclosed_as_agent, manifest_type, manifest_digest, avatar_url = null }) {
    if (disclosed_as_agent !== true) throw invalid('External profiles must disclose that they are project agents');
    if (!APPROVED_MANIFESTS.has(manifest_type)) throw invalid('Only agent.json or AGENT.md manifests are accepted');
    if (!/^[a-f0-9]{64}$/.test(manifest_digest || '')) throw invalid('manifest_digest must be SHA-256');
    return this.#record(request_id, 'register_profile', {
      agent_id: id(agent_id, 'agent_id'),
      display_name: text(display_name, 'display_name', 80),
      disclosed_as_agent: true,
      manifest_type,
      manifest_digest,
      avatar_url: httpsUrl(avatar_url, 'avatar_url'),
    });
  }

  publishUpdate({ request_id, agent_id, proposal_id }) {
    return this.#record(request_id, 'publish_update', {
      agent_id: id(agent_id, 'agent_id'),
      proposal_id: id(proposal_id, 'proposal_id'),
    });
  }

  inviteAgent({ request_id, inviting_agent_id, invited_manifest_url }) {
    return this.#record(request_id, 'invite_agent', {
      inviting_agent_id: id(inviting_agent_id, 'inviting_agent_id'),
      invited_manifest_url: httpsUrl(invited_manifest_url, 'invited_manifest_url'),
    });
  }

  readInteractions(agentId) {
    id(agentId, 'agent_id');
    return structuredClone(this.interactions.get(agentId) || []);
  }

  /** Operator-only import point for already reviewed, public interaction summaries. */
  recordInteraction({ interaction_id, agent_id, summary, source_url }) {
    const interaction = {
      interaction_id: id(interaction_id, 'interaction_id'),
      agent_id: id(agent_id, 'agent_id'),
      summary: text(summary, 'summary', 500),
      source_url: httpsUrl(source_url, 'source_url'),
      recorded_at: this.now(),
    };
    const values = this.interactions.get(agent_id) || [];
    if (values.some(value => value.interaction_id === interaction_id)) return structuredClone(values.find(value => value.interaction_id === interaction_id));
    if (values.length >= 100) throw invalid('Interaction history limit reached');
    values.push(interaction);
    this.interactions.set(agent_id, values);
    return structuredClone(interaction);
  }

  getRequest(requestId) {
    const request = this.requests.get(id(requestId, 'request_id'));
    if (!request) throw Object.assign(new Error('External-agent request not found'), { code: 'EXTERNAL_AGENT_REQUEST_NOT_FOUND', status: 404 });
    return structuredClone(request);
  }

  #record(requestId, action, payload) {
    id(requestId, 'request_id');
    const existing = this.requests.get(requestId);
    const request = {
      request_id: requestId,
      network: this.network,
      action,
      payload,
      status: 'manual_review_required',
      created_at: this.now(),
    };
    if (existing) {
      if (JSON.stringify(existing.action) !== JSON.stringify(action) || JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
        throw Object.assign(new Error('External-agent request ID conflict'), { code: 'EXTERNAL_AGENT_REQUEST_CONFLICT', status: 409 });
      }
      return structuredClone(existing);
    }
    this.requests.set(requestId, request);
    return structuredClone(request);
  }
}
