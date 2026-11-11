/**
 * Runtime composition for the modular visitor kit in assets/aae_avatar_kit.
 * Layers are 96×128 sheets (3×4 frames of 32×32) and are drawn in the
 * manifest's order: body, outfit, hair, accessory.
 */
export const APPEARANCE_CATEGORIES = ['body', 'outfit', 'hair', 'accessory'] as const;
export type AppearanceCategory = typeof APPEARANCE_CATEGORIES[number];

export interface Appearance {
  version: 1;
  body: string;
  hair: string;
  outfit: string;
  accessory: string | null;
}
export interface AppearanceCatalog {
  body: string[];
  hair: string[];
  outfit: string[];
  accessory: string[];
}

export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  version: 1,
  body: 'body_brown',
  hair: 'hair_bob_black',
  outfit: 'outfit_hoodie_charcoal',
  accessory: 'accessory_cap',
});

const LAYER_ID = /^[a-z0-9_]{1,48}$/;
const FOLDERS: Record<AppearanceCategory, string> = { body: 'body', hair: 'hair', outfit: 'outfits', accessory: 'accessories' };
const LAYER_ROOT = '/assets/aae_avatar_kit/layers';

function validLayerId(value: unknown): value is string {
  return typeof value === 'string' && LAYER_ID.test(value);
}

/** Structural validation for local settings and presence payloads. */
export function parseAppearance(value: unknown): Appearance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Partial<Appearance>;
  if (input.version !== undefined && input.version !== 1) return null;
  if (!validLayerId(input.body) || !validLayerId(input.hair) || !validLayerId(input.outfit)) return null;
  const accessory = input.accessory === null || input.accessory === undefined ? null : input.accessory;
  if (accessory !== null && !validLayerId(accessory)) return null;
  return { version: 1, body: input.body, hair: input.hair, outfit: input.outfit, accessory };
}

export function appearanceKey(appearance: Appearance): string {
  return `${appearance.body}|${appearance.outfit}|${appearance.hair}|${appearance.accessory ?? ''}`;
}

export function layerUrl(appearance: Appearance, category: AppearanceCategory): string {
  return `${LAYER_ROOT}/${FOLDERS[category]}/${appearance[category]}.png`;
}

function layerIds(files: unknown): string[] | null {
  if (!Array.isArray(files) || !files.length) return null;
  const ids = files.map(file => typeof file === 'string' ? file.replace(/\.png$/i, '') : '');
  return ids.every(validLayerId) ? ids : null;
}

export async function loadAppearanceCatalog(signal?: AbortSignal): Promise<AppearanceCatalog> {
  const response = await fetch('/assets/aae_avatar_kit/avatar-manifest.json', { signal: signal ?? AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error('Appearance catalog unavailable');
  const manifest = await response.json() as { version?: number; layers?: Record<string, unknown> };
  const body = layerIds(manifest.layers?.body);
  const hair = layerIds(manifest.layers?.hair);
  const outfit = layerIds(manifest.layers?.outfits);
  const accessory = layerIds(manifest.layers?.accessories);
  if (manifest.version !== 1 || !body || !hair || !outfit || !accessory) throw new Error('Appearance catalog invalid');
  return { body, hair, outfit, accessory };
}

/** Splits `hair_curly_red` into style and colour; body IDs are single tones. */
export function layerParts(id: string, prefix: string): { style: string; color: string } | null {
  if (!id.startsWith(`${prefix}_`)) return null;
  const rest = id.slice(prefix.length + 1), split = rest.lastIndexOf('_');
  if (split < 1) return { style: rest, color: '' };
  return { style: rest.slice(0, split), color: rest.slice(split + 1) };
}

export function joinLayer(prefix: string, style: string, color: string): string {
  return color ? `${prefix}_${style}_${color}` : `${prefix}_${style}`;
}

/** Loads and composes the kit layers once per appearance. */
export class AppearanceSprites {
  private images = new Map<string, HTMLImageElement>();
  private sheets = new Map<string, HTMLCanvasElement>();
  private failed = new Set<string>();

  preload(appearance: Appearance): void {
    for (const category of APPEARANCE_CATEGORIES) {
      if (category === 'accessory' && !appearance.accessory) continue;
      this.image(layerUrl(appearance, category));
    }
  }

  /** Returns a composed 96×128 sheet, or null while layers are still loading. */
  sheet(appearance: Appearance): HTMLCanvasElement | null {
    const key = appearanceKey(appearance);
    const cached = this.sheets.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.imageSmoothingEnabled = false;
    let ready = true;
    for (const category of APPEARANCE_CATEGORIES) {
      if (category === 'accessory' && !appearance.accessory) continue;
      const url = layerUrl(appearance, category);
      if (this.failed.has(url)) return null;
      const image = this.image(url);
      if (!image.complete || image.naturalWidth !== 96 || image.naturalHeight !== 128) { ready = false; continue; }
      context.drawImage(image, 0, 0);
    }
    if (!ready) return null;
    this.sheets.set(key, canvas);
    return canvas;
  }

  /** Draws one 32×32 frame at the requested destination size. */
  drawFrame(context: CanvasRenderingContext2D, appearance: Appearance, frame: number, x: number, y: number, size: number): boolean {
    const sheet = this.sheet(appearance);
    if (!sheet) return false;
    const column = ((frame % 3) + 3) % 3, row = Math.max(0, Math.floor(frame / 3)) % 4;
    context.drawImage(sheet, column * 32, row * 32, 32, 32, Math.round(x), Math.round(y), size, size);
    return true;
  }

  private image(url: string): HTMLImageElement {
    let image = this.images.get(url);
    if (image) return image;
    image = new Image();
    image.src = url;
    image.addEventListener('error', () => { this.failed.add(url); }, { once: true });
    this.images.set(url, image);
    return image;
  }
}

export const appearanceSprites = new AppearanceSprites();
