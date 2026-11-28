import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSHES, CAMPFIRES, EXPLORATION_SITES, FLOWER_BEDS, GROUND_PROPS, MARKET_PROPS,
  NPC_WAYPOINTS, ROCKS, TREES, WALLS, WORLD_SITES, WORLD_SITE_CLEARANCE,
  canPlaceBush, canPlaceGroundProp, canPlaceFlower, canPlaceRock, collides,
  distanceToNpcRoute, groundPropRect, isNaturalGround, rockRect, treeCanopyRect, treeTrunkRect,
} from '../web/dist/world/map.js';

function intersects(a,b){
  return a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
}
function inflate(rect,pad){
  return {x:rect.x-pad,y:rect.y-pad,width:rect.width+pad*2,height:rect.height+pad*2};
}
function distance(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

test('generated rocks never sit on a trunk, under a crown, or on top of another rock',()=>{
  assert.ok(ROCKS.length>=100,'the world keeps a healthy population of stones');
  for(const rock of ROCKS){
    assert.equal(canPlaceRock(rock),true,`rock ${JSON.stringify(rock)} must satisfy every placement rule`);
    const footprint=inflate(rockRect(rock),3);
    for(const tree of TREES){
      assert.equal(intersects(footprint,inflate(treeTrunkRect(tree),3)),false,
        `rock ${JSON.stringify(rock)} must not touch the trunk of ${JSON.stringify(tree)}`);
      assert.equal(intersects(footprint,treeCanopyRect(tree)),false,
        `rock ${JSON.stringify(rock)} must not sit under the crown of ${JSON.stringify(tree)}`);
    }
  }
  for(let index=0;index<ROCKS.length;index++)for(let other=index+1;other<ROCKS.length;other++){
    assert.ok(distance(ROCKS[index],ROCKS[other])>=42,'stones keep a deterministic minimum spacing');
  }
  // Exclusion must not erase the natural look: stones still frame the woods.
  assert.ok(ROCKS.some(rock=>TREES.some(tree=>distance(rock,tree)<100)),
    'a stone may still sit beside a tree, just never inside it');
});

test('rocks stay off roads, buildings, sites, camps, props, routes and landmark circles',()=>{
  for(const rock of ROCKS){
    assert.equal(isNaturalGround(rock,16),true,'stone body stays clear of paths and buildings');
    assert.ok(WORLD_SITES.every(site=>distance(rock,site)>=WORLD_SITE_CLEARANCE-8),'farm and resource ground stays clear');
    assert.ok(CAMPFIRES.every(fire=>distance(rock,fire)>=82),'camp clearings stay open');
    assert.ok(NPC_WAYPOINTS.every(point=>distance(rock,point)>=48),'NPC routes stay walkable');
    assert.ok(distanceToNpcRoute(rock)>=30,'stones stay off the whole NPC route, not just its waypoints');
    assert.ok(MARKET_PROPS.every(prop=>distance(rock,prop)>=42),'market props keep their apron');
    assert.ok(EXPLORATION_SITES.every(site=>distance(rock,site.position)>site.radius+44),'caves, ruins and shrines stay clear');
    assert.equal(collides({x:rock.x,y:rock.y}),true,'rock bodies remain solid map obstacles');
    assert.ok(WALLS.some(wall=>wall.x===rock.x-12&&wall.y===rock.y-8&&wall.width===24&&wall.height===16),
      'collision mask matches the painted rock body');
  }
});

test('bushes and flower beds use the same trunk-aware spacing rules',()=>{
  assert.ok(BUSHES.length>=120,'the outer fringe keeps dense low planting');
  for(const bush of BUSHES){
    assert.equal(canPlaceBush(bush),true);
    const footprint=inflate({x:bush.x-13,y:bush.y-13,width:26,height:26},2);
    assert.ok(TREES.every(tree=>!intersects(footprint,inflate(treeTrunkRect(tree),2))),
      'a bush cannot grow through a tree trunk');
  }
  for(let index=0;index<BUSHES.length;index++)for(let other=index+1;other<BUSHES.length;other++){
    assert.ok(distance(BUSHES[index],BUSHES[other])>=24,'bushes keep a minimum spacing');
  }
  for(const bed of FLOWER_BEDS)assert.equal(canPlaceFlower({x:bed.x+bed.width/2,y:bed.y+bed.height/2}),true);
  assert.ok(FLOWER_BEDS.length>=30);
});

test('small scenery is deterministic, varied, and shares the decoration exclusions',async()=>{
  assert.ok(GROUND_PROPS.length>=120,'logs, stumps, mushrooms, pebbles and ferns fill the open ground');
  assert.deepEqual(new Set(GROUND_PROPS.map(prop=>prop.kind)),new Set(['log','stump','mushroom','pebbles','fern']));
  assert.ok(new Set(GROUND_PROPS.map(prop=>prop.flip)).size===2,'mirrored props break up repetition');
  for(const prop of GROUND_PROPS){
    assert.equal(canPlaceGroundProp(prop),true);
    const footprint=inflate(groundPropRect(prop),4);
    assert.ok(ROCKS.every(rock=>!intersects(footprint,rockRect(rock))),'small props never overlap stones');
    assert.ok(TREES.every(tree=>!intersects(footprint,inflate(treeTrunkRect(tree),6))),'small props never overlap trunks');
    assert.ok(distanceToNpcRoute(prop)>=32,'small props stay off the walking route');
  }
  for(let index=0;index<GROUND_PROPS.length;index++)for(let other=index+1;other<GROUND_PROPS.length;other++){
    assert.ok(distance(GROUND_PROPS[index],GROUND_PROPS[other])>=64,'small props keep a minimum spacing');
  }
  // A fresh module instance must reproduce the same world for every visitor.
  const fresh=await import('../web/dist/world/map.js?decoration-check');
  assert.deepEqual(fresh.ROCKS,ROCKS);
  assert.deepEqual(fresh.GROUND_PROPS,GROUND_PROPS);
});
