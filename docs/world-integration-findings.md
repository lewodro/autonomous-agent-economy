# World integration findings

## Boundaries

- The Rust engine remains authoritative for Last Seat matches.
- The existing JavaScript rules and persistent room pool remain authoritative for RPS and Tic-Tac-Toe.
- `WorldPresenceService` owns only short-lived player presence. It cannot step games, assign winners, or authorize wallet actions.
- `TableSession` is the sole free plaza table authority. It persists checkpoints and verifies Tic-Tac-Toe boards.
- `DevnetPredictions` is currently an unmounted domain model. It is not a public betting endpoint.

## World client integration

The world page now joins `main` when a visitor enters the plaza, or resumes its session after a refresh. `web/src/world/presence-client.ts` owns capability storage, movement/heartbeat requests, and snapshot-first SSE reconciliation. Remote players are rendered as interpolated human actors; local movement stays immediate and the server validates updates. Session tokens never reach renderer state.

Remote actors use this field mapping:

| `PresencePlayer` | Remote `WorldActor` | Rule |
|---|---|---|
| `player_id` | `id: "presence:<player_id>"` | Prefix it to avoid collisions with NPC and local visitor IDs; the visible label uses a short visitor suffix. |
| `avatar` | `spriteId` | Use only the server-approved avatar IDs. |
| `position` | `position` | Treat it as the latest interpolation target, not a movement command. |
| `direction` | `facing` | Copy the validated cardinal direction. |
| `animation_state` | `movementState` | `walk` maps to `walking`; `idle` maps to `idle`. |
| `activity` | `activity` | Display as public presence text; never interpret it as game authority. |
| — | `type: "human"`, `name: "Visitor"`, `recentWinner: false` | Presence sessions are visitors, not arena agents. No display name is collected. |

Exclude `client.player_id` from the remote list because the local visitor actor already represents that browser. Each snapshot replaces the remote list; movement targets are interpolated in the existing animation frame loop. The renderer creates no timer per remote visitor, stores no movement history, and does not pass visitors to NPC strategy controllers. The page sends changed positions at up to 12.5 updates/second, heartbeats once per second, and updates the server avatar when a visitor changes presets. The Arena portal calls `leave()`; page teardown closes the stream without leaving so refresh can reclaim the same identity. Unclean exits expire after 45 seconds. First-time identities are minted by the server; reconnect requires the stored server ID and session capability, and an expired capability causes a fresh server assignment.

These mappings do not create a second authority: the local visitor remains responsive, and the presence service validates bounded movement without deciding game actions. The browser smoke test exercises two visitors joining, seeing one another, moving, and leaving. Exact routes and payloads are in [world-backend-contract.md](world-backend-contract.md).

Arena routes are already server-backed. Use `GET /api/arena/rooms` to show pairings and statuses, `/api/arena/agents` for agent profiles, `/api/arena/statistics` for the research house, and `/api/arena/history` for retained matches. Table play uses `/api/world/table`; do not introduce a second table route or state owner.

## Known deployment limit

Presence currently lives in one Node process. Run a single app instance or add a shared ephemeral store before horizontal scaling. The match and table ledgers use their existing durable storage and remain separate from presence.
