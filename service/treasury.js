import { randomUUID } from 'node:crypto';
import { validSolanaAddress } from './world-economy.js';

const VERSION = 1;
const EVENT_TYPES = new Set(['funding', 'reward_allocation', 'payout_requested', 'payout_approved', 'payout_submitted', 'payout_confirmed', 'payout_failed', 'reconciliation']);
const STATUSES = new Set(['recorded', 'queued', 'approved', 'submitted', 'confirmed', 'failed']);

function safeAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Treasury amount must be a non-negative safe integer');
  return amount;
}

/**
 * Append-only treasury accounting. Internal game credits never enter this
 * ledger: values represent the configured real asset in its smallest unit.
 */
export class TreasuryLedger {
  constructor(store, { now = () => Date.now(), address = null, network = null, payoutsEnabled = false } = {}) {
    if (address && !validSolanaAddress(address)) throw new Error('WORLD_TREASURY_ADDRESS must be a valid public Solana address');
    this.store = store;
    this.now = now;
    this.address = address;
    this.network = ['devnet', 'mainnet-beta', 'testnet'].includes(network) ? network : null;
    this.payoutsEnabled = payoutsEnabled === true;
    this.state = { version: VERSION, events: [] };
  }

  async restore() {
    const saved = await this.store.load();
    if (saved) {
      if (saved.version !== VERSION || !Array.isArray(saved.events)) throw new Error('Invalid treasury ledger checkpoint');
      this.state = saved;
    }
    return this.publicSnapshot();
  }

  async append({ type, amount = 0, asset = 'SOL_LAMPORTS', status = 'recorded', reference_id, transaction_signature = null }) {
    if (!EVENT_TYPES.has(type)) throw new Error('Unsupported treasury event type');
    if (!STATUSES.has(status)) throw new Error('Unsupported treasury event status');
    if (typeof reference_id !== 'string' || !reference_id || reference_id.length > 128) throw new Error('Treasury reference ID is required');
    const existing = this.state.events.find(event => event.reference_id === reference_id && event.type === type);
    if (existing) return structuredClone(existing);
    const event = {
      event_id: `tre_${randomUUID()}`, type, amount: safeAmount(amount), asset,
      timestamp: new Date(this.now()).toISOString(), status, reference_id,
      transaction_signature: transaction_signature || null,
    };
    this.state.events.push(event);
    this.state.events = this.state.events.slice(-20_000);
    await this.store.save(this.state);
    return structuredClone(event);
  }

  accounting() {
    let funding = 0, allocation = 0, outstanding = 0, paid = 0;
    const payouts = new Map();
    for (const event of this.state.events) {
      if (event.type === 'funding' && ['recorded', 'confirmed'].includes(event.status)) funding += event.amount;
      if (event.type === 'reward_allocation' && ['recorded', 'approved', 'confirmed'].includes(event.status)) allocation += event.amount;
      if (event.type.startsWith('payout_')) payouts.set(event.reference_id, event);
    }
    for (const event of payouts.values()) {
      if (event.type === 'payout_confirmed' && event.status === 'confirmed') paid += event.amount;
      else if (event.type !== 'payout_failed' && !['failed', 'confirmed'].includes(event.status)) outstanding += event.amount;
    }
    return { reserve: Math.max(0, funding - paid), allocation, outstanding, available: Math.max(0, allocation - outstanding - paid), paid };
  }

  publicSnapshot() {
    const totals = this.accounting();
    const configured = Boolean(this.address && this.network);
    return {
      status: configured ? (this.payoutsEnabled ? 'configured' : 'payouts_disabled') : 'not_funded',
      network: this.network || 'not_configured',
      public_address: this.address,
      payouts_enabled: this.payoutsEnabled,
      funded: totals.reserve > 0,
      asset: 'SOL_LAMPORTS',
      reserves: configured ? totals.reserve : null,
      reward_allocation: totals.allocation,
      outstanding_payouts: totals.outstanding,
      available_reward_budget: totals.available,
      paid_lifetime: totals.paid,
      internal_credits_redeemable: false,
      recent_activity: this.state.events.slice(-20).reverse().map(event => ({ ...event })),
    };
  }

  health() {
    return { status: 'ok', storage: this.store.mode, events: this.state.events.length, network: this.network || 'not_configured', payouts_enabled: this.payoutsEnabled };
  }

  close() { return this.store.close(); }
}
