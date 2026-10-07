/**
 * Test-SOL prediction state. It deliberately does not sign, verify, or settle
 * payments: those operations must enter through the established PaymentRail.
 */
export class DevnetPredictions {
  constructor({ enabled = false, network = 'devnet', verifyReceipt = () => false, verifyAttestation = () => false } = {}) {
    if (enabled && network !== 'devnet') throw Object.assign(new Error('Predictions are Devnet-only'), { code: 'MAINNET_PREDICTIONS_NOT_IMPLEMENTED', status: 400 });
    this.enabled = enabled; this.network = network; this.verifyReceipt = verifyReceipt; this.verifyAttestation = verifyAttestation;
    this.markets = new Map(); this.entries = new Map();
  }
  requireEnabled() { if (!this.enabled) throw Object.assign(new Error('Devnet predictions are disabled'), { code: 'PREDICTIONS_DISABLED', status: 404 }); }
  open({ prediction_id, match_id, options }) {
    this.requireEnabled();
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(prediction_id) || !/^[a-zA-Z0-9_-]{1,96}$/.test(match_id) || !Array.isArray(options) || options.length < 2 || options.length > 20 || options.some(option => typeof option !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(option)) || new Set(options).size !== options.length) throw Object.assign(new Error('Invalid prediction market'), { code: 'INVALID_PREDICTION', status: 400 });
    if (this.markets.has(prediction_id)) throw Object.assign(new Error('Prediction already exists'), { code: 'PREDICTION_EXISTS', status: 409 });
    const market = { prediction_id, match_id, network: 'devnet', status: 'Open', options: [...options], opened_at: new Date().toISOString(), locked_at: null, resolved_at: null, winner_id: null };
    this.markets.set(prediction_id, market); return structuredClone(market);
  }
  lock(predictionId) { const market = this.market(predictionId); if (market.status !== 'Open') throw Object.assign(new Error('Predictions are locked'), { code: 'PREDICTION_LOCKED', status: 409 }); market.status = 'Locked'; market.locked_at = new Date().toISOString(); return structuredClone(market); }
  enter({ entry_id, prediction_id, player_id, selection, test_amount_lamports, receipt_id }) {
    const market = this.market(prediction_id); if (market.status !== 'Open') throw Object.assign(new Error('Predictions are locked'), { code: 'PREDICTION_LOCKED', status: 409 });
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(entry_id) || !/^[a-zA-Z0-9_-]{1,96}$/.test(player_id) || !market.options.includes(selection) || !Number.isSafeInteger(test_amount_lamports) || test_amount_lamports <= 0 || !/^[a-zA-Z0-9_-]{1,160}$/.test(receipt_id || '')) throw Object.assign(new Error('Invalid prediction entry'), { code: 'INVALID_PREDICTION', status: 400 });
    const existing = this.entries.get(entry_id);
    if (existing) {
      const sameRequest = existing.prediction_id === prediction_id && existing.player_id === player_id && existing.selection === selection && existing.test_amount_lamports === test_amount_lamports && existing.receipt_id === receipt_id;
      if (!sameRequest) throw Object.assign(new Error('Prediction entry ID was reused with different payment or selection details'), { code: 'PREDICTION_IDEMPOTENCY_CONFLICT', status: 409 });
      return structuredClone(existing);
    }
    const entry = { entry_id, prediction_id, player_id, selection, test_amount_lamports, receipt_id, status: 'PendingVerification' };
    this.entries.set(entry_id, entry); return structuredClone(entry);
  }
  confirm(entryId, receipt) {
    const entry = this.entries.get(entryId);
    if (!entry) throw Object.assign(new Error('Prediction entry not found'), { code: 'PREDICTION_NOT_FOUND', status: 404 });
    if (entry.status === 'Confirmed') return structuredClone(entry);
    if (entry.status !== 'PendingVerification' || this.market(entry.prediction_id).status !== 'Open') throw Object.assign(new Error('Prediction entry is no longer eligible for confirmation'), { code: 'PREDICTION_LOCKED', status: 409 });
    let verified = false;
    try { verified = receipt?.id === entry.receipt_id && this.verifyReceipt(receipt, structuredClone(entry)) === true; } catch { /* verifier errors fail closed */ }
    if (!verified) throw Object.assign(new Error('Payment receipt is not verified for Devnet'), { code: 'PAYMENT_NOT_VERIFIED', status: 409 });
    entry.status = 'Confirmed'; return structuredClone(entry);
  }
  resolve(predictionId, { match_id, winner_id, attestation }) {
    const market = this.market(predictionId); if (market.status !== 'Locked') throw Object.assign(new Error('Prediction must be locked before resolving'), { code: 'PREDICTION_NOT_LOCKED', status: 409 });
    let verified = false;
    try {
      verified = attestation?.match_id === match_id && attestation?.winner_id === winner_id
        && this.verifyAttestation(attestation, structuredClone(market)) === true;
    } catch { /* verifier errors fail closed */ }
    if (market.match_id !== match_id || !market.options.includes(winner_id) || !verified) throw Object.assign(new Error('Match result is not authoritative'), { code: 'INVALID_ATTESTATION', status: 409 });
    market.status = 'Resolved'; market.winner_id = winner_id; market.resolved_at = new Date().toISOString();
    for (const entry of this.entries.values()) if (entry.prediction_id === predictionId && entry.status === 'Confirmed') entry.status = entry.selection === winner_id ? 'Won' : 'Lost';
    return { market: structuredClone(market), entries: [...this.entries.values()].filter(entry => entry.prediction_id === predictionId).map(entry => structuredClone(entry)) };
  }
  cancel(predictionId) { const market = this.market(predictionId); if (market.status === 'Resolved') throw Object.assign(new Error('Resolved predictions cannot be refunded'), { code: 'PREDICTION_RESOLVED', status: 409 }); market.status = 'Cancelled'; for (const entry of this.entries.values()) if (entry.prediction_id === predictionId) { if (entry.status === 'Confirmed') entry.status = 'RefundPending'; else if (entry.status === 'PendingVerification') entry.status = 'Cancelled'; } return structuredClone(market); }
  market(id) { this.requireEnabled(); const market = this.markets.get(id); if (!market) throw Object.assign(new Error('Prediction market not found'), { code: 'PREDICTION_NOT_FOUND', status: 404 }); return market; }
}
