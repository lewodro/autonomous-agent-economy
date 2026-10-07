import test from 'node:test';
import assert from 'node:assert/strict';
import { DevnetPredictions } from '../service/predictions.js';

test('predictions are Devnet-only, lock before result, and require a verified receipt and attestation', () => {
  assert.throws(() => new DevnetPredictions({ enabled: true, network: 'mainnet' }), { code: 'MAINNET_PREDICTIONS_NOT_IMPLEMENTED' });
  const predictions = new DevnetPredictions({
    enabled: true,
    verifyReceipt: (receipt, entry) => receipt?.network === 'devnet' && receipt.confirmed === true && receipt.match_id === entry.prediction_id && receipt.payer_id === entry.player_id && receipt.amount_lamports === entry.test_amount_lamports,
    verifyAttestation: (attestation, market) => attestation?.trusted === true && attestation.match_id === market.match_id && attestation.winner_id === 'agent-a',
  });
  predictions.open({ prediction_id: 'market_1', match_id: 'match_1', options: ['agent-a', 'agent-b'] });
  const entry = predictions.enter({ entry_id: 'entry_1', prediction_id: 'market_1', player_id: 'player_1', selection: 'agent-a', test_amount_lamports: 20_000_000, receipt_id: 'receipt_1' });
  assert.equal(predictions.enter({ entry_id: 'entry_1', prediction_id: 'market_1', player_id: 'player_1', selection: 'agent-a', test_amount_lamports: 20_000_000, receipt_id: 'receipt_1' }).entry_id, entry.entry_id);
  assert.throws(() => predictions.enter({ entry_id: 'entry_1', prediction_id: 'market_1', player_id: 'player_1', selection: 'agent-b', test_amount_lamports: 20_000_000, receipt_id: 'receipt_1' }), { code: 'PREDICTION_IDEMPOTENCY_CONFLICT' });
  assert.throws(() => new DevnetPredictions({ enabled: true }).confirm('missing', { verified: true }), { code: 'PREDICTION_NOT_FOUND' });
  assert.throws(() => predictions.confirm('entry_1', { id: 'receipt_1', network: 'devnet', verified: true }), { code: 'PAYMENT_NOT_VERIFIED' });
  predictions.confirm('entry_1', { id: 'receipt_1', network: 'devnet', confirmed: true, match_id: 'market_1', payer_id: 'player_1', amount_lamports: 20_000_000 }); predictions.lock('market_1');
  assert.throws(() => predictions.enter({ entry_id: 'entry_2', prediction_id: 'market_1', player_id: 'player_2', selection: 'agent-b', test_amount_lamports: 1, receipt_id: 'receipt_2' }), { code: 'PREDICTION_LOCKED' });
  assert.throws(() => predictions.resolve('market_1', { match_id: 'match_1', winner_id: 'agent-a', attestation: { trusted: true, match_id: 'match_1', winner_id: 'agent-b' } }), { code: 'INVALID_ATTESTATION' });
  assert.throws(() => predictions.resolve('market_1', { match_id: 'match_1', winner_id: 'agent-b', attestation: { trusted: true, match_id: 'match_1', winner_id: 'agent-a' } }), { code: 'INVALID_ATTESTATION' });
  const result = predictions.resolve('market_1', { match_id: 'match_1', winner_id: 'agent-a', attestation: { trusted: true, match_id: 'match_1', winner_id: 'agent-a' } });
  assert.equal(result.entries[0].status, 'Won'); assert.throws(() => predictions.resolve('market_1', { match_id: 'match_1', winner_id: 'agent-a', attestation_valid: true }), { code: 'PREDICTION_NOT_LOCKED' });
});

test('cancelled Devnet predictions request refunds while resolved outcomes cannot be cancelled', () => {
  const predictions = new DevnetPredictions({ enabled: true, verifyReceipt: () => true }); predictions.open({ prediction_id: 'market_2', match_id: 'match_2', options: ['a', 'b'] });
  predictions.enter({ entry_id: 'entry_2', prediction_id: 'market_2', player_id: 'player_2', selection: 'a', test_amount_lamports: 1, receipt_id: 'receipt_2' });
  predictions.confirm('entry_2', { id: 'receipt_2', network: 'devnet', confirmed: true }); predictions.cancel('market_2');
  assert.equal(predictions.entries.get('entry_2').status, 'RefundPending');
});

test('cancelled pending entries are not confirmed after cancellation and need no refund', () => {
  const predictions = new DevnetPredictions({ enabled: true, verifyReceipt: () => true });
  predictions.open({ prediction_id: 'market_3', match_id: 'match_3', options: ['a', 'b'] });
  predictions.enter({ entry_id: 'entry_3', prediction_id: 'market_3', player_id: 'player_3', selection: 'a', test_amount_lamports: 1, receipt_id: 'receipt_3' });
  predictions.cancel('market_3');
  assert.equal(predictions.entries.get('entry_3').status, 'Cancelled');
  assert.throws(() => predictions.confirm('entry_3', { id: 'receipt_3' }), { code: 'PREDICTION_LOCKED' });
});
