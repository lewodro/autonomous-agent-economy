# World backend contract

The browser world is a presentation and presence layer. The server owns player sessions, arena room state, table turns, verified results, and research statistics. Presence is ephemeral; match and table checkpoints are durable.

## Presence API

Presence uses JSON HTTP commands and a read-only SSE stream. Accepted movement is capped at one update per 66 ms (about 15 updates/second); the client should interpolate between updates. Heartbeats are capped at one per second, and unchanged heartbeat activity is not broadcast. Each world accepts up to 100 concurrent SSE viewers. Sessions expire after 45 seconds without a heartbeat. The session token is an opaque capability and must stay in session storage, never in URLs or logs.

| Operation | Endpoint | Request / result |
| --- | --- | --- |
| Join | `POST /api/worlds/:world/presence/join` | `{ player_id?, avatar?, position, direction?, activity? }`; returns snapshot, server ID, and `session_token` |
| Snapshot | `GET /api/worlds/:world/presence` | Current public players, without tokens |
| Subscribe | `GET /api/worlds/:world/presence/events` | SSE events: `WorldJoined`, `PlayerJoined`, `PlayerMoved`, `PlayerUpdated`, `PlayerLeft` |
| Move | `POST /api/worlds/:world/presence/move` | `{ player_id, session_token, position, direction, animation_state }` |
| Heartbeat | `POST /api/worlds/:world/presence/heartbeat` | `{ player_id, session_token, activity? }` |
| Leave | `POST /api/worlds/:world/presence/leave` | `{ player_id, session_token }` |

Only configured world IDs are accepted; the public deployment currently configures `main`, so arbitrary valid-looking IDs cannot allocate process-local maps. Player IDs are also validated. Positions are bounded to `0..1040 × 0..864`; movement speed and request frequency are limited. Presence does not decide or persist game state. It is process-local, so production must run one application instance until a shared ephemeral presence store is added.

`GET /api/health` reports presence status, active player/stream counts, configured-world count, and capacity limits. It exposes no player IDs or session capabilities; the mode is explicitly identified as single-process ephemeral.

## Arena and research

| Endpoint | Authority |
| --- | --- |
| `GET /api/arena/rooms` | Current shared room status, phase, pairing, and spectator count |
| `GET /api/arena/rooms/:roomId` | Read-only current room snapshot |
| `POST /api/arena/rooms/:roomId/spectators/join` | Create or resume a room-scoped spectator lease; returns an opaque `spectator_token` |
| `POST /api/arena/rooms/:roomId/spectators/heartbeat` | Renew `{ spectator_id, spectator_token }`; send no faster than once per second |
| `POST /api/arena/rooms/:roomId/spectators/leave` | End `{ spectator_id, spectator_token }` lease |
| `GET /api/arena/agents` | Profiles and statistics derived from verified retained runs |
| `GET /api/arena/statistics` | Aggregates computed from the same verified retained ledgers |
| `GET /api/arena/history` | Recent completed matches |
| `GET /api/arena/logs/:runId` | Download a retained verified run ledger |

Room IDs are bounded to the configured RPS and Tic-Tac-Toe slots. Spectator counts come from explicit ephemeral room leases, not client-provided activity labels; leases expire after 45 seconds and are capped at 100 per room / 500 total. Spectators receive the shared room; joining never creates or advances another simulation. Retained statistics are not a claim of all-time totals.

## Free plaza table

The durable table API is `GET /api/world/table`, plus `POST /api/world/table/join`, `/leave`, `/start`, and `/move`. The server issues an HttpOnly `world_visitor` cookie; browser code does not submit an identity or winner. Join accepts `{ mode: "human" | "npc" }`; a move accepts `{ cell: 0..8, revision }`. The revision rejects stale concurrent moves. Existing Tic-Tac-Toe rules verify the final board.

The earlier in-memory table-session prototype is intentionally not mounted. There is one table authority and one set of table routes.

## Predictions

`DevnetPredictions` remains a domain-model experiment only. It has no public API and does not submit or settle payments. Any future route must use the existing payment rail and trusted completion attestation, reject mainnet, and preserve free spectator/play paths.
