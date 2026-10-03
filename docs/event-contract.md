# Event contract and authority audit

New matches use `last-seat-v2`. Rust emits monotonically ordered `seq` values, a typed event kind, actor/target, public reason and optional decision/outcome. `ActionResolved.outcome` contains the actual actor/target credit deltas; these are results, never instructions for browser arithmetic.

Every v2 event contains a Rust-authored `projection`: round conditions, terminal state, alliances and the affected agent records. `RoundStarted` replaces all public agent records; other projections replace only actor/target records. `RoundEnded.state` is a full checkpoint. The browser merges supplied records and animates supplied values. It never validates actions, computes upkeep, decides elimination or selects a winner.

`AgentThinking` describes the deterministic decision phase; network waiting is a separate runtime presentation state. `ActionStarted`, `ActionResolved` and `WinnerDeclared` permit rendering implementations to change without engine changes. Existing work/challenge/cooperation events remain for rich explanations. No fictitious trade, damage or health mechanic is introduced.

V1 archives are verified with the preserved v1 event contract and isolated compatibility projection. New v2 fields are omitted from serialized v1 events, preserving their content IDs. Rules and recorded decisions remain authoritative during verification.

## Problems found and fixed

| Finding | Fix |
|---|---|
| Browser clears guards and infers alliance state | V2 replaces public records with Rust projections |
| Resource/event fields manually mixed with renderer timing | Animation maps semantic events behind a driver interface |
| A client can seek while an HTTP turn is in flight | Generation cancellation plus expected-turn revision and server reconciliation |
| Model requests have no per-match inference ceiling | Runtime-owned adapter budget; limits remain outside prompts |
| Replay/state payload grows with every live response | Turn endpoint returns only new events and authoritative final state; replay fetched/exported separately |

Game history is deterministic. Runtime request duration, network receipts and visual effects are separate channels and never enter game scoring or seeded randomness.
