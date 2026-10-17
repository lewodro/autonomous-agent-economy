---
date: 2026-10-17
title: Expand the same shared world in every direction
summary: The existing plaza became the center of a map with four times the area, wider NPC routes and a botanical district built from the current lightweight renderer.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/f3126be
pr: https://github.com/lewodro/autonomous-agent-economy/pull/32
---
## Scale without a new engine
The world grew from 1792 × 1152 to 3584 × 2304 while the Arena, Research House, tables and existing interactions stayed at their established coordinates. Camera, collision, multiplayer presence and server validation now share the expanded bounds.

## Botanical district
Irregular paths lead through varied trees, bushes, flowers, rocks, open clearings and inexpensive animated campfires. Canonical NPC routes reach the west, east, north, south and garden districts without using another movement system.

## Commit sequence
world_expand_001–003 enlarged the map, added botanical rendering and exercised every direction with a second visitor. world_expand_004 fixed a real CI timing edge in presence synchronization while preserving the anti-teleport boundary.
