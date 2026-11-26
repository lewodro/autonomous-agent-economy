/**
 * Pixel-art Sword Duel arena. The server owns every position, hit, health and
 * winner; this module predicts only the local thumbstick/keyboard position for
 * responsiveness, sends movement intents and paints the authoritative view.
 */
import { SPRITES } from './sprites.js';
import { drawActorSprite } from './renderer.js';

export type SwordFacing = 'up' | 'down' | 'left' | 'right';
export interface SwordFighter {
  player_id: string; name: string; x: number; y: number; facing: SwordFacing;
  hp: number; max_hp: number; dodging: boolean; stunned: boolean; hit: boolean;
  cooldown_ms: number; dodge_cooldown_ms: number; avatar?: string;
  exterior: { x: number; y: number };
}
export interface SwordEvent {
  id?: string; type: 'hit' | 'miss' | 'dodge' | 'dodge_start'; by: string; target?: string;
  damage?: number; hp?: number; reason?: string; at: number;
}
export interface SwordView {
  combat: { max_hp: number; damage: number; range: number; speed: number; attack_cooldown_ms: number; dodge_duration_ms: number; dodge_cooldown_ms: number; knockback: number; arena: { width: number; height: number; minX: number; maxX: number; minY: number; maxY: number }; standardized: boolean };
  fighters: [SwordFighter, SwordFighter]; events: SwordEvent[];
}
export interface ArenaCallbacks {
  onMove: (x: number, y: number, facing: SwordFacing) => void;
  onAttack: () => void;
  onDodge: () => void;
}

const TORCHES: ReadonlyArray<{ x: number; y: number }> = [
  { x: 108, y: 142 }, { x: 852, y: 142 }, { x: 108, y: 398 }, { x: 852, y: 398 },
];
const FACING_VECTOR: Record<SwordFacing, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface FloatText { x: number; y: number; text: string; color: string; until: number }

export class SwordArena {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: ArenaCallbacks;
  private readonly floor: HTMLCanvasElement;
  private view: SwordView | null = null;
  private youId: string | null = null;
  private spectating = false;
  private keys = new Set<string>();
  private local: { x: number; y: number; facing: SwordFacing } | null = null;
  private lastMoveSent = 0;
  private lastFrame = performance.now();
  private seenEvents = new Set<string>();
  private floats: FloatText[] = [];
  private sprites = new Map<string, HTMLImageElement>();
  private raf = 0;
  private stopped = false;

  constructor(canvas: HTMLCanvasElement, callbacks: ArenaCallbacks) {
    this.canvas = canvas; this.callbacks = callbacks;
    this.ctx = canvas.getContext('2d')!;
    this.floor = this.paintFloor();
    for (const sprite of SPRITES) {
      const image = new Image(); image.src = sprite.sheet;
      this.sprites.set(sprite.id, image);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  update(view: SwordView, youId: string | null, spectating: boolean): void {
    this.view = view;
    this.youId = youId;
    this.spectating = spectating;
    const bounds = view.combat.arena;
    const mine = view.fighters.find(fighter => fighter.player_id === youId);
    if (mine && !this.local) this.local = { x: mine.x, y: mine.y, facing: mine.facing };
    for (const event of view.events) {
      if (!event.id || this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);
      const target = view.fighters.find(fighter => fighter.player_id === event.target);
      if (!target) continue;
      const color = event.type === 'hit' ? '#ffe3a6' : event.type === 'dodge' ? '#a9edf5' : '#cbd6d0';
      this.floats.push({ x: target.x, y: target.y - 24, text: event.type === 'hit' ? `−${event.damage ?? 0}` : event.type === 'dodge' ? 'DODGE' : 'MISS', color, until: performance.now() + 760 });
    }
    if (this.floats.length > 20) this.floats = this.floats.slice(-20);
  }

  start(): void {
    if (this.raf) return;
    this.lastFrame = performance.now();
    const loop = (time: number) => {
      if (this.stopped) return;
      this.step(time);
      this.draw(time);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onBlur = (): void => { this.keys.clear(); };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.spectating || !this.view || this.view.fighters[0]?.hp === 0 || this.view.fighters[1]?.hp === 0) return;
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].includes(key)) event.preventDefault();
    if (key === ' ' || key === 'j') { if (!event.repeat) this.callbacks.onAttack(); return; }
    if (key === 'shift' || key === 'k') { if (!event.repeat) this.callbacks.onDodge(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) this.keys.add(key);
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.key.toLowerCase()); };

  /** Touch controls call this with a normalised joystick vector. */
  setJoystick(x: number, y: number): void {
    if (this.spectating) return;
    if (x < -0.25) this.keys.add('arrowleft'); else this.keys.delete('arrowleft');
    if (x > 0.25) this.keys.add('arrowright'); else this.keys.delete('arrowright');
    if (y < -0.25) this.keys.add('arrowup'); else this.keys.delete('arrowup');
    if (y > 0.25) this.keys.add('arrowdown'); else this.keys.delete('arrowdown');
  }

  private step(time: number): void {
    const dt = Math.min(0.1, Math.max(0, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    this.floats = this.floats.filter(float => float.until > time);
    if (!this.view || this.spectating || !this.local || this.view.fighters.some(fighter => fighter.hp <= 0)) return;
    const bounds = this.view.combat.arena;
    let x = 0, y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    if (!x && !y) return;
    const length = Math.hypot(x, y) || 1;
    const facing: SwordFacing = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
    const speed = this.view.combat.speed;
    this.local.x = clamp(this.local.x + (x / length) * speed * dt, bounds.minX, bounds.maxX);
    this.local.y = clamp(this.local.y + (y / length) * speed * dt, bounds.minY, bounds.maxY);
    this.local.facing = facing;
    if (time - this.lastMoveSent > 70) {
      this.lastMoveSent = time;
      this.callbacks.onMove(Math.round(this.local.x), Math.round(this.local.y), facing);
    }
  }

  private paintFloor(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.canvas.width; canvas.height = this.canvas.height;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#2b2b2d'; c.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 48; y < canvas.height - 48; y += 48) {
      for (let x = 48; x < canvas.width - 48; x += 48) {
        const shade = ((x / 48) * 7 + (y / 48) * 11) % 5;
        c.fillStyle = ['#5b5b58', '#62615c', '#555450', '#65635d', '#5d5d59'][shade]!;
        c.fillRect(x + 1, y + 1, 46, 46);
        if (shade === 2) { c.fillStyle = '#4d4c49'; c.fillRect(x + 9, y + 24, 6, 3); c.fillRect(x + 30, y + 12, 4, 3); }
      }
    }
    // Stone boundary walls with offset brick seams.
    c.fillStyle = '#333331'; c.fillRect(0, 0, canvas.width, 48); c.fillRect(0, canvas.height - 48, canvas.width, 48);
    c.fillRect(0, 0, 48, canvas.height); c.fillRect(canvas.width - 48, 0, 48, canvas.height);
    for (let x = 0; x < canvas.width; x += 64) {
      c.fillStyle = x % 128 === 0 ? '#7a7165' : '#6a6359';
      c.fillRect(x + 2, 6, 60, 34); c.fillRect(x + 34, canvas.height - 42, 60, 34);
    }
    for (let y = 64; y < canvas.height - 48; y += 64) {
      c.fillStyle = y % 128 === 0 ? '#746b61' : '#615b53';
      c.fillRect(6, y + 2, 34, 60); c.fillRect(canvas.width - 40, y + 34, 34, 60);
    }
    // Centre sigil: crossed swords under a worn ring.
    c.strokeStyle = '#8a7d68'; c.lineWidth = 4;
    c.beginPath(); c.arc(canvas.width / 2, canvas.height / 2, 74, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = '#a9a191'; c.lineWidth = 6;
    c.beginPath(); c.moveTo(canvas.width / 2 - 44, canvas.height / 2 - 44); c.lineTo(canvas.width / 2 + 44, canvas.height / 2 + 44);
    c.moveTo(canvas.width / 2 + 44, canvas.height / 2 - 44); c.lineTo(canvas.width / 2 - 44, canvas.height / 2 + 44); c.stroke();
    return canvas;
  }

  private drawBanners(time: number): void {
    const c = this.ctx;
    for (const [index, x] of [176, 784].entries()) {
      c.fillStyle = index === 0 ? '#7d3d3d' : '#2f6070';
      c.fillRect(x - 30, 50, 60, 92);
      c.fillStyle = '#d8bd73'; c.fillRect(x - 32, 46, 64, 8);
      c.fillStyle = '#e8d8a6';
      c.beginPath(); c.moveTo(x, 68); c.lineTo(x + 14, 88); c.lineTo(x, 112); c.lineTo(x - 14, 88); c.closePath(); c.fill();
      if (!reduceMotion()) c.fillRect(x - 30, 142 + Math.sin(time / 420) * 2, 60, 4);
    }
  }

  private drawTorches(time: number): void {
    const c = this.ctx;
    for (const torch of TORCHES) {
      const flicker = reduceMotion() ? 1 : 0.85 + Math.sin(time / 130 + torch.x) * 0.15;
      const glow = c.createRadialGradient(torch.x, torch.y, 4, torch.x, torch.y, 132 * flicker);
      glow.addColorStop(0, 'rgba(255,206,126,.34)'); glow.addColorStop(1, 'rgba(255,180,90,0)');
      c.fillStyle = glow; c.beginPath(); c.arc(torch.x, torch.y, 132 * flicker, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#4b3b2c'; c.fillRect(torch.x - 4, torch.y, 8, 28);
      c.fillStyle = '#f0a253'; c.fillRect(torch.x - 6, torch.y - 12, 12, 14);
      c.fillStyle = '#ffe0a0'; c.fillRect(torch.x - 3, torch.y - 16 + (flicker > 0.95 ? -2 : 0), 6, 10);
    }
  }

  private drawFighter(fighter: SwordFighter, index: number, time: number): void {
    const c = this.ctx;
    const predicted = !this.spectating && fighter.player_id === this.youId ? this.local : null;
    const position = predicted ?? { x: fighter.x, y: fighter.y, facing: fighter.facing };
    const player = { position: { x: position.x, y: position.y }, facing: position.facing, movementState: 'idle' as const };
    if (fighter.dodging) { c.globalAlpha = 0.55; }
    const avatar = fighter.avatar || 'visitor_starter';
    const sprite = SPRITES.find(value => value.id === avatar);
    drawActorSprite(c, sprite, this.sprites.get(avatar), player, time, reduceMotion(), 52);
    c.globalAlpha = 1;
    const tint = index === 0 ? '#e4c274' : '#8fd3e2';
    c.fillStyle = tint; c.fillRect(position.x - 18, position.y + 22, 36, 4);
    // Sword stroke in the facing direction, with an impact flash on a hit.
    const vector = FACING_VECTOR[position.facing];
    c.strokeStyle = fighter.hit ? '#fff3cf' : '#d9e4ea'; c.lineWidth = 5;
    c.beginPath(); c.moveTo(position.x + vector.x * 10, position.y + vector.y * 10 - 14);
    c.lineTo(position.x + vector.x * 38, position.y + vector.y * 38 - 14); c.stroke();
    if (fighter.hit) {
      c.strokeStyle = 'rgba(255,110,96,.85)'; c.lineWidth = 3;
      c.beginPath(); c.arc(position.x, position.y - 8, 28, 0, Math.PI * 2); c.stroke();
    }
    // Health bar, always readable over the stone floor.
    const width = 72, hp = Math.max(0, Math.round(fighter.hp / fighter.max_hp * width));
    c.fillStyle = '#141a19'; c.fillRect(position.x - width / 2 - 2, position.y - 58, width + 4, 10);
    c.fillStyle = index === 0 ? '#ddb35d' : '#71bdcd'; c.fillRect(position.x - width / 2, position.y - 56, hp, 6);
    c.fillStyle = '#f4ead2'; c.font = '9px ui-monospace,monospace'; c.textAlign = 'center';
    c.fillText(`${Math.max(0, fighter.hp)}/${fighter.max_hp}`, position.x, position.y - 62);
  }

  private draw(time: number): void {
    const c = this.ctx;
    c.drawImage(this.floor, 0, 0);
    this.drawBanners(time);
    this.drawTorches(time);
    if (!this.view) return;
    this.view.fighters.forEach((fighter, index) => this.drawFighter(fighter, index, time));
    for (const float of this.floats) {
      const remaining = (float.until - time) / 760;
      c.globalAlpha = clamp(remaining, 0, 1);
      c.fillStyle = float.color; c.font = 'bold 14px ui-monospace,monospace'; c.textAlign = 'center';
      c.fillText(float.text, float.x, float.y - (1 - remaining) * 28);
      c.globalAlpha = 1;
    }
    if (this.view.fighters.some(fighter => fighter.hp <= 0)) {
      c.fillStyle = 'rgba(12,16,15,.62)'; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    }
  }
}

function reduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
