---
date: 2026-11-15
title: Give nearby visitors a quick voice
summary: Bounded proximity phrases let people greet, warn and coordinate without turning the shared world into an unmoderated chat room.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/f9d807790dde63581e6356d2aef0c01abf3c308f
pr: https://github.com/lewodro/autonomous-agent-economy/pull/86
---
## Proximity chat
The server validates a small phrase catalog, checks distance and rate limits, then relays the phrase to nearby humans. Desktop and mobile receive a compact selector and short-lived speech bubbles; holding E can open chat without breaking the normal interaction tap.

## Main commits
1ea1611 defined the phrase catalog. 7ecdaca enforced proximity and rate limits. ead0a0e completed selector, bubbles and mobile control. e4d3dbd and 27f5168 added server and two-browser coverage.
