const ID = /^[a-zA-Z0-9_-]{1,96}$/;
const PLATFORM = /^[a-zA-Z0-9_-]{1,40}$/;
const AUTHORSHIP = new Set(['agent', 'human', 'agent_with_human_edits']);
export const POST_STATUSES = Object.freeze(['draft', 'approved', 'published', 'rejected']);

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_POST_PROPOSAL', status: 400 });
}

function identifier(value, field, pattern = ID) {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid(`${field} is invalid`);
  return value;
}

function boundedText(value, field, maximum) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw invalid(`${field} must contain 1-${maximum} characters`);
  }
  return value;
}

function sourceMatches(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
    throw invalid('source_match_ids must contain 1-20 canonical public match IDs');
  }
  const result = values.map(value => identifier(value, 'source_match_id'));
  if (new Set(result).size !== result.length) throw invalid('source_match_ids must be unique');
  return result;
}

/**
 * Manual-first SocialPublisher. It stores proposals and approval evidence but
 * never calls a social network or receives platform credentials.
 */
export class ManualSocialPublisher {
  constructor({ now = () => new Date().toISOString() } = {}) {
    this.now = now;
    this.proposals = new Map();
  }

  createDraft({ proposal_id, agent_id, platform, text, source_match_ids, rationale_summary, authorship = 'agent' }) {
    identifier(proposal_id, 'proposal_id');
    if (this.proposals.has(proposal_id)) throw Object.assign(new Error('Post proposal already exists'), { code: 'POST_PROPOSAL_EXISTS', status: 409 });
    identifier(agent_id, 'agent_id');
    identifier(platform, 'platform', PLATFORM);
    if (!AUTHORSHIP.has(authorship)) throw invalid('authorship is invalid');
    const proposal = {
      proposal_id,
      agent_id,
      platform,
      text: boundedText(text, 'text', 2_000),
      source_match_ids: sourceMatches(source_match_ids),
      rationale_summary: boundedText(rationale_summary, 'rationale_summary', 500),
      authorship,
      created_at: this.now(),
      status: 'draft',
      approved_by: null,
      reviewed_at: null,
      publication_receipt: null,
    };
    this.proposals.set(proposal_id, proposal);
    return structuredClone(proposal);
  }

  approveDraft(proposalId, { approved_by }) {
    const proposal = this.#proposal(proposalId);
    if (proposal.status === 'approved') return structuredClone(proposal);
    if (proposal.status !== 'draft') throw this.#transition(proposal.status, 'approved');
    proposal.status = 'approved';
    proposal.approved_by = identifier(approved_by, 'approved_by');
    proposal.reviewed_at = this.now();
    return structuredClone(proposal);
  }

  rejectDraft(proposalId, { rejected_by }) {
    const proposal = this.#proposal(proposalId);
    if (proposal.status === 'rejected') return structuredClone(proposal);
    if (proposal.status !== 'draft') throw this.#transition(proposal.status, 'rejected');
    proposal.status = 'rejected';
    proposal.approved_by = identifier(rejected_by, 'rejected_by');
    proposal.reviewed_at = this.now();
    return structuredClone(proposal);
  }

  /** Records a human-completed publication. It performs no network request. */
  publishApprovedDraft(proposalId, { receipt_id, public_url = null }) {
    const proposal = this.#proposal(proposalId);
    if (proposal.status === 'published') return structuredClone(proposal);
    if (proposal.status !== 'approved') throw this.#transition(proposal.status, 'published');
    if (public_url !== null) {
      let parsed;
      try { parsed = new URL(public_url); } catch { throw invalid('public_url must be an HTTPS URL'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalid('public_url must be an HTTPS URL');
    }
    proposal.status = 'published';
    proposal.publication_receipt = {
      receipt_id: identifier(receipt_id, 'receipt_id'),
      public_url,
      recorded_at: this.now(),
      adapter: 'manual',
    };
    return structuredClone(proposal);
  }

  getStatus(proposalId) {
    return structuredClone(this.#proposal(proposalId));
  }

  #proposal(id) {
    const proposal = this.proposals.get(identifier(id, 'proposal_id'));
    if (!proposal) throw Object.assign(new Error('Post proposal not found'), { code: 'POST_PROPOSAL_NOT_FOUND', status: 404 });
    return proposal;
  }

  #transition(from, to) {
    return Object.assign(new Error(`Cannot transition post proposal from ${from} to ${to}`), { code: 'INVALID_POST_TRANSITION', status: 409 });
  }
}
