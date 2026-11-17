---
date: 2026-11-16
title: Prove production history survives a restart
summary: Real Postgres restart and legacy-import checks now exercise the same persistence path expected in production.
commit: https://github.com/lewodro/autonomous-agent-economy/commit/00b8675262aa3717a8f4ba00c58eb690591a7569
pr: https://github.com/lewodro/autonomous-agent-economy/pull/89
---
## Restart evidence
The persistence harness writes durable state, stops the service, boots it again against Postgres and verifies the records remain intact. Legacy local history can be imported without duplicating already-reconciled events, and CI now runs the database-backed restart job.

## Main commits
ba97b5b closed restart and import gaps. 3928b43 added the real Postgres harness. 2bd54dd wired the persistence job into CI.
