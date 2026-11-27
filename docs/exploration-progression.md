# Exploration rewards, equipment and Sword Duel

This document records how the connected adventure loop is wired together and
where future world expansions can attach without duplicating an economy or an
inventory.

## Discovery completion rewards

The browser journal still keeps its per-browser history, but reward-bearing
progress is owned by `WorldFarm` under the visitor/account key. The canonical
catalog lives in `src/world-discovery.js` and currently defines two groups:

| Group | Landmarks | Reward |
| --- | --- | --- |
| Wilderness Trails | 5 outer-world landmarks | 5 internal credits |
| Frostgate Ascent | 6 mountain landmarks | 5 internal credits |

A group pays only when every listed landmark has been reported for that
account. Reports are idempotent by `request_id`, the rewarded group ids are
persisted on the account, and settlement uses the existing farm ledger. A
refresh, a duplicate request, a second browser or a guest-to-account migration
cannot claim the same group twice. Adding a future group means adding one entry
to the catalog; no new table or reward path is needed.

## Equipment and prices

`src/world-equipment.js` is the single price and stat table. Items use the
existing farm inventory; `account.equipped` only records which owned item is in
the weapon or armor slot. Prices are in internal credits and never touch a
wallet, SOL balance or treasury transaction.

| Item | Price | Effect |
| --- | --- | --- |
| Wooden Sword | starter (free) | 12 damage, 62 reach |
| Iron Sword | 10 | 18 damage, 70 reach |
| Steel Sword | 30 | 24 damage, 74 reach |
| Frostblade | 70 | 30 damage, 82 reach |
| Light Armor | 25 | 25% less cave damage, +10 max HP |
| Health Potion | 8 | restores 45 HP inside a cave |

Completing both discovery groups yields exactly enough credits for the first Iron Sword upgrade.

Purchases, equips and potion use are server-authoritative idempotent commands.
The browser never supplies prices, ownership or stats.

## Cave combat integration

The cave route builds a bounded loadout from the account's owned, equipped gear
and passes it to `CaveService` as a server-issued value. Weapon damage and reach
feed hit resolution, armor mitigates monster damage and raises max HP, and a
potion is consumed through the farm ledger before the cave heals the player.
Deeper caves reward stronger play but the lower village and all ordinary routes
stay free to walk without gear.

## Frostgate follow-up

The current Frostgate mountain mobs (`web/src/world/frostgate-mobs.ts`) are a
client-side simulation, not an authoritative combat service. This branch does
not overwrite that unfinished work. When mountain encounters become
server-authoritative, they can reuse the cave loadout shape (`weapon`, `armor`,
`potion`) and the same `WorldFarm` settlement commands instead of inventing a
second inventory, currency or damage model.

## Sword Duel fairness

A duel reuses proximity challenges, the shared `/duel/<id>` route and the
spectator view. Combat constants in `src/sword-duel.js` are fixed for every
participant: 100 HP, 14 damage, 74 reach, 560 ms attack cooldown, 190 speed and
a 260 ms dodge with a 1.4 s cooldown. Marketplace equipment is deliberately
ignored inside a duel, so purchased gear cannot guarantee a win. Moves,
attacks, knockback, health and the winner are resolved on the server; spectators
receive the same read-only state.
