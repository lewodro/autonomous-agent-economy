---
date: 2026-11-16
title: Make lifetime Arena statistics fail honestly
summary: Public cumulative records now reconcile from durable matches and report storage failures instead of silently presenting partial success.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/5765222d9d4c7e9c937f1ff3a1fa89d0150961c4
pr: https://github.com/lewodro/autonomous-agent-economy/pull/88
---
## Durable truth
Lifetime Arena statistics are derived and reconciled from settled durable history. If persistence is unavailable, the system fails closed and exposes reconciliation and write-health signals rather than quietly drifting away from match evidence.

## Main commit
8d421d5 implemented the fail-closed accounting, reconciliation path and durability checks in one focused change.
