# Survival Arena frontend contract

Survival is a read-only Arena mode backed by the authoritative Rust simulation.
The Node service schedules matches, persists checkpoints and research, and serves
`GET /api/survival/current`. The browser polls the snapshot every 1.5 seconds.
It may interpolate positions for display, but it does not choose targets, move
combatants, apply damage, eliminate agents, or declare a winner.

The version 1 snapshot contains match metadata, map geometry, up to 20 agents,
engagements, a leader ID, and the latest 50 ordered semantic events. Each agent
includes health, target, movement intent, combat metrics, and public research.
The browser validates the complete snapshot before rendering it. It retains the
last valid snapshot during a connection interruption.

The [world backend contract](../world-backend-contract.md#survival-arena)
documents the active endpoint, event types, persistence, profiles, and research
loop. The [world asset validator](../../scripts/validate-world-assets.js) and
[snapshot parser](../../web/src/world/survival.ts) enforce registered sprite
paths under `assets/agents/` and bounded display data.

`GET /api/capabilities` includes `survival` in `game_modes`. The public server
runs one continuous 20-agent Survival match. `POST /api/matches` remains the
Last Seat experiment route; it does not create custom Survival matches. The
existing economic `mode: "survival"` in `src/config.js` is a bankroll policy,
not a request to start melee combat.
