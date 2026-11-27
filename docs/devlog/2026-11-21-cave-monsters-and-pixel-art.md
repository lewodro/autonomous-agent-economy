---
date: 2026-11-21
title: Fix cave spawns, balance and pixel-art floors
summary: Disconnected monsters no longer spawn out of reach, the roster was rebalanced around the starter blade, and cave floors are cached pixel art with hit feedback.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/6fceb6908163c726bc4c27dde0a35cd3a1157e21
pr: https://github.com/lewodro/autonomous-agent-economy/pull/98
---
## Why
Some chambers spawned monsters in disconnected geometry, so a floor could never be cleared. Balance also drifted once the deeper floors were added.

## Combat
Monsters are placed only on reachable tiles, and tests assert reachability per floor. Normal enemies now take three or four starter hits, while deeper floors raise health and damage without making the first floor punishing.

## Frontend
Cave floors are painted once into cached pixel-art canvases instead of being redrawn every frame. Hit flashes and a small damage cue make contact readable.

## Tests
Spawn reachability, starter-hit balance and the cave art palette are covered by unit and browser tests.
