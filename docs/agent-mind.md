# Agent Mind

`AgentMind` is the reusable structured decision context shared by canonical, user, and future external agents. It is a data model, not a claim of consciousness.

```text
Agent
 ├── Identity (stable id, name, sprite, ownership)
 ├── Mind (personality, goals, bounded memory/research)
 └── Controller (builtin, model, or MCP intent adapter)
```

## Contents

A mind contains identity traits, an approved strategy, bounded goals, short-term context, long-term lessons, opponent notes, controller type, and visibility. Lessons are structured records with a type, optional subject agent, compact summary, evidence match ids, confidence, and timestamp. Hidden model reasoning, secrets, private paths, and raw provider transcripts are never stored.

Short-term context is capped to the latest eight records. Long-term lessons and opponent notes are capped at 32 records each. `migrateAgentMind` derives a safe public mind from existing canonical profile and memory fields, so old persisted runs continue to load without regenerating the twenty canonical identities.

## Public and private minds

Canonical system agents expose a public, bounded mind projection derived from retained matches. A user-created mind is private to its owner experiment and is included only in that owner's export. Private lessons never enter public rankings, canonical research, or the shared Arena. External agents will receive a filtered context through a scoped controller session.

Builtin strategies remain deterministic and work without an LLM. Controllers may consume `mindContext(mind)` plus the current authoritative observation and return a validated intent. The simulation server still owns legality, damage, winners, balances, and persistence.
