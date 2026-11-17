---
date: 2026-11-15
title: Make the map smaller and venue returns smarter
summary: The local map stopped covering the world, and visitors now return from venues to the exact world position they left.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/14c458f68552a451ec4d3a121ad9556ead3c6a0f
pr: https://github.com/lewodro/autonomous-agent-economy/pull/85
---
## World continuity
A compact local-map panel preserves navigation context without becoming the main view. Entering the Arena or another venue records the visitor's authoritative world spot, so leaving restores that location instead of resetting the journey.

## Main commits
e659aa0 reduced the map panel. e2d24ed restored saved world positions. b622347 covered both behaviors in the browser.
