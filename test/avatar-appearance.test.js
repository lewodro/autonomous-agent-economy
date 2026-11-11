import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPEARANCE_LAYERS,
  DEFAULT_APPEARANCE,
  PRESET_AVATARS,
  appearanceEqual,
  defaultAppearance,
  sanitizeAppearance,
} from '../service/avatar-appearance.js';

test('the avatar kit manifest exposes approved modular layers and the starter default', () => {
  assert.equal(APPEARANCE_LAYERS.body.length, 6);
  assert.equal(APPEARANCE_LAYERS.hair.length, 36);
  assert.equal(APPEARANCE_LAYERS.outfit.length, 24);
  assert.equal(APPEARANCE_LAYERS.accessory.length, 3);
  assert.deepEqual(DEFAULT_APPEARANCE, {
    version: 1,
    body: 'body_brown',
    hair: 'hair_bob_black',
    outfit: 'outfit_hoodie_charcoal',
    accessory: 'accessory_cap',
  });
  assert.deepEqual(defaultAppearance(), { ...DEFAULT_APPEARANCE });
  assert.deepEqual(PRESET_AVATARS, ['visitor_starter', 'visitor_ember', 'visitor_atlas', 'visitor_nova', 'visitor_echo']);
});

test('appearance validation accepts only exact kit layers and null preset fallback', () => {
  const appearance = { version: 1, body: 'body_tan', hair: 'hair_curly_red', outfit: 'outfit_hoodie_forest', accessory: 'accessory_headphones' };
  assert.deepEqual(sanitizeAppearance(appearance), appearance);
  assert.deepEqual(sanitizeAppearance({ ...appearance, version: undefined }), appearance);
  assert.deepEqual(sanitizeAppearance({ ...appearance, accessory: undefined }), { ...appearance, accessory: null });
  assert.equal(sanitizeAppearance(null), null);
  assert.ok(appearanceEqual(appearance, { ...appearance, version: 99 }));
  assert.equal(appearanceEqual(appearance, null), false);
  for (const value of [
    { ...appearance, body: 'body_alien' },
    { ...appearance, hair: 'hair_curly_red.png' },
    { ...appearance, outfit: '../outfit' },
    { ...appearance, accessory: 'cap' },
    { ...appearance, version: 2 },
    { ...appearance, body: undefined },
    [],
    'body_tan',
  ]) {
    assert.throws(() => sanitizeAppearance(value), { code: 'INVALID_APPEARANCE' });
  }
});
