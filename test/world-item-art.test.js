import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEM_ICON_IDS, drawEquipmentIcon, verifyEquipmentIcons } from '../web/dist/world/equipment-art.js';

const REQUIRED = [
  'wheat', 'carrot', 'pumpkin', 'herb', 'iron_ore', 'copper_ore', 'crystal',
  'wooden_sword', 'iron_sword', 'steel_sword', 'frostblade',
  'light_armor', 'wooden_shield', 'iron_shield', 'health_potion',
];

test('every requested item has an original 12x12 pixel sprite', () => {
  assert.equal(verifyEquipmentIcons(), true);
  for (const id of REQUIRED) assert.ok(ITEM_ICON_IDS.includes(id), `${id} needs its own artwork`);
});

test('item sprites have distinct silhouettes instead of shared placeholders', () => {
  const grids = new Map();
  // The matrices are validated on build; compare their raster signatures by
  // drawing each one into a tiny fake context and hashing opaque cell coords.
  for (const id of REQUIRED) {
    const cells = [];
    const context = { fillStyle: '', fillRect(x, y, w, h) { cells.push(`${x / 2},${y / 2}`); } };
    // drawEquipmentIcon uses scale 2 in the item HUD.
    drawEquipmentIcon(context, id, 2);
    grids.set(id, cells.join(';'));
  }
  for (const [id, signature] of grids) {
    assert.ok(signature.length > 12, `${id} must not be an empty icon`);
    for (const [other, otherSignature] of grids) {
      if (other !== id) assert.notEqual(signature, otherSignature, `${id} and ${other} must look different`);
    }
  }
});
