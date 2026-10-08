---
date: 2026-10-03
title: Replays became evidence
summary: Versioned rule records, typed events, persistent sessions and bounded inference made results inspectable and recoverable.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/ed65d96
---
## What shipped
Rust records deterministic events; the web renderer consumes them. Session checkpoints and inference reservations survive process restarts. Replay verification rejects mismatched histories.

## Limit
An archived result is a verified simulation record, not proof of an on-chain payment.
