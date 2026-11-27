---
date: 2026-11-23
title: Continue the cave past floor three
summary: A cleared third floor now opens into procedurally extended depths, with a scaling curve that flattens instead of exploding.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/223478cf228ea2c5866822f82ad6334f30c761cb
pr: https://github.com/lewodro/autonomous-agent-economy/pull/100
---
## Why
The authored three floors ended the run with no passage, which made a long cave feel finite for no gameplay reason.

## Scaling
Depth scaling steps by 0.10 through floor three, 0.05 through floor five, and 0.03 from floor six onward. Health, damage, speed and rewards scale together, with rewards capped at the existing ledger limit.

## Implementation
Generated floors reuse the deepest authored geometry with unique monster IDs and keep the deep palette. The server publishes each floor's layout in the snapshot, so the client does not duplicate the scaling rules.

## Tests
Unit tests cover the scaling curve, endless descent, unique spawns, published layouts and reset behaviour.
