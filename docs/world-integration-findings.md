# World integration findings

## Boundaries

- The Rust engine remains authoritative for Last Seat matches.
- The existing JavaScript rules and persistent room pool remain authoritative for RPS and Tic-Tac-Toe.
- `WorldPresenceService` owns only short-lived player presence. It cannot step games, assign winners, or authorize wallet actions.
- `TableSession` is the sole free plaza table authority. It persists checkpoints and verifies Tic-Tac-Toe boards.
- `DevnetPredictions` is currently an unmounted domain model. It is not a public betting endpoint.

## World client integration

The world renderer currently uses local browser movement and local NPCs. It does not yet join the presence endpoints. The typed `web/src/world/presence-client.ts` adapter owns join/reconnect, capability storage, bounded movement cadence, heartbeat, leave, and snapshot-first SSE reconciliation. Its `onPlayers` callback supplies public snapshots and never exposes the session token.

The adapter's `onPlayers` snapshot should be converted to a remote actor list with this field mapping:

| `PresencePlayer` | Remote `WorldActor` | Rule |
|---|---|---|
| `player_id` | `id: "presence:<player_id>"` | Prefix it to avoid collisions with NPC and local visitor IDs. |
| `avatar` | `spriteId` | Use only the server-approved avatar IDs. |
| `position` | `position` | Treat it as the latest interpolation target, not a movement command. |
| `direction` | `facing` | Copy the validated cardinal direction. |
| `animation_state` | `movementState` | `walk` maps to `walking`; `idle` maps to `idle`. |
| `activity` | `activity` | Display as public presence text; never interpret it as game authority. |
| — | `type: "human"`, `name: "Visitor"`, `recentWinner: false` | Presence sessions are visitors, not arena agents. No display name is collected. |

Exclude `client.player_id` from the remote list because the local visitor actor already represents that browser. Replace the remote list on each snapshot, then interpolate those actors from their current render positions toward the newest `position` in the existing animation frame loop. Do not create one timer per remote visitor, persist their positions, or pass them to NPC strategy controllers. Send local movement at the adapter's 66 ms minimum cadence and heartbeat no faster than once per second. Call `leave()` when the visitor explicitly exits the world; `close()` is for page teardown when waiting for a network round trip is inappropriate. If a duplicated tab's copied identity is rejected, the adapter rotates to a fresh ID and retries once.

These mappings are a client integration contract, not a second authority: the local visitor remains responsive, and the presence service validates bounded movement without deciding game actions. Exact routes and payloads are in [world-backend-contract.md](world-backend-contract.md).

Arena routes are already server-backed. Use `GET /api/arena/rooms` to show pairings and statuses, `/api/arena/agents` for agent profiles, `/api/arena/statistics` for the research house, and `/api/arena/history` for retained matches. Table play uses `/api/world/table`; do not introduce a second table route or state owner.

## Known deployment limit

Presence currently lives in one Node process. Run a single app instance or add a shared ephemeral store before horizontal scaling. The match and table ledgers use their existing durable storage and remain separate from presence.
