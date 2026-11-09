# Persistence and restart boundaries

Production uses Postgres whenever `DATABASE_URL` is configured. Local and offline
development use atomic JSON files below `MATCHES_DIR` so no database is required.
The two implementations expose the same service boundaries; Postgres is the
authoritative production source and a clean Render filesystem is not a reset.

## State map

| Domain | Classification | Production source of truth | Local fallback |
|---|---|---|---|
| Last Seat users and Clerk ownership | durable | `world_state/main` | `world/world-farm.json` |
| Verified wallet links and challenges | durable | `world_state/main` | `world/world-farm.json` |
| Farm level, plots and crop timestamps | durable | `world_state/main` | `world/world-farm.json` |
| Inventory, internal credits and market ledger | durable | `world_state/main` | `world/world-farm.json` |
| Resource receipts and world economy state | durable | `world_state/world-economy` | `world-economy/world-economy.json` |
| Arena cumulative statistics | durable | `world_state/arena-stats` | `world/arena-stats.json` |
| RPS and Tic-Tac-Toe verified checkpoints | durable | `durable_state/arena-rooms` | `arena/*.json` |
| Survival results, research and evidence | durable | `durable_state/arena-survival` | `arena/survival.json` |
| Shared replay archives | durable | `durable_state/replays` | root replay JSON files |
| Private experiment metadata and checkpoints | durable and owner-isolated | `durable_state/experiments` and `experiment-sessions` | `experiments/` and `sessions/` |
| Private custom Arena state | durable and owner-isolated | per-owner `durable_state/private-*` namespaces | `private-arena/` |
| Completed Compound results and agent evidence | durable | `durable_state/compound-history` | `compound/compound.json` |
| Compound active round | ephemeral checkpoint | process memory / replaceable scratch | `compound/compound.json` |
| Treasury events | durable | `world_state/treasury-ledger` | `world/treasury-ledger.json` |
| Payout requests | durable, execution disabled | `world_state/main` | `world/world-farm.json` |
| Human/agent positions, input and animation | ephemeral | process memory | none |
| Presence heartbeat and spectator connections | ephemeral | process memory | none |
| Active world table and scheduler timers | ephemeral | process memory / replaceable scratch | `world/table.json` |
| Local funded-lab journals and developer keys | operator-local only | `ECONOMY_DIR` | `ECONOMY_DIR` |

No movement frame is written to Postgres. Only meaningful checkpoints, settled
results, ownership changes, receipts and ledgers cross the durable boundary.

## Durable record collections

`service/durable-state.js` stores independently keyed JSON documents in the
`durable_state` table under a `(namespace, record_id)` primary key. Writes are
serialized and use an upsert. Bounded identifiers prevent path/namespace injection.
Services still validate their own record schema before exposing recovered data.

On the first Postgres boot after this migration, a service looks for its legacy
JSON record only when no matching database row exists. The importer uses
`ON CONFLICT DO NOTHING`, so restarts and retries cannot duplicate or replace a
record already accepted by Postgres. Legacy files are not deleted automatically.
Back them up, verify database recovery, and remove them only as an explicit operator
action.

## Match checkpoints

Private session checkpoints contain Rust-verifiable event history and inference
budget reservations, never credentials or private keys. The service restores and
verifies checkpoints before accepting requests. Corrupt records fail startup rather
than silently resetting a match or spending budget.

Each model reservation is checkpointed before its provider request. Each resolved
turn is checkpointed before acknowledging the transition. A crash can replay an
unacknowledged turn from the last valid checkpoint; already reserved inference stays
charged. This is conservative accounting, not exactly-once provider execution.

Arena and Survival retain bounded verified histories used by Research House and the
cumulative statistics document. Match IDs and evidence references continue resolving
after a deployment because both the source checkpoint and the derived cumulative
record are durable.

## Compound boundary

Compound deliberately separates the live simulation from historical truth. Positions,
held input, routine timers and current chases remain in process memory (with an optional
local scratch checkpoint). A completed round writes one bounded history document with
results, evidence event IDs and canonical-agent memories. This avoids database writes
at the 20 Hz movement tick while preserving completed outcomes across deployments.

## Render operation

With `DATABASE_URL`, `MATCHES_DIR` is still an absolute writable scratch path used for
active simulations and legacy import discovery. It does **not** need a persistent disk.
Render may replace it during deploy; durable ownership and history reload from Postgres.

Without `DATABASE_URL`, JSON files remain authoritative and `MATCHES_DIR` must be on a
persistent disk. File-only production keeps the bootstrap marker guard so an unmarked
developer directory cannot silently become public data.
