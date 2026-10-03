import { enterMatch, commitMove, revealMove, settleMatch, record, opportunity } from './economy.js';
import { authorize } from './policy.js';
import { commitment, nonce } from './rps.js';
import { chooseMove, random } from './strategies.js';

export function eligibility(state, agent) {
  try {
    authorize({ ...state, paused: false }, { type: 'ENTER_GAME', agentId: agent.id, stake: state.config.stake, destination: 'simulation:rps' });
    return { eligible: true, reason: 'Ready' };
  } catch (error) { return { eligible: false, reason: error.message.split(': ').at(-1) }; }
}
export class Orchestrator {
  constructor(state, { onStage = () => {}, onSave = () => {} } = {}) {
    this.state = state; this.onStage = onStage; this.onSave = onSave; this.busy = false;
  }
  async step(players = null) {
    if (this.busy) throw new Error('A match is already running');
    if (this.state.paused) throw new Error('Economy is paused');
    this.busy = true;
    const before = structuredClone(this.state);
    try {
      const state = this.state;
      const available = state.agents.filter(a => eligibility(state, a).eligible);
      if (!players) {
        if (available.length < 2) throw new Error('Run complete: fewer than two eligible agents remain');
        const a = available.splice(Math.floor(random(state) * available.length), 1)[0];
        const b = available[Math.floor(random(state) * available.length)];
        players = [a.id, b.id];
      }
      record(state, 'GAME_AVAILABLE', opportunity(state, players));
      const match = enterMatch(state, players);
      await this.onStage('evaluate', match);
      const decisions = match.players.map(id => ({ id, move: chooseMove(state, state.agents.find(a => a.id === id), match.players.find(other => other !== id)), salt: nonce() }));
      for (const d of decisions) commitMove(state, match, d.id, await commitment(match.id, d.id, d.move, d.salt));
      await this.onStage('commit', match);
      for (const d of decisions) await revealMove(state, match, d.id, d.move, d.salt);
      await this.onStage('reveal', match);
      settleMatch(state, match);
      await this.onStage('settle', match);
      await this.onSave(state);
      return match;
    } catch (error) {
      for (const key of Object.keys(this.state)) delete this.state[key];
      Object.assign(this.state, before);
      throw error;
    } finally { this.busy = false; }
  }
}
