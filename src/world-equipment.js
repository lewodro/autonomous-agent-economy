/**
 * The one price and stat table for adventuring equipment.
 *
 * Equipment lives in the existing farm inventory; this catalog only describes
 * items and their server-owned effects. Nothing here touches wallets, SOL or
 * the treasury. Competitive Arena matches deliberately ignore these stats.
 */
export const EQUIPMENT_SLOTS = Object.freeze(['weapon', 'armor']);

export const EQUIPMENT = Object.freeze({
  wooden_sword: Object.freeze({
    id: 'wooden_sword', name: 'Wooden Sword', slot: 'weapon', price: 0, starter: true,
    description: 'A blunt practice blade. Every visitor starts with one.',
    damage: 12, range: 62,
  }),
  iron_sword: Object.freeze({
    id: 'iron_sword', name: 'Iron Sword', slot: 'weapon', price: 10,
    description: 'A dependable edge for the first caves.',
    damage: 18, range: 70,
  }),
  steel_sword: Object.freeze({
    id: 'steel_sword', name: 'Steel Sword', slot: 'weapon', price: 30,
    description: 'Balanced steel that bites through deeper shells.',
    damage: 24, range: 74,
  }),
  frostblade: Object.freeze({
    id: 'frostblade', name: 'Frostblade', slot: 'weapon', price: 70,
    description: 'A cold, bright blade found beyond the snow line.',
    damage: 30, range: 82,
  }),
  light_armor: Object.freeze({
    id: 'light_armor', name: 'Light Armor', slot: 'armor', price: 25,
    description: 'Quiet padded leather that softens every hit.',
    mitigation: 0.25, bonus_hp: 10,
  }),
  health_potion: Object.freeze({
    id: 'health_potion', name: 'Health Potion', slot: 'consumable', price: 8,
    description: 'A single swig that restores health inside a cave.',
    heal: 45,
  }),
});

export const EQUIPMENT_IDS = Object.freeze(Object.keys(EQUIPMENT));
export const STARTER_EQUIPMENT = Object.freeze({ weapon: 'wooden_sword', armor: null });

export function publicEquipmentCatalog() {
  return EQUIPMENT_IDS.map(id => ({ ...EQUIPMENT[id] }));
}

/** Only equipped, owned items count; the browser cannot supply its own stats. */
export function equipmentLoadout(inventory, equipped) {
  const loadout = {
    weapon: { ...EQUIPMENT.wooden_sword },
    armor: null,
    potion: { ...EQUIPMENT.health_potion, available: 0 },
  };
  const weaponId = equipped?.weapon;
  const weapon = weaponId && EQUIPMENT[weaponId]?.slot === 'weapon' && (inventory?.[weaponId] || 0) > 0 ? EQUIPMENT[weaponId] : null;
  if (weapon) loadout.weapon = { ...weapon };
  const armorId = equipped?.armor;
  const armor = armorId && EQUIPMENT[armorId]?.slot === 'armor' && (inventory?.[armorId] || 0) > 0 ? EQUIPMENT[armorId] : null;
  if (armor) loadout.armor = { ...armor };
  loadout.potion.available = Math.max(0, Math.floor(inventory?.health_potion || 0));
  return loadout;
}
