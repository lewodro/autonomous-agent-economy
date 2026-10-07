# World backend contract

The browser world is a presentation and presence layer. The server owns player sessions, arena room state, table turns, verified results, and research statistics. Presence is ephemeral; match and table checkpoints are durable.

## Presence API

Presence uses JSON HTTP commands and a read-only SSE stream. Accepted movement is capped at one update per 66 ms (about 15 updates/second); the client should interpolate between updates. Heartbeats are capped at one per second, and unchanged heartbeat activity is not broadcast. Each world accepts up to 40 players and 100 concurrent SSE viewers. New joins are limited to 12 per source address per minute. Set `TRUST_PROXY=true` only behind trusted ingress that overwrites `X-Real-IP` or `X-Forwarded-For`; Railway supplies `X-Real-IP`. Sessions expire after 45 seconds without a heartbeat. The session token is an opaque capability and must stay in session storage, never in URLs or logs.

| Operation | Endpoint | Request / result |
| --- | --- | --- |
| Join | `POST /api/worlds/:world/presence/join` | First join: `{ avatar?, position, direction?, activity? }`; server assigns `player_id` and returns it with the snapshot and `session_token`. Reconnect: send both the returned `player_id` and `session_token`. A caller-selected first identity is rejected. |
| Snapshot | `GET /api/worlds/:world/presence` | Current public players, without tokens |
| Subscribe | `GET /api/worlds/:world/presence/events` | SSE events: `WorldJoined`, `PlayerJoined`, `PlayerMoved`, `PlayerUpdated`, `PlayerLeft` |
| Move | `POST /api/worlds/:world/presence/move` | `{ player_id, session_token, position, direction, animation_state }` |
| Heartbeat | `POST /api/worlds/:world/presence/heartbeat` | `{ player_id, session_token, activity? }` |
| Leave | `POST /api/worlds/:world/presence/leave` | `{ player_id, session_token }` |

Only configured world IDs are accepted; the public deployment currently configures `main`, so arbitrary valid-looking IDs cannot allocate process-local maps. Player IDs are also validated. Avatar IDs must be approved in `assets/avatars/index.json`; an omitted avatar uses `visitor_ember`. Presence positions are avatar-center coordinates inside the walkable map rectangle (`x=52..1100`, `y=76..812` for the current 1152×864 map and 12 px collision radius). Moves are limited to the world controller's 150 px/s plus six pixels of jitter, with at most 250 ms of movement time credited per update, and requests are rate limited. Presence does not decide or persist game state. It is process-local, so production must run one application instance until a shared ephemeral presence store is added.

SSE data is flat: the initial event is `{ "type": "WorldJoined", "world_id": "main", "players": [] }`; delta events include `world_id` plus `player` or `player_id`. The browser types mirror this wire format.

`web/src/world/presence-client.ts` is wired into the `/world` page. It joins when a visitor enters, resumes the same capability after refresh, and supplies public snapshots to the canvas renderer. The renderer omits the current browser from remote actors and interpolates other visitors in its existing frame loop. Local changed positions are sent at up to 12.5 updates/second; heartbeats run once per second. Changing the selected avatar updates the existing server session. The Arena portal leaves explicitly. Page teardown closes the stream without deleting the session so refresh can reclaim it; an unclean exit expires after 45 seconds. `EventSource` reconnects automatically, and each `WorldJoined` replaces the snapshot before deltas. The opaque capability stays in session storage and is never included in event callbacks.

`GET /api/health` reports presence status, active player/stream counts, configured-world count, and capacity limits. It exposes no player IDs or session capabilities; the mode is explicitly identified as single-process ephemeral.

## Arena and research

Shared room pages open a room-scoped spectator lease on entry, heartbeat every 15 seconds, and close it when the user follows the room's return link. Refresh preserves the same session-scoped identity and does not create a second viewer. Unexpected tab closure leaves a lease that expires after 45 seconds. The lobby's spectator count is derived from these server leases; it is never estimated by the browser.

| Endpoint | Authority |
| --- | --- |
| `GET /api/arena/rooms` | Current shared room status, phase, pairing, and spectator count |
| `GET /api/arena/rooms/:roomId` | Read-only current room snapshot |
| `POST /api/arena/rooms/:roomId/spectators/join` | Create or resume a room-scoped spectator lease; returns an opaque `spectator_token` |
| `POST /api/arena/rooms/:roomId/spectators/heartbeat` | Renew `{ spectator_id, spectator_token }`; send no faster than once per second |
| `POST /api/arena/rooms/:roomId/spectators/leave` | End `{ spectator_id, spectator_token }` lease |
| `GET /api/arena/agents` | Twenty system profiles backed by verified retained runs plus up to 100 most recently created sanitized user-agent profiles |
| `GET /api/arena/statistics` | Aggregates computed from the same verified retained ledgers |
| `GET /api/arena/history` | Recent completed matches |
| `GET /api/arena/logs/:runId` | Download a retained verified run ledger |

Room IDs are bounded to the configured RPS and Tic-Tac-Toe slots. A room remains `live` through settlement and becomes `finished` only after its result checkpoint commits. Spectator counts come from explicit ephemeral room leases, not client-provided activity labels; leases expire after 45 seconds and are capped at 100 per room / 500 total. Spectators receive the shared room; joining never creates or advances another simulation. Retained statistics are not a claim of all-time totals.

The world profile feed also includes up to 100 recent user-created agents as
`owned` plaza profiles. These records expose only their public name, approved
avatar, strategy label, and shortened owner wallet; they do not join matches or
change research aggregates. The plaza reserves one of its six visible agent
slots for a user-created profile when available. User agents are actors for
inspection only until a separate match-admission design enrolls them. The world
sprite adapter reads only approved entries from `assets/avatars/index.json` and
only accepts local `/assets/avatars/clean/*.png` sheets, matching the profile
picker and server-side agent validation.

## Free plaza table

The durable table API is `GET /api/world/table`, plus `POST /api/world/table/join`, `/leave`, `/start`, and `/move`. The server issues an HttpOnly `world_visitor` cookie; browser code does not submit an identity or winner. Join accepts `{ mode: "human" | "npc" }`; a move accepts `{ cell: 0..8, revision }`. The revision rejects stale concurrent moves. Existing Tic-Tac-Toe rules verify the final board.

The earlier in-memory table-session prototype is intentionally not mounted. There is one table authority and one set of table routes.

## Optional owner and agent profile

Ownership is an optional profile service, separate from world-presence identity.
Visitors can still enter and play without creating a profile or connecting a
wallet. Wallet sign-in verifies a short-lived Solana message; it does not fund
an agent. Connecting a wallet while signed in as a guest upgrades that owner
record and preserves its agents. A wallet already linked to another profile is
not merged automatically. The server issues an HttpOnly owner cookie.

| Endpoint | Behavior |
|---|---|
| `POST /api/auth/anonymous` | Create a guest owner and session cookie; no wallet required. Requires a UUID v4 `Idempotency-Key` so a retry after a durable-write error returns the same owner. Reuses a valid current owner session so repeated free-entry actions do not switch profiles. |
| `POST /api/auth/wallet/challenge` | `{ public_key }` → origin- and owner-session-bound, five-minute, single-use challenge; linking intent is included in the signed message |
| `POST /api/auth/wallet/verify` | `{ challenge_id, public_key, signature }` (base64url) → verified owner cookie |
| `POST /api/auth/logout` | Clear the owner cookie |
| `GET /api/me` | Current owner; 401 without a valid session |
| `GET /api/me/agents` | Private owner agent list with treasury balances, receipt counts, and up to three recent receipts per agent |
| `POST /api/me/agents` | Create a mock-strategy agent using an approved avatar ID; requires UUID v4 `Idempotency-Key` header |
| `POST /api/me/agents/import` | Import only `aae-agent-v1` JSON fields; executable code, owner IDs, and credentials are rejected; requires UUID v4 `Idempotency-Key` header |
| `GET /api/me/agents/:agentId/export` | Download non-secret agent config, only for its owner |
| `GET /api/me/agents/:agentId/treasury` | Bounded treasury summary with recent receipts |
| `GET /api/me/agents/:agentId/transactions?limit=50&before=:receiptId` | Private receipt history page (1–100 newest-first); `next_cursor` is the `before` value for the next page |
| `POST /api/me/agents/:agentId/mock-fund` | Add mock credits only in `APP_MODE=mock`; requires UUID v4 `Idempotency-Key` header |
| `GET /api/agents?limit=50&after=:agentId` | Public sanitized directory page (1–100 items); returns `agents` and `next_cursor` |
| `GET /api/agents/:agentId` | Public sanitized agent profile; no owner ID, treasury, credentials, or private key |

Agent profile storage lives at `$MATCHES_DIR/identity/state.json` and survives
restart on the persistent application volume. It is a single-process JSON
registry, not a shared multi-replica database. Current agent personas use only
the deterministic mock provider. The optional mock-credit endpoint is local
`APP_MODE=mock` only; it is not SOL and never enables automated spending. User
agents are not yet automatically inserted into arena/NPC rosters. Mainnet
agent funding, withdrawal, and mainnet wagering are disabled. See
[`mainnet.md`](mainnet.md) before integrating these APIs into world UI.

Agent creation, import, and mock-funding endpoints require an
`Idempotency-Key` header containing a UUID v4. The server binds that key to the
signed-in owner, operation kind, and normalized request. An identical retry
within 24 hours returns the original agent or funding receipt; using the same
key for different settings returns `409 IDEMPOTENCY_KEY_REUSED`. This covers a
lost HTTP response without making the browser authoritative or duplicating an
agent or mock credit. Older format-1 owner snapshots without operation records
are upgraded on the next successful write.

## Predictions

`DevnetPredictions` remains a domain-model experiment only. It has no public API and does not submit or settle payments. Startup rejects `PREDICTIONS_ENABLED=true` because the feature is not mounted yet. Any future route must use the existing payment rail and trusted completion attestation, reject mainnet, and preserve free spectator/play paths.
