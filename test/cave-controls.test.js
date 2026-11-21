import test from 'node:test';
import assert from 'node:assert/strict';
import { caveActionFor } from '../web/dist/world/cave-controls.js';

test('desktop E prefers a chest, then a passage, then a nearby monster', () => {
  assert.equal(caveActionFor({ chest: true, exit: true, descent: true, monster: true }), 'chest');
  assert.equal(caveActionFor({ chest: false, exit: true, descent: true, monster: true }), 'exit');
  assert.equal(caveActionFor({ chest: false, exit: false, descent: true, monster: true }), 'descent');
  assert.equal(caveActionFor({ chest: false, exit: false, descent: false, monster: true }), 'attack');
  assert.equal(caveActionFor({ chest: false, exit: false, descent: false, monster: false }), 'none');
});

test('E strikes when no chest or passage is in reach', () => {
  assert.equal(caveActionFor({ chest: false, exit: false, descent: false, monster: true }), 'attack');
  assert.equal(caveActionFor({ chest: true, exit: false, descent: false, monster: true }), 'chest');
});
