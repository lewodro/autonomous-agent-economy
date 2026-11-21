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

import { paintCaveFloor } from '../web/dist/world/cave-art.js';
import { CAVE_LEVELS } from '../service/cave-layout.js';

test('cave floors are painted with clustered pixel scenery and depth-specific palettes', () => {
  const paint = level => {
    const config = CAVE_LEVELS[level - 1];
    const colors = [];
    const c = { fillStyle: '', fillRect() { colors.push(this.fillStyle); } };
    paintCaveFloor(c, {
      level, bounds: config.bounds, rooms: config.rooms, torches: config.torches,
      props: config.props, descent: config.descent, exit: config.exit,
    });
    return colors;
  };
  const entrance = paint(1), deep = paint(3);
  assert.ok(entrance.length > 500, 'the entrance floor is detailed rather than a flat rectangle');
  assert.ok(deep.length > 500, 'the deep floor is detailed too');
  assert.ok(entrance.includes('#6c5137'), 'entrance uses warm wooden supports');
  assert.ok(deep.includes('#9adbe6'), 'deep floor uses bright crystal accents');
  assert.notDeepEqual(entrance, deep, 'depth levels do not share one identical painting');
});
