import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLOSSEUM, colosseumReady, insideColosseum, publicColosseum } from '../src/colosseum.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const literal = file => {
  const text = readFileSync(root + file, 'utf8');
  const match = text.match(/export const COLOSSEUM = Object\.freeze\(([\s\S]*?)\);/);
  assert.ok(match, `${file} must export a canonical object literal`);
  return JSON.parse(match[1]);
};

test('browser and server share one Colosseum footprint', () => {
  assert.deepEqual(literal('src/colosseum.js'), literal('web/src/world/colosseum.ts'));
  const config = publicColosseum();
  assert.equal(config.label, 'Colosseum');
  assert.equal(config.challenge_radius, 132);
  assert.ok(config.prompt.includes('COLOSSEUM'));
});

test('the challenge area is inside the walls and reachable through the west gap', () => {
  const { inner, outer, entrance, center, challenge_radius } = COLOSSEUM;
  assert.equal(outer.x, inner.x - 20);
  assert.equal(outer.y, inner.y - 20);
  assert.equal(outer.width, inner.width + 40);
  assert.equal(entrance.x, outer.x);
  assert.ok(entrance.y >= inner.y && entrance.y + entrance.height <= inner.y + inner.height);
  assert.ok(inner.x <= center.x - challenge_radius && center.x + challenge_radius <= inner.x + inner.width);
  assert.ok(inner.y <= center.y - challenge_radius && center.y + challenge_radius <= inner.y + inner.height);
  assert.equal(insideColosseum({ x: center.x, y: center.y }), true);
  assert.equal(insideColosseum({ x: inner.x + 4, y: center.y }), false);
  assert.equal(insideColosseum({ x: Number.NaN, y: center.y }), false);
  assert.equal(colosseumReady({ x: 1670, y: 1120 }, { x: 1730, y: 1120 }), true);
  assert.equal(colosseumReady({ x: 1670, y: 1120 }, { x: 1450, y: 1120 }), false);
});
