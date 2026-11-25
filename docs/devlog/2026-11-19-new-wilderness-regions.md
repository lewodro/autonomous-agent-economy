---
date: 2026-11-19
title: Add remote wilderness districts
summary: Five new outer districts give exploration a reason to continue past the plaza, and farm guidance now stops at a believable 20 metres.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/b74e6cca1b6937687711c3860e30750818537f66
pr: https://github.com/lewodro/autonomous-agent-economy/pull/93
---
## Why
The old edge of the map read as the end of the world. New districts extend the ordinary wilderness with their own landmarks, paths and harvesting nodes.

## World
Five remote districts were added with distinct shapes and vegetation. A shared scale module now defines 16 world units per in-world metre, and farm guidance uses a 20-metre radius instead of an arbitrary pixel distance.

## Tests
Map tests cover district placement, reachability, collision-free resource nodes and the shared distance scale.
