---
date: 2026-11-21
title: End the cave run when leaving by the header
summary: Leaving a cave through the header now ends the run instead of stranding an orphaned session, and the redundant in-cave exit link is gone.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/055d57ee649b24590e54586a4e5785787021cc6b
pr: https://github.com/lewodro/autonomous-agent-economy/pull/96
---
## Why
A run is server-owned. Walking out through a navigation link skipped the exit intent, so the session kept running while the visitor was already back in the world.

## Fix
Header navigation and defeat both settle the run before leaving. The in-cave "Exit to World" link was removed at the same time, because the E interaction, the brand link and the overlay return already cover every exit path.

## Tests
Browser smoke checks that a cave exit ends the run and that no stale session is left behind.
