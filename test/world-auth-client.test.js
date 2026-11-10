import test from 'node:test';
import assert from 'node:assert/strict';
import { clerkFrontendApi } from '../web/dist/world/farm.js';

test('the browser derives Clerk scripts from the linked Frontend API', () => {
  const host = 'last-seat.clerk.accounts.dev';
  const key = `pk_test_${Buffer.from(`${host}$`).toString('base64')}`;
  assert.equal(clerkFrontendApi(key), host);
  assert.equal(clerkFrontendApi('pk_test_not-base64!'), null);
  assert.equal(clerkFrontendApi('sk_test_secret'), null);
});
