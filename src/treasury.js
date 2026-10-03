import { amount } from './policy.js';
import { record, assertAccounting } from './economy.js';
export function receiveRevenue(state, receiptId, revenue) {
  if (state.paused) throw new Error('Economy is paused');
  if (typeof receiptId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(receiptId)) throw new Error('Invalid receipt ID');
  amount(revenue);
  if (!revenue) throw new Error('Revenue must be positive');
  const prior = state.events.find(e => e.type === 'TREASURY_UPDATED' && e.data.receiptId === receiptId);
  if (prior) {
    if (prior.data.revenue !== revenue) throw new Error('Receipt ID already used for a different amount');
    return prior.data.deposit;
  }
  const deposit = Number(BigInt(revenue) * 30n / 100n);
  amount(state.treasury + deposit); amount(state.externalCapital + deposit);
  state.treasury += deposit; state.externalCapital += deposit;
  record(state, 'TREASURY_UPDATED', { receiptId, source: 'confirmed-simulated-creator-revenue', revenue, deposit, creatorRemainder: revenue - deposit });
  assertAccounting(state); return deposit;
}
export function allocateTreasury(state, allocationId) {
  if (state.paused) throw new Error('Economy is paused');
  if (typeof allocationId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(allocationId)) throw new Error('Invalid allocation ID');
  const prior = state.events.find(e => e.type === 'TREASURY_ALLOCATED' && e.data.allocationId === allocationId);
  if (prior) return prior.data.allocations;
  if (!state.treasury) throw new Error('Treasury is empty. Record a simulated receipt first.');
  // Equalize the lowest balances first, with a per-allocation cap of 10% of capital.
  let remaining = state.treasury;
  const allocations = [];
  for (const agent of [...state.agents].sort((a, b) => a.balance - b.balance)) {
    const target = Math.max(agent.capital, agent.policy.reserve + state.config.stake);
    const grant = Math.min(remaining, Math.max(0, target - agent.balance), Math.floor(agent.capital / 10));
    if (grant) { allocations.push({ agentId: agent.id, amount: grant }); remaining -= grant; }
  }
  if (!allocations.length) throw new Error('No agents need a grant under the allocation policy');
  for (const grant of allocations) {
    const agent = state.agents.find(a => a.id === grant.agentId);
    agent.balance += grant.amount; agent.capital += grant.amount; agent.peak += grant.amount;
  }
  state.treasury = remaining;
  record(state, 'TREASURY_ALLOCATED', { allocationId, allocations });
  assertAccounting(state); return allocations;
}
