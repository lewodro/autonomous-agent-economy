---
date: 2026-11-21
title: Make cleared cave floors descend reliably
summary: A cleared floor now shows its passage, points toward it, and uses the shared 96-unit reach, while deeper floors gained more rooms and enemies.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/9989ec4acda7fa76c8fba0f37dd8f1c0577bb1e3
pr: https://github.com/lewodro/autonomous-agent-economy/pull/99
---
## Why
Descending required standing almost exactly on a passage that was hard to see, so a cleared floor could feel stuck.

## Fix
Descent uses the same 96-unit interaction reach as exits and chests, a marker appears once the floor is cleared, and a direction hint points the way. Floors were deepened to 5, 6 and 7 rooms with 4, 6 and 6 enemies.

## Tests
Progression tests walk each floor to its passage, and browser smoke covers the cleared-floor marker and descent.
