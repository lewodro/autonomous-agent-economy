# World integration findings

## Boundaries

- The Rust engine remains authoritative for Last Seat matches.
- The existing JavaScript rules and persistent room pool remain authoritative for RPS and Tic-Tac-Toe.
- `WorldPresenceService` owns only short-lived player presence. It cannot step games, assign winners, or authorize wallet actions.
- `TableSession` is the sole free plaza table authority. It persists checkpoints and verifies Tic-Tac-Toe boards.
- `DevnetPredictions` is currently an unmounted domain model. It is not a public betting endpoint.

## World client integration

The world renderer currently uses local browser movement and local NPCs. It does not yet join the presence endpoints. To add multi-user presence, call the API in [world-backend-contract.md](world-backend-contract.md), retain the opaque token in `sessionStorage`, send movement no faster than 15 times/second, and interpolate SSE snapshots. Do not put movement history in durable match storage.

Arena routes are already server-backed. Use `GET /api/arena/rooms` to show pairings and statuses, `/api/arena/agents` for agent profiles, `/api/arena/statistics` for the research house, and `/api/arena/history` for retained matches. Table play uses `/api/world/table`; do not introduce a second table route or state owner.

## Known deployment limit

Presence currently lives in one Node process. Run a single app instance or add a shared ephemeral store before horizontal scaling. The match and table ledgers use their existing durable storage and remain separate from presence.
