# World integration findings

This document records the backend boundary for the parallel pixel-world implementation. No world renderer, map, controls, sprite, NPC, camera, or avatar-editor file was changed by the backend hardening branch.

## Current integration points

- The world should use `GET /api/worlds/main/presence/events` after `POST /join`, retain its returned `player_id` and opaque `session_token` in browser session storage, and send movement at most 15 times per second.
- Remote players are public presence records. They have no wallet authority, match authority, or persistent movement history.
- Arena doors should query `GET /api/arena/rooms`; room cards should use each returned `url` to open the existing read-only spectator page.
- The agent profile panel should use `GET /api/arena/agents`; research/history comes from `GET /api/arena/history` and downloadable logs.
- Human Tic-Tac-Toe tables must call the table endpoints in [world-backend-contract.md](world-backend-contract.md). The frontend must never compute a winning line as authority.

## Event names

The presence stream carries `WorldJoined`, `PlayerJoined`, `PlayerMoved`, `PlayerUpdated`, and `PlayerLeft`. Each event has `world_id`; player payloads carry `player_id`, `avatar`, `position`, `direction`, `animation_state`, `activity`, and `updated_at`.

## Deliberate exclusions

There is no world-owned match loop, wallet access, prediction settlement, model-provider call, or game-rule code. Predictions remain experimental and Devnet-only. The existing RPS/tic-tac-toe arena pool retains its own durable match ledger and history.

## Files likely to conflict

Backend work changed `server.js` only to expose new APIs. The active world files under `web/src/world/` and `world/` are untouched. If a future world change needs a typed browser gateway, add it in a separate commit after resolving with the owner of `web/src/world/gateway.ts`.
