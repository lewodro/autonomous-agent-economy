import { normalizeInput, type InputSource, type WorldInput } from './model.js';
export interface KeyboardInputHooks {
  /** How long E must stay down before the hold action is offered. */
  holdDelayMs?: number;
  /** Return true when the hold took over (for example, opened the quick-chat wheel). */
  onHold?: () => boolean;
  /** Called on release or reset after a hold took over, so the owner can cancel. */
  onHoldEnd?: () => void;
}
export class KeyboardInput implements InputSource {
  private keys = new Set<string>();
  private interaction = false;
  private holdTimer = 0;
  private holdActive = false;
  private holdDelayMs: number;
  private onHold?: () => boolean;
  private onHoldEnd?: () => void;
  private down = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && (event.target.matches('input,select,textarea') || event.target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e'].includes(key)) return;
    event.preventDefault(); this.keys.add(key);
    if (key === 'e' && !event.repeat) {
      this.holdActive = false;
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = 0;
        if (!this.keys.has('e')) return;
        // A tap still interacts. Only a hold that a nearby human can consume
        // becomes quick chat; otherwise the normal E action happens at the
        // threshold instead of the release.
        const taken = this.onHold?.() === true;
        this.holdActive = taken;
        if (!taken) this.interaction = true;
      }, this.holdDelayMs);
    }
  };
  private up = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    this.keys.delete(key);
    if (key !== 'e') return;
    if (this.holdTimer) {
      window.clearTimeout(this.holdTimer); this.holdTimer = 0;
      // Short press: preserve the original immediate interaction.
      this.interaction = true;
    }
    if (this.holdActive) {
      this.holdActive = false;
      this.onHoldEnd?.();
    }
  };
  private blur = () => this.reset();
  constructor(private target: HTMLElement, hooks: KeyboardInputHooks = {}) {
    this.holdDelayMs = hooks.holdDelayMs ?? 380;
    this.onHold = hooks.onHold;
    this.onHoldEnd = hooks.onHoldEnd;
    target.addEventListener('keydown', this.down); window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.blur); document.addEventListener('visibilitychange', this.blur);
  }
  read(): WorldInput {
    const pressed = (...keys: string[]) => keys.some(k => this.keys.has(k)) ? 1 : 0;
    const result = normalizeInput(pressed('d','arrowright') - pressed('a','arrowleft'), pressed('s','arrowdown') - pressed('w','arrowup'), this.interaction);
    this.interaction = false; return result;
  }
  reset(): void {
    this.keys.clear(); this.interaction = false;
    if (this.holdTimer) { window.clearTimeout(this.holdTimer); this.holdTimer = 0; }
    if (this.holdActive) { this.holdActive = false; this.onHoldEnd?.(); }
  }
  destroy(): void {
    this.target.removeEventListener('keydown', this.down); window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.blur); this.reset();
  }
}
export class TouchJoystickInput implements InputSource {
  private axis = { x: 0, y: 0 }; private pointer: number | null = null; private interaction = false;
  private update = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer) return;
    const rect = this.pad.getBoundingClientRect();
    this.axis = normalizeInput((event.clientX - rect.left - rect.width/2)/(rect.width*.32), (event.clientY - rect.top - rect.height/2)/(rect.height*.32));
    if (Math.hypot(this.axis.x,this.axis.y)<.12) this.axis={x:0,y:0};
    this.knob.style.transform = `translate(${this.axis.x*32}px,${this.axis.y*32}px)`;
  };
  private down = (event: PointerEvent) => {
    if (this.pointer !== null) return; this.pointer=event.pointerId; this.pad.setPointerCapture(event.pointerId); this.update(event);
  };
  private up = (event: PointerEvent) => { if (event.pointerId === this.pointer) this.reset(); };
  private interact = () => { this.interaction = true; };
  private blur = () => this.reset();
  constructor(private pad: HTMLElement, private knob: HTMLElement, private button: HTMLButtonElement) {
    pad.addEventListener('pointerdown',this.down);pad.addEventListener('pointermove',this.update);
    for (const name of ['pointerup','pointercancel','lostpointercapture']) pad.addEventListener(name,this.up as EventListener);
    button.addEventListener('click',this.interact);window.addEventListener('blur',this.blur);document.addEventListener('visibilitychange',this.blur);
  }
  read(): WorldInput { const result={...this.axis,interact:this.interaction};this.interaction=false;return result; }
  reset(): void { this.axis={x:0,y:0};this.pointer=null;this.interaction=false;this.knob.style.transform='translate(0,0)'; }
  destroy(): void {
    this.pad.removeEventListener('pointerdown',this.down);this.pad.removeEventListener('pointermove',this.update);
    for(const name of ['pointerup','pointercancel','lostpointercapture'])this.pad.removeEventListener(name,this.up as EventListener);
    this.button.removeEventListener('click',this.interact);window.removeEventListener('blur',this.blur);document.removeEventListener('visibilitychange',this.blur);this.reset();
  }
}
