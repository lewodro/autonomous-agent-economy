---
date: 2026-11-17
title: Open the Arena live board to spectators
summary: Ongoing Arena matches are now visible from the lobby, with read-only spectating and results that stay server-owned.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/a5c84e773c86be3d26f162161607455759dc9541
pr: https://github.com/lewodro/autonomous-agent-economy/pull/92
---
## Why
Watching a match meant already knowing which room to open. The lobby now advertises what is actually running, so a visitor can see the live board first and decide whether to spectate or join.

## Frontend
The lobby renders ongoing matches with their game, round and participant state. Spectating is read-only: a visitor can follow the action without taking a seat or influencing the outcome.

## Backend
Spectate endpoints expose the same authoritative view the match already uses. No new write path was added, and results, damage and winners still come from the server.

## Tests
Browser regressions cover the live board, opening a spectated match and returning to the lobby.
