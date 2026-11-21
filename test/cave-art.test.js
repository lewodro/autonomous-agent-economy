import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCaveMonster } from '../web/dist/world/cave-art.js';

function context() {
  const colors = [];
  return {
    colors,
    fillStyle: '',
    beginPath() {}, ellipse() {}, fill() {},
    fillRect() { colors.push(this.fillStyle); },
  };
}

const monster = overrides => ({
  id: 'test', kind: 'crawler', boss: false, x: 50, y: 50,
  hp: 24, max_hp: 24, alive: true, state: 'idle', hit: false,
  ...overrides,
});

test('successful cave hits render a temporary red creature tint', () => {
  const normal = context(), hit = context();
  drawCaveMonster(normal, monster({}), 0, true);
  drawCaveMonster(hit, monster({ hit: true }), 0, true);
  assert.equal(normal.colors.includes('#e14b3f'), false);
  assert.equal(hit.colors.includes('#e14b3f'), true);
});

test('the Grizzly is original pixel creature art rather than a placeholder rectangle', () => {
  const grizzly = context();
  drawCaveMonster(grizzly, monster({ id: 'grizzly', kind: 'grizzly', boss: true, hp: 120, max_hp: 120 }), 0, true);
  assert.ok(grizzly.colors.length >= 12);
  assert.ok(grizzly.colors.includes('#6f4932'));
  assert.ok(grizzly.colors.includes('#9a6845'));
});
