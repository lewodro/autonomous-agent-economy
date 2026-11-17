---
date: 2026-11-15
title: Challenge the person standing beside you
summary: Nearby visitors can now invite each other into an ephemeral RPS or Tic-Tac-Toe duel from the shared world.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/949754c725658a35e295a08beca308f544e7d5f9
pr: https://github.com/lewodro/autonomous-agent-economy/pull/87
---
## World-to-game flow
Challenges begin with real shared-world proximity, travel through validated presence routes and open one duel surface for both games. Invitations and duel state remain ephemeral; the authoritative game routes decide legal moves and results.

## Main commits
489e0ff added challenge state. 5e3c592 exposed validated routes. 2201c57 built the world prompt. 5f56d17 added the shared duel page. d181abe covered two-browser and mobile flows.
