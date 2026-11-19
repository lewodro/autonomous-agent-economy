# First enterable cave

The first cave is a small, per-visitor dungeon reached through any discovered
cave mouth on the outer loop. It is a frontend/game-feel extension of the
shared world: no new database tables, no auth, wallet, treasury or Arena
statistics changes.

## Where state lives

| State | Owner | Lifetime |
| --- | --- | --- |
| Cave run, level, position, health, monsters, attack idempotency | `service/world-cave.js` (in memory) | Per visitor, per run; discarded after `CAVE_RESET_MS` |
| Level geometry, torches, props, base monster anchors | `service/cave-layout.js`, served by `GET /api/world/cave/config` | Deterministic, static |
| Internal credit loss and cave rewards | `WorldFarm` ledger and `WorldEconomy` receipts | Durable, idempotent by run/monster key |
| Saved exterior position | Existing localStorage settings | Per visitor, same as other venues |

Cave state is **per visitor and per run**. Monsters are never shared between
visitors, and no high-frequency combat state is written to Postgres. A base
monster stays dead for the active run; when a run has been inactive for
`CAVE_RESET_MS = 7 * 60 * 1000` the next entry creates a fresh run with the
base monsters respawned. Reset uses timestamps, not background timers.

## Authority

The browser sends movement, attack, descent and exit intents. The server owns
position, health, monster health, range checks, damage, death and rewards:

- `POST /api/world/cave/start` begins or resumes a run at the saved exterior.
- `POST /api/world/cave/move` is range- and wall-checked against the shared
  geometry; it cannot teleport or cross rock.
- `POST /api/world/cave/attack` requires a request ID. Duplicates replay the
  original result without applying damage twice; dead monsters cannot grant a
  second reward.
- `POST /api/world/cave/descend` requires standing at the passage.
- `POST /api/world/cave/exit` ends the run and returns the saved exterior.

`GET /api/world/cave` is a read-only snapshot. No visitor UUID, credential or
hidden encounter state is included in public responses.

## Credits and return paths

Entering shows an explicit `DANGEROUS AREA` warning. A normal exit returns to
the exact exterior coordinate and removes no credits. Defeat ends the run,
returns the visitor to the main plaza, and forfeits all **internal test game
credits** exactly once through `cave_defeat` ledger/receipt entries. Wallet
balances, SOL, treasury reserve and payout balances are never read, debited or
credited by cave code.

## Lighting

The cave canvas is a bounded 480×360 pixel viewport. One small darkness mask
uses soft radial holes around the visitor and each torch. Ambient darkness
increases on deeper levels; torch flicker is bounded and disabled under
`prefers-reduced-motion`. There is no permanent particle system or real-time
lighting engine.

## Distance scale

`web/src/world/scale.ts` is the single conversion: 16 world units = 1 in-world
metre (a 32-unit tile reads as two metres). Contextual farm guidance uses the
same helper and only appears within 20 metres; the farm itself stays on the
known minimap.
