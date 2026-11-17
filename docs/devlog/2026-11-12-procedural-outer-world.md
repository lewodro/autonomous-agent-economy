---
date: 2026-11-12
title: Generate a wilderness beyond the town
summary: A seeded outer ring added original caves, ruins, camps and traversable terrain around the authored city center.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/718e3a3c0448ccc2c0503923e2df6a2fdf655bec
pr: https://github.com/lewodro/autonomous-agent-economy/pull/82
---
## Procedural expansion
The authored plaza remains stable while deterministic generation builds varied outer terrain with paths, cave mouths, ruins and camp sites. Collision and placement rules keep generated landmarks walkable and compatible with the existing world renderer.

## Main commit
701d17a introduced the procedural outer ring and cave generation as one coherent world expansion.
