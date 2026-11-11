import { readFileSync } from 'node:fs';

const VERSION = 1;
const LAYER_ID = /^[a-z0-9_]{1,48}$/;
const manifest = JSON.parse(readFileSync(new URL('../assets/aae_avatar_kit/avatar-manifest.json', import.meta.url), 'utf8'));

function layerIds(files) {
  return Object.freeze(files.map(file => file.replace(/\.png$/i, '')));
}

function uniqueIds(files, category) {
  const ids = layerIds(files);
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !LAYER_ID.test(id))) {
    throw new Error(`Avatar kit ${category} layers are invalid`);
  }
  return ids;
}

/** Layer IDs are the kit's file names without the .png suffix. */
export const APPEARANCE_LAYERS = Object.freeze({
  body: uniqueIds(manifest.layers.body, 'body'),
  hair: uniqueIds(manifest.layers.hair, 'hair'),
  outfit: uniqueIds(manifest.layers.outfits, 'outfit'),
  accessory: uniqueIds(manifest.layers.accessories, 'accessory'),
});

const allowed = Object.freeze({
  body: new Set(APPEARANCE_LAYERS.body),
  hair: new Set(APPEARANCE_LAYERS.hair),
  outfit: new Set(APPEARANCE_LAYERS.outfit),
  accessory: new Set(APPEARANCE_LAYERS.accessory),
});

/** The starter preset composes the first layer in each category. */
export const DEFAULT_APPEARANCE = Object.freeze({
  version: VERSION,
  body: APPEARANCE_LAYERS.body[0],
  hair: APPEARANCE_LAYERS.hair[0],
  outfit: APPEARANCE_LAYERS.outfit[0],
  accessory: APPEARANCE_LAYERS.accessory[0],
});

/** Preset avatar IDs stay valid when no modular appearance is saved. */
export const PRESET_AVATARS = Object.freeze(['visitor_starter', 'visitor_ember', 'visitor_atlas', 'visitor_nova', 'visitor_echo']);

export function defaultAppearance() {
  return { ...DEFAULT_APPEARANCE };
}

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_APPEARANCE', status: 400 });
}

function requireLayer(category, value) {
  if (typeof value !== 'string' || !LAYER_ID.test(value) || !allowed[category].has(value)) {
    throw invalid(`${category} is not an approved avatar layer`);
  }
  return value;
}

/**
 * Normalises an appearance object. `null` explicitly means "use the preset
 * avatar sheet"; `undefined` is handled by callers as "leave unchanged".
 */
export function sanitizeAppearance(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Appearance must be an object or null');
  if (value.version !== undefined && value.version !== VERSION) throw invalid('Appearance version is not supported');
  const accessory = value.accessory === null || value.accessory === undefined ? null : requireLayer('accessory', value.accessory);
  return {
    version: VERSION,
    body: requireLayer('body', value.body),
    hair: requireLayer('hair', value.hair),
    outfit: requireLayer('outfit', value.outfit),
    accessory,
  };
}

export function appearanceEqual(a, b) {
  return (a?.body || null) === (b?.body || null)
    && (a?.hair || null) === (b?.hair || null)
    && (a?.outfit || null) === (b?.outfit || null)
    && (a?.accessory || null) === (b?.accessory || null);
}
