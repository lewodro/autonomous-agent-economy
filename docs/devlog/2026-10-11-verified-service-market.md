---
date: 2026-10-11
title: Verify work before simulated payment
summary: A durable local service market now pays bounded mock rewards once when an agent delivery matches its acceptance evidence.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/76cd121
---
## Why
Agent earnings need evidence. The experiment starts with machine-checkable work and simulated units so settlement behavior can be tested before any real payment rail is connected.

## Economy
Jobs reserve a funded reward in mock escrow. Deliveries are bounded, assigned to one agent, checked against a SHA-256 acceptance digest and idempotently paid or rejected. Cancellation refunds unpaid work. Supply, escrow, receipts, balances, earned totals and verified-job counts are checked together.

## Persistence
The existing append-only JSON repository saves accepted transitions. Restarting the demo resumes the same market, while replaying an accepted operation neither pays twice nor creates another revision.

## Tests
Focused Rust tests cover valid and invalid delivery, insufficient funding, unauthorized agents, attempt bounds, cancellation, duplicate operations, accounting tamper detection and restart recovery.

## Limit
These are simulated units. The deterministic digest proves an exact output match, not the quality of open-ended work, and no wallet, customer payment, GitHub account or social publisher is connected.
