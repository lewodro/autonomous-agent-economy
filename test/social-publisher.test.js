import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualSocialPublisher } from '../service/social-publisher.js';

const draft = (overrides = {}) => ({
  proposal_id: 'post-1',
  agent_id: 'agent-alpha',
  platform: 'x',
  text: 'I placed second in the canonical Survival match.',
  source_match_ids: ['survival-42'],
  rationale_summary: 'Summarizes one recorded public result.',
  authorship: 'agent',
  ...overrides,
});

test('manual publisher requires approval and records disclosed provenance', () => {
  let tick = 0;
  const publisher = new ManualSocialPublisher({ now: () => `2026-10-11T00:00:0${tick++}.000Z` });
  const created = publisher.createDraft(draft());
  assert.equal(created.status, 'draft');
  assert.equal(created.authorship, 'agent');
  assert.throws(() => publisher.publishApprovedDraft('post-1', { receipt_id: 'x-1' }), /draft to published/);
  const approved = publisher.approveDraft('post-1', { approved_by: 'operator-1' });
  assert.equal(approved.status, 'approved');
  const published = publisher.publishApprovedDraft('post-1', {
    receipt_id: 'x-1',
    public_url: 'https://example.social/posts/x-1',
  });
  assert.equal(published.status, 'published');
  assert.equal(published.publication_receipt.adapter, 'manual');
  assert.equal(publisher.publishApprovedDraft('post-1', { receipt_id: 'ignored' }).publication_receipt.receipt_id, 'x-1');
});

test('rejected proposals cannot later be approved or published', () => {
  const publisher = new ManualSocialPublisher();
  publisher.createDraft(draft());
  assert.equal(publisher.rejectDraft('post-1', { rejected_by: 'operator-1' }).status, 'rejected');
  assert.equal(publisher.rejectDraft('post-1', { rejected_by: 'operator-1' }).status, 'rejected');
  assert.throws(() => publisher.approveDraft('post-1', { approved_by: 'operator-1' }), /rejected to approved/);
  assert.throws(() => publisher.publishApprovedDraft('post-1', { receipt_id: 'x-1' }), /rejected to published/);
});

test('proposal validation bounds text, sources, identities and publication URLs', () => {
  const publisher = new ManualSocialPublisher();
  assert.throws(() => publisher.createDraft(draft({ proposal_id: '../post' })), /proposal_id/);
  assert.throws(() => publisher.createDraft(draft({ source_match_ids: [] })), /1-20/);
  assert.throws(() => publisher.createDraft(draft({ source_match_ids: ['match', 'match'] })), /unique/);
  assert.throws(() => publisher.createDraft(draft({ text: 'x'.repeat(2_001) })), /1-2000/);
  publisher.createDraft(draft());
  publisher.approveDraft('post-1', { approved_by: 'operator' });
  assert.throws(() => publisher.publishApprovedDraft('post-1', { receipt_id: 'receipt', public_url: 'http://example.com/post' }), /HTTPS/);
});
