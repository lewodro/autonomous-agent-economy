---
date: 2026-10-03
title: A Rust table that decides the result
summary: The first playable Last Seat slice put bounded agent decisions inside a seeded Rust simulation.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/a8494a1
---
## Why
The match needed one authority for rules and outcomes before it could become a live product.

## What shipped
The engine owns turns, credits, elimination and winner selection. The browser presents those facts. Early pixel sprites made the table legible.

## Boundary
This was a free simulation, not a real-money game.
