import { CORE_BOUNDS, MAP } from './map.js';
import {
  MINIMAP_HEIGHT, MINIMAP_PADDING, MINIMAP_PATHS, MINIMAP_WIDTH,
  minimapPoint, type MapMarker,
} from './explore.js';
import type { Facing, Position } from './model.js';

const PIXEL_RATIO = 2;
export interface MinimapFrame {
  player: Position; facing: Facing; markers: ReadonlyArray<MapMarker>; humans: ReadonlyArray<Position>;
}
/**
 * A cached pixel minimap. The terrain layer is painted once; each update only
 * blits that small bitmap and plots a bounded set of markers and nearby people.
 */
export class WorldMinimap {
  private ctx: CanvasRenderingContext2D;
  private base = document.createElement('canvas');
  private lastUpdate = 0;
  private lastKey = '';
  private collapsed = false;
  constructor(
    private canvas: HTMLCanvasElement,
    private toggle: HTMLButtonElement,
    private body: HTMLElement,
    private region: HTMLElement,
    private summary: HTMLElement,
  ) {
    this.canvas.width = MINIMAP_WIDTH * PIXEL_RATIO;
    this.canvas.height = MINIMAP_HEIGHT * PIXEL_RATIO;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Your browser does not support the minimap.');
    this.ctx = context;
    this.paintBase();
    this.toggle.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.setCollapsed(false, true);
  }
  private paintBase(): void {
    this.base.width = MINIMAP_WIDTH * PIXEL_RATIO;
    this.base.height = MINIMAP_HEIGHT * PIXEL_RATIO;
    const c = this.base.getContext('2d');
    if (!c) return;
    c.scale(PIXEL_RATIO, PIXEL_RATIO);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#14241e';
    c.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    const topLeft = minimapPoint({ x: MAP.minX, y: MAP.minY });
    const bottomRight = minimapPoint({ x: MAP.maxX, y: MAP.maxY });
    c.fillStyle = '#22382f';
    c.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    c.strokeStyle = '#6f735d';
    c.lineWidth = 1;
    c.strokeRect(topLeft.x + .5, topLeft.y + .5, bottomRight.x - topLeft.x - 1, bottomRight.y - topLeft.y - 1);
    const coreTopLeft = minimapPoint({ x: CORE_BOUNDS.minX, y: CORE_BOUNDS.minY });
    const coreBottomRight = minimapPoint({ x: CORE_BOUNDS.maxX, y: CORE_BOUNDS.maxY });
    c.fillStyle = '#30483b';
    c.fillRect(coreTopLeft.x, coreTopLeft.y, coreBottomRight.x - coreTopLeft.x, coreBottomRight.y - coreTopLeft.y);
    c.strokeStyle = '#4e6554';
    c.strokeRect(coreTopLeft.x + .5, coreTopLeft.y + .5, coreBottomRight.x - coreTopLeft.x - 1, coreBottomRight.y - coreTopLeft.y - 1);
    c.strokeStyle = '#736a53';
    c.lineWidth = 1.5;
    c.beginPath();
    for (const path of MINIMAP_PATHS) {
      const start = minimapPoint({ x: path.x1, y: path.y1 });
      const end = minimapPoint({ x: path.x2, y: path.y2 });
      c.moveTo(Math.round(start.x) + .5, Math.round(start.y) + .5);
      c.lineTo(Math.round(end.x) + .5, Math.round(end.y) + .5);
    }
    c.stroke();
    // Tiny connectors make the city-to-loop transitions legible at this size.
    const connections: Array<[Position, Position]> = [
      [{ x: 576, y: CORE_BOUNDS.minY }, { x: 576, y: (CORE_BOUNDS.minY + MAP.minY) / 2 }],
      [{ x: (CORE_BOUNDS.minX + MAP.minX) / 2, y: 460 }, { x: CORE_BOUNDS.minX, y: 460 }],
      [{ x: 1250, y: CORE_BOUNDS.maxY }, { x: 1250, y: (CORE_BOUNDS.maxY + MAP.maxY) / 2 }],
      [{ x: CORE_BOUNDS.maxX, y: 900 }, { x: (CORE_BOUNDS.maxX + MAP.maxX) / 2, y: 900 }],
    ];
    c.strokeStyle = '#5f5947';
    c.lineWidth = 1;
    c.beginPath();
    for (const [start, end] of connections) {
      const a = minimapPoint(start), b = minimapPoint(end);
      c.moveTo(Math.round(a.x) + .5, Math.round(a.y) + .5);
      c.lineTo(Math.round(b.x) + .5, Math.round(b.y) + .5);
    }
    c.stroke();
    // Faint compass letters keep the panel readable without a legend.
    c.fillStyle = '#7e8b72';
    c.font = '6px ui-monospace, SFMono-Regular, monospace';
    c.textAlign = 'center';
    c.fillText('N', MINIMAP_WIDTH / 2, 8);
    c.fillText('S', MINIMAP_WIDTH / 2, MINIMAP_HEIGHT - 2);
    c.fillText('W', 4, MINIMAP_HEIGHT / 2 + 2);
    c.fillText('E', MINIMAP_WIDTH - 4, MINIMAP_HEIGHT / 2 + 2);
  }
  setCollapsed(value: boolean, immediate = false): void {
    this.collapsed = value;
    const panel = this.canvas.closest<HTMLElement>('.world-minimap');
    panel?.classList.toggle('is-collapsed', value);
    if (immediate) panel?.classList.add('no-transition');
    this.toggle.setAttribute('aria-expanded', String(!value));
    this.toggle.textContent = value ? 'MAP ▸' : 'MAP ▾';
    this.body.setAttribute('aria-hidden', String(value));
    if (immediate) requestAnimationFrame(() => panel?.classList.remove('no-transition'));
  }
  isCollapsed(): boolean { return this.collapsed; }
  /** The caller may update every frame; drawing is capped at roughly 8 fps. */
  update(frame: MinimapFrame, time: number): void {
    const key = [
      Math.round(frame.player.x), Math.round(frame.player.y), frame.facing,
      frame.markers.map(marker => marker.id).join(','),
      frame.humans.map(human => `${Math.round(human.x)},${Math.round(human.y)}`).join(';'),
    ].join('|');
    if (time - this.lastUpdate < 120 && key === this.lastKey) return;
    this.lastUpdate = time;
    this.lastKey = key;
    this.canvas.dataset.player = `${Math.round(frame.player.x)},${Math.round(frame.player.y)}`;
    this.canvas.dataset.markers = String(frame.markers.length);
    this.canvas.dataset.outer = String(frame.markers.filter(marker => marker.kind !== 'city').length);
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    c.scale(PIXEL_RATIO, PIXEL_RATIO);
    c.imageSmoothingEnabled = false;
    const compact = this.canvas.clientWidth > 0 && this.canvas.clientWidth < 180;
    for (const human of frame.humans) {
      const point = minimapPoint(human);
      c.fillStyle = '#a7d7c8';
      c.fillRect(Math.round(point.x) - 1, Math.round(point.y) - 1, 2, 2);
    }
    c.font = '6px ui-monospace, SFMono-Regular, monospace';
    c.textAlign = 'center';
    for (const marker of frame.markers) {
      const point = minimapPoint(marker.position);
      const x = Math.round(point.x), y = Math.round(point.y);
      if (marker.kind === 'city') {
        c.fillStyle = '#14241e';
        c.fillRect(x - 2, y - 2, 5, 5);
        c.fillStyle = '#d7b675';
        c.fillRect(x - 1, y - 1, 3, 3);
        if (!compact && marker.label) {
          const [offsetX, offsetY] = marker.labelOffset ?? [0, -4];
          c.fillStyle = '#d8cf9f';
          c.fillText(marker.label, x + offsetX, y + offsetY);
        }
      } else if (marker.kind === 'cave') {
        c.fillStyle = '#1a2a25';
        c.fillRect(x - 2, y - 2, 5, 4);
        c.fillStyle = '#8d947c';
        c.fillRect(x - 2, y - 3, 5, 1);
      } else if (marker.kind === 'camp') {
        c.fillStyle = '#e19a51';
        c.fillRect(x - 1, y - 1, 3, 3);
        c.fillStyle = '#7b3d2b';
        c.fillRect(x - 2, y + 1, 5, 1);
      } else if (marker.kind === 'shrine') {
        c.fillStyle = '#d7b675';
        c.fillRect(x - 1, y - 3, 2, 7);
        c.fillRect(x - 3, y - 1, 7, 2);
      } else {
        c.fillStyle = '#9a9a83';
        c.fillRect(x - 2, y - 2, 4, 4);
        c.fillStyle = '#5c6757';
        c.fillRect(x - 1, y + 1, 3, 1);
      }
    }
    const player = minimapPoint(frame.player);
    const px = Math.round(player.x), py = Math.round(player.y);
    c.fillStyle = '#f4e5bd';
    c.fillRect(px - 2, py - 2, 4, 4);
    c.fillStyle = '#22332f';
    c.fillRect(px - 1, py - 1, 2, 2);
    c.fillStyle = '#f0cf75';
    const facingOffset: Record<Facing, [number, number]> = {
      up: [0, -4], down: [0, 3], left: [-4, 0], right: [3, 0],
    };
    const [dx, dy] = facingOffset[frame.facing];
    c.fillRect(px + dx, py + dy, 2, 2);
  }
  setRegion(label: string): void { this.region.textContent = label; }
  setSummary(text: string): void { this.summary.textContent = text; }
}
