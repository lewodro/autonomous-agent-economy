import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_AGENT_CAPABILITIES,
  ManualExternalAgentNetworkAdapter,
  validateGitHubAgentCapabilities,
} from '../service/external-agent-network.js';

test('manual network adapter creates disclosed review records without remote effects', () => {
  const adapter = new ManualExternalAgentNetworkAdapter({ network: 'moltbook', now: () => '2026-10-11T00:00:00.000Z' });
  const request = adapter.registerProfile({
    request_id: 'register-1',
    agent_id: 'agent-alpha',
    display_name: 'Alpha research agent',
    disclosed_as_agent: true,
    manifest_type: 'agent.json',
    manifest_digest: 'a'.repeat(64),
    avatar_url: 'https://example.com/alpha.png',
  });
  assert.equal(request.status, 'manual_review_required');
  assert.equal(request.network, 'moltbook');
  assert.deepEqual(adapter.getRequest('register-1'), request);
  assert.deepEqual(adapter.registerProfile({
    request_id: 'register-1', agent_id: 'agent-alpha', display_name: 'Alpha research agent',
    disclosed_as_agent: true, manifest_type: 'agent.json', manifest_digest: 'a'.repeat(64),
    avatar_url: 'https://example.com/alpha.png',
  }), request);
});

test('manual network adapter bounds manifests, disclosure, URLs and histories', () => {
  const adapter = new ManualExternalAgentNetworkAdapter({ network: 'external' });
  assert.throws(() => adapter.registerProfile({
    request_id: 'bad', agent_id: 'agent', display_name: 'Agent', disclosed_as_agent: false,
    manifest_type: 'agent.js', manifest_digest: 'a'.repeat(64),
  }), /disclose/);
  assert.throws(() => adapter.inviteAgent({
    request_id: 'invite', inviting_agent_id: 'agent', invited_manifest_url: 'file:///tmp/agent.json',
  }), /HTTPS/);
  adapter.recordInteraction({ interaction_id: 'reply-1', agent_id: 'agent', summary: 'A public reply.', source_url: 'https://example.com/reply/1' });
  assert.equal(adapter.readInteractions('agent').length, 1);
  assert.equal(adapter.readInteractions('agent')[0].summary, 'A public reply.');
});

test('GitHub agent policy allows narrow proposals and rejects administration', () => {
  assert.deepEqual(validateGitHubAgentCapabilities(['open_issue', 'propose_pull_request']), ['open_issue', 'propose_pull_request']);
  assert.ok(GITHUB_AGENT_CAPABILITIES.includes('request_contributor_invitation'));
  assert.throws(() => validateGitHubAgentCapabilities(['delete_repository']), /not approved/);
  assert.throws(() => validateGitHubAgentCapabilities(['merge_pull_request']), /not approved/);
  assert.throws(() => validateGitHubAgentCapabilities(['manage_secrets']), /not approved/);
});
