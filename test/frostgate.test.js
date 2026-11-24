import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SNOW_WORLD, SNOW_SPAWN, SNOW_RETURN, TERRACES, CLIFFS, CLIMB_STEPS, ELEVATION_LEVELS,
  SNOW_TRAIL, SNOW_WALK_SPEED, trailLength, climbAt,
  FROSTGATE_LANDMARKS, FROSTGATE_BUILDINGS, INTERIORS, SNOW_OBSTACLES,
  SNOW_PINES, SNOW_ROCKS, SNOW_SHRUBS, SNOW_ICE,
  terraceAt, elevationAt, cliffBlocks, interiorBlocks, buildingAt,
} from '../web/dist/world/frostgate.js';
import { DISCOVERY_SITES, minimapMarkers, parseDiscoveryList } from '../web/dist/world/explore.js';

test('Frostgate is a tall mountain whose surfaces stay chunk-safe', () => {
  assert.equal(SNOW_WORLD.width, 3600);
  assert.equal(SNOW_WORLD.height, 20000);
  assert.ok(SNOW_WORLD.width * SNOW_WORLD.height > 16_777_216, 'the region is far too tall for one canvas');
  assert.equal(600 * 1000 < 16_777_216, true, 'each rendered chunk is small');
  assert.ok(SNOW_WORLD.width % 600 === 0 && SNOW_WORLD.height % 1000 === 0, 'chunks tile without partial edges');
  assert.equal(SNOW_SPAWN.y > SNOW_WORLD.height * .95, true, 'the gate sits at the south edge');
  assert.equal(SNOW_RETURN.y > SNOW_SPAWN.y, true, 'the return gate is just south of the spawn');
  assert.equal(SNOW_WALK_SPEED, 150, 'mountain walking matches the green overworld pace');
});

test('the end-to-end switchback walk takes about ten minutes', () => {
  const seconds = trailLength() / SNOW_WALK_SPEED;
  const minutes = seconds / 60;
  assert.ok(minutes >= 8 && minutes <= 11, `the main trail should take roughly ten minutes, got ${minutes.toFixed(1)}`);
  assert.ok(SNOW_TRAIL.length >= 50, 'the trail has many switchbacks, not one straight road');
  // Consecutive crossings alternate sides, forcing real horizontal travel.
  let turns = 0;
  for (let index = 1; index < CLIFFS.length; index++) {
    const previous = (CLIFFS[index - 1].corridors[0].minX + CLIFFS[index - 1].corridors[0].maxX) / 2;
    const current = (CLIFFS[index].corridors[0].minX + CLIFFS[index].corridors[0].maxX) / 2;
    if (Math.abs(current - previous) > 1000) turns++;
  }
  assert.ok(turns >= 20, `the route should switch sides repeatedly, got ${turns}`);
});

test('five terraces rise northward and elevation is monotonic', () => {
  assert.equal(ELEVATION_LEVELS, 5);
  assert.deepEqual(TERRACES.map(terrace => terrace.elevation), [0, 1, 2, 3, 4]);
  assert.deepEqual(TERRACES.map(terrace => terrace.name), [
    'LOWER FROSTGATE', 'FROSTGATE VILLAGE', 'MOUNTAIN TRAIL', 'UPPER SNOWFIELD', 'SUMMIT OUTPOST',
  ]);
  for (let index = 1; index < TERRACES.length; index++) {
    assert.equal(TERRACES[index - 1].minY, TERRACES[index].maxY, 'terraces tile without gaps');
  }
  assert.equal(elevationAt(19000), 0);
  assert.equal(elevationAt(15000), 1);
  assert.equal(elevationAt(10000), 2);
  assert.equal(elevationAt(5000), 3);
  assert.equal(elevationAt(900), 4);
  for (let y = SNOW_WORLD.height - 100; y > 100; y -= 100) {
    assert.ok(elevationAt(y - 100) >= elevationAt(y), 'travelling north never lowers elevation');
  }
  assert.equal(terraceAt(16800).id, 'gate');
  assert.equal(terraceAt(16799).id, 'village');
});

test('cliff ridges block travel except through ramps, bridges and stairs', () => {
  assert.equal(CLIFFS.length, 28);
  assert.equal(CLIMB_STEPS, 28);
  assert.deepEqual(CLIFFS.slice(0, 5).map(cliff => cliff.y), [19600, 18900, 18200, 17500, 16800]);
  for (const cliff of CLIFFS) {
    assert.ok(cliff.corridors.length >= 1, `cliff ${cliff.y} needs a crossing`);
    for (const corridor of cliff.corridors) {
      const middle = (corridor.minX + corridor.maxX) / 2;
      assert.equal(cliffBlocks(middle, cliff.y), false, `${corridor.kind} at ${middle} must be walkable`);
      assert.equal(cliffBlocks(middle, cliff.y - 40), false);
      assert.equal(cliffBlocks(middle, cliff.y + 40), false);
    }
    const sideCorridor = cliff.corridors[0];
    const blockedX = sideCorridor.minX > 1000 ? 1500 : 1500;
    if (!cliff.corridors.some(corridor => corridor.minX <= blockedX && corridor.maxX >= blockedX)) {
      assert.equal(cliffBlocks(blockedX, cliff.y), true, `cliff ${cliff.y} must be solid outside its corridors`);
    }
  }
  assert.ok(CLIFFS.some(cliff => cliff.corridors.some(corridor => corridor.kind === 'stair')));
  assert.ok(CLIFFS.some(cliff => cliff.corridors.some(corridor => corridor.kind === 'switchback')));
  assert.equal(climbAt(SNOW_SPAWN.y), 0);
  assert.equal(climbAt(500), 28);
  assert.equal(climbAt(900), 27, 'the beacon sits above all but the final ridge');
  for (let y = SNOW_WORLD.height - 100; y > 100; y -= 100) assert.ok(climbAt(y - 100) >= climbAt(y));
});

test('seven discoveries spread from the village to the summit', () => {
  assert.equal(FROSTGATE_LANDMARKS.length, 7);
  assert.deepEqual(FROSTGATE_LANDMARKS.map(site => site.id), [
    'frostgate-village', 'frozen-shrine', 'frozen-lake', 'ice-bridge',
    'high-pass', 'frost-watchtower', 'summit-beacon',
  ]);
  assert.ok(FROSTGATE_LANDMARKS.every(site => site.radius >= 70 && site.note.length > 20));
  const bands = FROSTGATE_LANDMARKS.map(site => elevationAt(site.position.y));
  assert.deepEqual(bands, [1, 2, 2, 3, 3, 3, 4]);
  assert.equal(bands.at(-1), 4, 'the summit beacon is the highest discovery');
  const ids = FROSTGATE_LANDMARKS.map(site => site.id);
  for (const id of ids) {
    assert.ok(DISCOVERY_SITES.some(site => site.id === id && site.venue === 'snow'), `${id} shares the journal`);
    assert.ok(parseDiscoveryList([id]).includes(id), `${id} survives the shared discovery storage`);
  }
  assert.equal(minimapMarkers(new Set(ids)).length, minimapMarkers(new Set()).length, 'snow sites stay off the green-world minimap');
});

test('a compact village has enterable houses and an inspectable shop', () => {
  assert.equal(FROSTGATE_BUILDINGS.length, 7);
  const enterable = FROSTGATE_BUILDINGS.filter(building => building.enterable);
  assert.equal(enterable.length, 5);
  assert.ok(enterable.every(building => building.interior && INTERIORS[building.interior]));
  assert.ok(FROSTGATE_BUILDINGS.some(building => building.kind === 'shop' && !building.enterable), 'shops can be visual-only');
  assert.ok(FROSTGATE_BUILDINGS.some(building => building.kind === 'ruin'), 'an abandoned structure remains');
  const village = FROSTGATE_BUILDINGS.filter(building => elevationAt(building.y) === 1);
  assert.ok(village.length >= 4, 'the settlement is a handful of roofs, not a city');
  for (const building of FROSTGATE_BUILDINGS) {
    assert.ok(building.door.y >= building.y, 'each door is on the building side facing the trail');
    assert.equal(buildingAt(building.door.x, building.door.y)?.id, building.id);
  }
  assert.ok(SNOW_OBSTACLES.some(rect => rect.x === FROSTGATE_BUILDINGS[0].x), 'buildings share art and collision');
  assert.equal(SNOW_OBSTACLES.length, FROSTGATE_BUILDINGS.length + SNOW_ROCKS.length + SNOW_PINES.length + 3);
  assert.ok(SNOW_PINES.length >= 60 && SNOW_ROCKS.length >= 40 && SNOW_SHRUBS.length >= 60 && SNOW_ICE.length >= 30,
    'every section has authored snowy detail');
});

test('interiors are cozy reusable layouts with cheap fireplaces', () => {
  assert.equal(Object.keys(INTERIORS).length, 5);
  for (const interior of Object.values(INTERIORS)) {
    assert.ok(interior.width <= 480 && interior.height <= 320, 'interiors stay small');
    assert.equal(interiorBlocks(interior, interior.entry.x, interior.entry.y), false, 'entry is clear');
    assert.equal(interiorBlocks(interior, interior.exit.x, interior.exit.y), false, 'exit is clear');
    assert.ok(interior.props.some(prop => prop.kind === 'rug' || prop.kind === 'shelf' || prop.kind === 'bed'));
    assert.ok(interior.props.some(prop => prop.kind === 'window'));
    if (interior.fireplace) assert.ok(interior.props.some(prop => prop.kind === 'fireplace'));
  }
  assert.deepEqual(Object.values(INTERIORS).filter(interior => interior.fireplace).map(interior => interior.id),
    ['hall', 'cottage', 'watch']);
  assert.equal(interiorBlocks(INTERIORS.hall, 220, 71), true, 'the hall fireplace blocks walking');
});
