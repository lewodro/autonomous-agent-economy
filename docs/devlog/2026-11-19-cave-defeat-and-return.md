---
date: 2026-11-19
title: Make cave defeat a real setback
summary: Dying in a cave returns the visitor to the plaza and clears internal test credits once, through the existing ledger rather than a new table.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/c763ab8d498299c288e2a1a4880554168de480e8
pr: https://github.com/lewodro/autonomous-agent-economy/pull/93
---
## Why
A cave with no cost is a treadmill. Defeat needed a consequence that is visible, bounded and cannot be triggered twice by a retry.

## Economy
Defeat settles as a `cave_defeat` entry that zeroes internal test credits once. Wallets, SOL and treasury balances are untouched, and the settlement reuses the existing credit ledger.

## Recovery
The run ends, the overlay explains the loss, and the visitor returns to the plaza. A lapsed run resets after seven minutes, and defeated monsters stay dead for the active run.

## Tests
Ledger idempotency and HTTP tests confirm one settlement per defeat and no effect on wallets or treasury.
