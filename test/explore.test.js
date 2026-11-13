import test from 'node:test';
import assert from 'node:assert/strict';
import { CAMP_SITES, EXPLORATION_SITES, LANDMARKS, MAP, OUTER_CAMPS } from '../web/dist/world/map.js';
import {
  CITY_MAP_MARKERS, DISCOVERY_SITES, DISCOVERY_STORAGE_KEY, MINIMAP_HEIGHT, MINIMAP_WIDTH,
  discoveryGroups, loadDiscoveries, minimapMarkers, minimapPoint, nearbyHumans,
  parseDiscoveryList, regionAt, regionLabel, saveDiscoveries,
} from '../web/dist/world/explore.js';

function memoryStorage(initial = null) {
  const values = new Map();
  if (initial !== null) values.set(DISCOVERY_STORAGE_KEY, initial);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test('exploration sites and seeded camps form one deterministic discovery list', () => {
  assert.equal(CAMP_SITES.length, OUTER_CAMPS.length);
  assert.equal(CAMP_SITES.length, 8);
  assert.equal(DISCOVERY_SITES.length, EXPLORATION_SITES.length + CAMP_SITES.length);
  assert.equal(new Set(DISCOVERY_SITES.map(site => site.id)).size, DISCOVERY_SITES.length);
  assert.deepEqual(CAMP_SITES.map(site => site.id), [
    'camp-north-1', 'camp-north-2', 'camp-south-1', 'camp-south-2',
    'camp-west-1', 'camp-west-2', 'camp-east-1', 'camp-east-2',
  ]);
  for (const site of DISCOVERY_SITES) {
    assert.ok(site.label.length > 2, `${site.id} needs a readable journal name`);
    assert.equal(Number.isFinite(site.position.x) && Number.isFinite(site.position.y), true);
    assert.ok(LANDMARKS.some(landmark => landmark.id === site.id), `${site.id} must be interactable`);
  }
});

test('cave, ruin, shrine and camp prompts describe real contextual actions', () => {
  const prompts = new Map(LANDMARKS.filter(landmark => landmark.prompt).map(landmark => [landmark.id, landmark.prompt]));
  assert.equal(prompts.get('cave-north'), 'Enter cave');
  assert.equal(prompts.get('mossy-ruin'), 'Inspect ruins');
  assert.equal(prompts.get('sunken-shrine'), 'Visit shrine');
  assert.equal(prompts.get('camp-west-1'), 'Rest at camp');
});

test('discoveries persist per browser and ignore stale or duplicate ids', () => {
  assert.deepEqual(parseDiscoveryList(null), []);
  assert.deepEqual(parseDiscoveryList(['cave-north', 'unknown-site', 'cave-north', 7]), ['cave-north']);
  const storage = memoryStorage();
  assert.deepEqual(loadDiscoveries(storage), []);
  assert.deepEqual(saveDiscoveries(['cave-north', 'camp-east-2', 'camp-east-2'], storage), ['cave-north', 'camp-east-2']);
  assert.deepEqual(loadDiscoveries(storage), ['cave-north', 'camp-east-2']);
  const stale = memoryStorage(JSON.stringify(['not-real', 'sunken-shrine']));
  assert.deepEqual(loadDiscoveries(stale), ['sunken-shrine']);
  storage.setItem(DISCOVERY_STORAGE_KEY, '{broken');
  assert.deepEqual(loadDiscoveries(storage), []);
});

test('discovery journal groups stay compact and counts follow interactions', () => {
  const none = discoveryGroups(new Set());
  assert.deepEqual(none.map(group => group.label), ['CAVES', 'RUINS', 'SHRINES', 'CAMPS']);
  assert.deepEqual(none.map(group => group.total), [4, 2, 2, 8]);
  assert.deepEqual(none.map(group => group.discoveredCount), [0, 0, 0, 0]);
  const some = discoveryGroups(new Set(['cave-north', 'cave-east', 'mossy-ruin', 'camp-west-1']));
  assert.deepEqual(some.map(group => group.discoveredCount), [2, 1, 0, 1]);
  assert.equal(some[0].entries.find(entry => entry.id === 'cave-north')?.discovered, true);
  assert.equal(some[0].entries.find(entry => entry.id === 'cave-south')?.discovered, false);
});

test('region feedback uses the actual outer ring geography', () => {
  assert.equal(regionAt(MAP.spawn), 'city');
  assert.equal(regionLabel(MAP.spawn), 'CITY CENTER');
  assert.equal(regionAt({ x: -1400, y: 500 }), 'west');
  assert.equal(regionAt({ x: 3000, y: 500 }), 'east');
  assert.equal(regionAt({ x: 500, y: -1000 }), 'north');
  assert.equal(regionAt({ x: 500, y: 2100 }), 'south');
  assert.equal(regionLabel({ x: 3000, y: 500 }), 'EAST INDUSTRIAL');
});

test('minimap projection covers the world and hides undiscovered landmarks', () => {
  const topLeft = minimapPoint({ x: MAP.minX, y: MAP.minY });
  const bottomRight = minimapPoint({ x: MAP.maxX, y: MAP.maxY });
  assert.ok(topLeft.x >= 0 && topLeft.y >= 0);
  assert.ok(bottomRight.x <= MINIMAP_WIDTH && bottomRight.y <= MINIMAP_HEIGHT);
  const hidden = minimapMarkers(new Set());
  assert.deepEqual(hidden.map(marker => marker.id), CITY_MAP_MARKERS.map(marker => marker.id));
  assert.equal(hidden.some(marker => marker.kind === 'cave'), false);
  const found = minimapMarkers(new Set(['cave-north', 'camp-east-1']));
  assert.equal(found.filter(marker => marker.kind === 'cave').length, 1);
  assert.equal(found.filter(marker => marker.kind === 'camp').length, 1);
  assert.equal(found.length, CITY_MAP_MARKERS.length + 2);
});

test('minimap only plots nearby humans and never canonical agents', () => {
  const player = { x: 560, y: 480 };
  const humans = [{ x: 600, y: 500 }, { x: -1400, y: 200 }, { x: 560 + 900, y: 480 }];
  assert.deepEqual(nearbyHumans(player, humans), [{ x: 600, y: 500 }]);
});
