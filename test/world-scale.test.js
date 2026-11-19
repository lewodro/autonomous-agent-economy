import test from 'node:test';
import assert from 'node:assert/strict';
import { FARM_GUIDANCE_RADIUS, WORLD_UNITS_PER_METER, metersToWorldUnits, withinFarmGuidance } from '../web/dist/world/scale.js';

test('world distance uses one documented world-unit-to-metre conversion', () => {
  assert.equal(WORLD_UNITS_PER_METER, 16);
  assert.equal(metersToWorldUnits(20), 320);
  assert.equal(FARM_GUIDANCE_RADIUS, 320);
});

test('farm guidance appears inside 20m and disappears outside it', () => {
  const player = { x: 1000, y: 1000 };
  const at = distance => ({ x: player.x + metersToWorldUnits(distance), y: player.y });
  assert.equal(withinFarmGuidance(player, at(0)), true);
  assert.equal(withinFarmGuidance(player, at(19)), true, '19m is inside the range');
  assert.equal(withinFarmGuidance(player, at(21)), false, '21m must reveal no guidance');
  assert.equal(withinFarmGuidance(player, at(20.1)), false, 'the boundary is not rounded outward');
});
