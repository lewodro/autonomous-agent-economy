import type { Replay, State, GameEvent, StepResponse } from './types.js';
import { applyEvent, checkpoint } from './replay.js';
import { api } from './api.js';
const durations: Partial<Record<GameEvent['type'],number>> = { RoundStarted: 160, WorldEvent: 260, AgentActionSelected: 75, WorkCompleted: 330, ChallengeStarted: 200, ChallengeResolved: 330, GuardRaised: 280, CooperationOffered: 320, AllianceCreated: 400, AllianceBroken: 400, ResourceChanged: 100, AgentEliminated: 600, MatchEnded: 650, RoundEnded: 100 };
export class Player {
  run: Replay | null = null; state: State | null = null; cursor = 1; session = ''; playing = false; busy = false; speed = 1;
  private generation = 0;
  constructor(private changed: (event?: GameEvent) => void, private failed: (message: string) => void) {}
  load(run: Replay, session = '', fromStart = false) {
    this.generation++; this.playing = false; this.busy = false; this.run = run; this.session = session;
    const point = checkpoint(run, fromStart ? 0 : run.final_state.turn); this.state = point.state; this.cursor = point.cursor;
    this.changed();
  }
  seek(turn: number) {
    if (!this.run) return;
    this.generation++; this.playing = false; this.busy = false;
    const point = checkpoint(this.run, turn); this.state = point.state; this.cursor = point.cursor; this.changed();
  }
  pause() { this.playing = false; this.changed(); }
  async play() {
    if (this.playing || this.busy || !this.run) return;
    if (this.state?.ended) this.seek(0);
    const generation = this.generation;
    this.playing = true; this.changed();
    while (this.playing && generation === this.generation) {
      const progressed = await this.round(true);
      if (generation !== this.generation) return;
      if (!progressed || this.state?.ended) { this.playing = false; break; }
    }
    this.changed();
  }
  async step() { if (this.playing || this.busy) return; await this.round(false); }
  private async wait(duration: number, generation: number, automatic: boolean): Promise<boolean> {
    let elapsed = 0, previous = performance.now();
    while (elapsed < duration) {
      await new Promise(resolve => setTimeout(resolve, 16));
      if (generation !== this.generation) return false;
      const now = performance.now(); if (!automatic || this.playing) elapsed += (now - previous) * this.speed;
      previous = now;
    }
    return generation === this.generation;
  }
  private async round(automatic: boolean): Promise<boolean> {
    if (!this.run || !this.state || this.busy) return false;
    const generation = this.generation;
    this.busy = true; this.changed();
    try {
      if (this.cursor >= this.run.events.length) {
        if (this.run.final_state.ended) return false;
        if (!this.session) throw new Error('Replay has reached its recorded end. Remix to start a new run.');
        const next = await api<StepResponse>(`/api/matches/${this.session}/step`, {});
        if (generation !== this.generation) return false;
        this.run = next.replay;
        try { localStorage.setItem('last-seat-replay-v1', JSON.stringify(this.run)); } catch { this.failed('Storage is full; download the replay to retain it.'); }
      }
      const turn = this.run.events[this.cursor]?.turn;
      while (this.cursor < this.run.events.length && this.run.events[this.cursor]?.turn === turn) {
        if (automatic && !this.playing) {
          while (!this.playing && generation === this.generation) await new Promise(resolve => setTimeout(resolve, 30));
          if (generation !== this.generation) return false;
        }
        const event = this.run.events[this.cursor++]!;
        this.state = applyEvent(this.state, event); this.changed(event);
        if (!await this.wait(durations[event.type] || 80, generation, automatic)) return false;
      }
      return true;
    } catch (error) { this.playing = false; this.failed((error as Error).message); return false; }
    finally { if (generation === this.generation) { this.busy = false; this.changed(); } }
  }
  // Resume a paused presentation loop; do not start a second core turn.
  resume() { if (this.busy) { this.playing = true; this.changed(); } else void this.play(); }
}
