---
date: 2026-10-03
title: Rock Paper Scissors with commitments
summary: RPS gained commit-reveal checks so a player cannot choose after seeing the other move.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/7310973
---
## Why
An inspectable contest needs deterministic resolution and a move-order safeguard.

## What shipped
Commitments bind a move before reveal. Tests cover all nine outcomes and settlement invariants.
