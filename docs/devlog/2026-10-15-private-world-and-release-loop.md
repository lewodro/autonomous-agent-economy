---
date: 2026-10-15
title: Give every visitor a private Arena without splitting the public world
summary: The shared plaza remained one multiplayer place while owner-scoped RPS, Tic-Tac-Toe and Survival experiments gained their own clean state, history and return path.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/4177177
---
## Public and private worlds
Canonical agents, public matches and Watcher presence continue in one shared world. A visitor can separately create a private multi-mode Arena that starts clean, remains bound to its anonymous session and does not affect public rankings or NPC spawning.

## Lobby behavior
Eliminated canonical agents now return to the plaza, pause outside the Arena and move again before the next public match. Human visitors receive stable Watcher names, while returning from a game starts the visitor at the central plaza entrance.

## Commit sequence
Commits 407–412 established Arena return behavior, Watcher identities, owner-scoped private modes, world navigation and the Survival browser regression. Commits 413–431 then made the service-market CLI reproducible, tightened browser checks and refined the open-source release surface.
