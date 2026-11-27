---
date: 2026-11-19
title: Make the caves enterable and authoritative
summary: Caves are real places now: a visitor enters, fights server-owned monsters in torch-lit rooms, and can descend into deeper floors.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/265393dacac3b6bf1def5069dd0dc9c06c4e30a2
pr: https://github.com/lewodro/autonomous-agent-economy/pull/93
---
## Why
The outer caves were scenery. Making them playable needed combat that the browser cannot fake and a run state that belongs to one visitor.

## Backend
`CaveService` owns a per-visitor, per-run state: monsters, health, positions, kills and chests. The browser sends intents for movement, attacks, descents and exits; the server resolves range, damage, deaths and floor changes.

## Frontend
Darkness and torches give the cave its own atmosphere. A cave header, overlay and in-cave interaction keep the exit and descent paths explicit.

## Tests
HTTP authority tests, credit-ledger idempotency tests and browser playtests cover entering, fighting, descending and leaving.
