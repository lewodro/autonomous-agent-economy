export const SOL = 1_000_000_000;
export function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Amount must be nonnegative integer lamports');
  return value;
}
export function toLamports(value) {
  const input = String(value).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(input)) throw new Error('Use a nonnegative SOL amount with at most 9 decimal places');
  const [whole, fraction = ''] = input.split('.');
  return amount(Number(whole) * SOL + Number(fraction.padEnd(9, '0')));
}
export function authorize(state, intent) {
  if (state.paused) throw new Error('Economy is paused');
  if (!intent || intent.type !== 'ENTER_GAME' || intent.destination !== 'simulation:rps') throw new Error('Unapproved intent or destination');
  const agent = state.agents.find(a => a.id === intent.agentId);
  if (!agent) throw new Error('Unknown agent');
  const stake = amount(intent.stake);
  if (!stake) throw new Error('Stake must be positive');
  const policy = agent.policy;
  const locked = state.matches.filter(m => m.status !== 'settled' && m.players.includes(agent.id))
    .reduce((sum, m) => sum + m.stake, 0);
  const exposure = amount(locked + stake);
  if (stake > policy.maxStake) throw new Error(`${agent.name}: maximum stake exceeded`);
  const exposureLimit = Number(BigInt(amount(agent.balance + locked)) * BigInt(policy.maxExposureBps) / 10000n);
  if (exposure > exposureLimit) throw new Error(`${agent.name}: exposure limit exceeded`);
  if (agent.balance - stake < policy.reserve) throw new Error(`${agent.name}: reserve protected`);
  if (agent.pnl - exposure < -policy.maxLoss) throw new Error(`${agent.name}: loss limit protected`);
  return agent;
}
