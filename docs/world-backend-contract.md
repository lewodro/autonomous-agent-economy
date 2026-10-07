# World backend contract

The pixel world is a presentation client. It may interpolate movement and open panels, but it never decides game outcomes, table legality, payments, or agent authority.

## Transport

World presence uses JSON HTTP commands plus a read-only SSE stream. This matches the existing live match transport and needs no additional runtime dependency.

Movement is capped at one accepted update per 66 ms (about 15 updates/second). Clients should interpolate between `PlayerMoved` positions rather than sending every rendered frame. Presence is ephemeral: it expires after 45 seconds without a heartbeat and is never match or wallet authority.

## Presence

| Operation | Request | Result |
| --- | --- | --- |
| `POST /api/worlds/main/presence/join` | `{ player_id?, avatar?, position, direction?, activity? }` | Snapshot, server/player ID, opaque `session_token` |
| `GET /api/worlds/main/presence` | none | Current public player snapshot |
| `GET /api/worlds/main/presence/events` | SSE | `WorldJoined`, `PlayerJoined`, `PlayerMoved`, `PlayerUpdated`, `PlayerLeft` |
| `POST /api/worlds/main/presence/move` | `{ player_id, session_token, position, direction, animation_state }` | Accepted public player state |
| `POST /api/worlds/main/presence/heartbeat` | `{ player_id, session_token, activity? }` | Updated player state |
| `POST /api/worlds/main/presence/leave` | `{ player_id, session_token }` | `{ left: true }` |

`session_token` is an opaque browser-session capability and must never be rendered, logged, or treated as an account credential. The server validates coordinates, bounds, speed, and update frequency. Current world bounds are `0..1040 × 0..864`.

## Arena directory and spectators

`GET /api/arena/rooms` returns bounded RPS and tic-tac-toe agent rooms. Each room includes `id`, `game`, `status`, `phase`, `runId`, `matchId`, agent participants, `spectators`, and `url`. The directory is backend-derived; the world must not invent room states.

`GET /api/arena/rooms/:roomId`, `/api/arena/agents`, `/api/arena/history`, and `/api/arena/logs/:runId` are read-only. Existing match pages remain the spectator source of truth. A world visitor who enters an arena should update only their presence activity to `Watching rps-1` (or another room ID); it must not step a simulation.

## Free human tables

The initial table is `table-ttt-main`. A player must first have a valid presence session.

| Operation | Endpoint |
| --- | --- |
| List tables | `GET /api/tables` |
| Sit / leave | `POST /api/tables/table-ttt-main/sit` or `/leave` |
| Ready | `POST /api/tables/table-ttt-main/ready` |
| Move | `POST /api/tables/table-ttt-main/move` |

Every table command includes `player_id` and `session_token`. A move also requires `{ cell: 0..8, move_id }`. `move_id` makes retrying the same browser request idempotent. The server owns seats, turn order, legal cells, and final outcome. Typical errors: `TABLE_OCCUPIED`, `NOT_SEATED`, `MATCH_ALREADY_STARTED`, `INVALID_MOVE`, and `MATCH_NOT_PLAYING`.

## Devnet predictions

Predictions are deliberately not wired into the world yet. They are an experimental, Devnet-only domain model behind `PREDICTIONS_ENABLED=true`, `ENTRY_FEE_ENABLED=true`, and `ECONOMY_MODE=DEVNET`. They require a verified receipt through the existing payment rail and a trusted match-completion attestation before resolution. The browser cannot submit a winner or transaction reference as proof.

The world should keep free watching and free play available whether or not a wallet exists. Any future panel must state **DEVNET · TEST SOL · NO REAL VALUE** and fail independently from the room UI.
