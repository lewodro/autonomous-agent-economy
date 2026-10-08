---
date: 2026-10-03
title: Keep economic authority outside the model
summary: Exact amounts, mock escrow, typed intents and payout checks established a separate economic boundary.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/05d5287
---
## What shipped
The lab separated game credits from lamports, validated state transitions and tested conservation and idempotent settlement. Models propose actions; deterministic code authorizes economic effects.

## Limit
Mock balances are not public funds. Mainnet match wagering remains disabled.
