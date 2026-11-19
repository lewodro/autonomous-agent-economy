import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorldFarm } from '../service/world-farm.js';
import { WorldStore } from '../service/world-store.js';
import { WorldEconomy, RESOURCE_NODES } from '../service/world-economy.js';

const RUN = 'cave-11111111-1111-4111-8111-111111111111';
const identity = { key: 'guest:visitor-a', provider: 'guest' };
const wallet = '11111111111111111111111111111111';

test('cave defeat zeroes internal farm credits once with a cave_defeat ledger event', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-cave-farm-'));
  const store = new WorldStore({ directory });
  await store.open();
  const farm = new WorldFarm(store, { now: () => 10_000 });
  try {
    await farm.restore();
    farm.account(identity);
    farm.state.accounts[identity.key].credits = 19;
    const first = await farm.forfeitCredits(identity, { reason: 'cave_defeat', request_id: RUN });
    assert.deepEqual({ lost: first.lost_credits, credits: first.credits }, { lost: 19, credits: 0 });
    const events = farm.view(identity).ledger.filter(event => event.type === 'cave_defeat');
    assert.equal(events.length, 1);
    assert.equal(events[0].details.run_id, RUN);
    const second = await farm.forfeitCredits(identity, { reason: 'cave_defeat', request_id: RUN });
    assert.equal(second.credits, 0, 'a repeated settlement replays the settled state');
    assert.equal(farm.view(identity).ledger.filter(event => event.type === 'cave_defeat').length, 1);
    await assert.rejects(() => farm.forfeitCredits(identity, { reason: 'payout', request_id: RUN }), { code: 'INVALID_REASON' });
  } finally {
    await farm.close(); await store.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('cave defeat and rewards use internal test-credit receipts, never wallet or treasury state', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-cave-economy-'));
  const economy = new WorldEconomy(directory, { now: () => 10_000, treasuryAddress: wallet, payoutsEnabled: true, lamportsPerCredit: 25 });
  try {
    await economy.restore();
    const node = RESOURCE_NODES[0];
    await economy.gather('visitor-a', { node_id: node.id }, node.position);
    const before = economy.snapshot('visitor-a');
    assert.ok(before.profile.credits > 0);
    assert.equal(before.treasury.payouts_enabled, true);
    const reward = await economy.awardCave('visitor-a', { run_id: RUN, monster_id: 'warden', amount: 10 });
    assert.equal(reward.reward.source_action, 'cave:monster');
    assert.equal(reward.credits, before.profile.credits + 10);
    const duplicate = await economy.awardCave('visitor-a', { run_id: RUN, monster_id: 'warden', amount: 10 });
    assert.equal(duplicate.already_awarded, true);
    assert.equal(economy.snapshot('visitor-a').profile.credits, before.profile.credits + 10);
    await assert.rejects(() => economy.awardCave('visitor-a', { run_id: RUN, monster_id: 'warden', amount: 999 }), { code: 'INVALID_CAVE_REWARD' });
    const defeat = await economy.forfeitCredits('visitor-a', { run_id: RUN });
    assert.equal(defeat.lost_credits, before.profile.credits + 10);
    assert.equal(economy.snapshot('visitor-a').profile.credits, 0);
    const receipt = economy.snapshot('visitor-a').receipts.find(item => item.source_action === 'cave_defeat');
    assert.equal(receipt.status, 'test_debited');
    assert.equal('wallet_address' in receipt, false);
    assert.equal('amount_lamports' in receipt, false);
    assert.equal('treasury_address' in receipt, false);
    const repeated = await economy.forfeitCredits('visitor-a', { run_id: RUN });
    assert.equal(repeated.already_settled, true);
    assert.equal(economy.snapshot('visitor-a').treasury.public_address, wallet, 'treasury configuration is untouched');
  } finally {
    await economy.close(); await rm(directory, { recursive: true, force: true });
  }
});
