# Semantic events

There are two authoritative streams. Rust simulation events describe game credits
and results; Rust economy events describe verified mock/local funds. Node transports
them; the browser validates and renders projections. Animation completion never
authorizes payments. The game contract is detailed in [event-contract.md](event-contract.md).

Simulation `Event` includes seq, turn, type, participants/resources/action data,
and resulting public projection (see `rust/src/model.rs`). MatchStarted begins the
tape; AgentThinking, ActionStarted/Resolved, ChallengeStarted/Resolved,
ResourceChanged, AllianceCreated/Broken, AgentEliminated, WinnerDeclared, and
MatchEnded describe actual engine transitions. WinnerDeclared is a game result,
not a payout confirmation. Do not invent damage, trade, or separate health fields.

Economy schema version 1 has the common envelope:

```json
{"schema_version":1,"seq":0,"match_id":"eco-example","type":"FundingOpened","projection":{"match_id":"eco-example","simulation_start_id":"seat-history","payment_mode":"mock","entry_amount":"20000000","required_agents":["a","b"],"funded_agents":[],"pot_amount":"0","state":"funding","settlement_status":"not_started"}}
```

| Economy type | Additional payload | Meaning |
|---|---|---|
| FundingOpened | none | Funding phase opened |
| EntryRequested | agent_id, amount | Intent requested; not proof of payment |
| EntryReceived | agent_id, amount, receipt_id | Rail verified entry; escrow accepted it |
| EntryRejected | agent_id, error | Attempt failed; no accepted deposit |
| PotUpdated | amount | Authoritative recorded pot after transition |
| FundingCompleted | none | All required entries verified |
| FundsLocked | none | Verified complete pot locked |
| EconomyRunning | none | Host admits simulation turns |
| SettlementStarted | winner | Bound completion authorized a payout attempt |
| SettlementCompleted | winner, amount, receipt_id | Payout verified, terminal settled state |
| RefundStarted | reason | Authorized cancellation/draw recovery started |
| RefundCompleted | amount | All recorded deposits returned, terminal refunded state |
| EconomyFailed | error | Typed failure; refund eligibility depends on prior phase |

Amounts are canonical unsigned u64 **lamport strings**, never JSON floats. Payment
mode is mock/local/devnet; funded admission currently supports only mock/local.
Mainnet is rejected. Settlement status is not_started/pending/completed/refunded.
Refund reason strings currently preserve Rust Debug names such as
CancelledBeforeStart; changing them is a schema change, not a casing cleanup.

Each economy instance has an independent contiguous zero-based seq. Duplicate
prefixes are expected on snapshots; the reducer ignores old seq, rejects gaps and
cross-instance events, and requires a fresh authoritative snapshot after a gap.
Typical success: funding → entries/pot → complete → lock → running → settlement
started/completed → pot zero. Refund completes only after rail verification.
Consumers must handle pending phases and must not infer confirmation from a timer.

SSE names differ from semantic type names: `snapshot` contains replay plus optional
host economy; `transition` contains new game events and current result;
`economy` contains the entire public host economy view/event prefix. A reconnect
starts with a complete snapshot. There is no durable Last-Event-ID replay guarantee
and no global ordering between the game and economy channels. Read-only viewers
never step the host. Limits: 16 viewers total, 4/session; slow viewers disconnect.

These are public projections, not private key or provider reasoning transports.
Profiles/prompts, safe addresses/references and concise reasons can be displayed;
operators must never place secrets in public profiles. The economy view excludes
prepared authorization. Errors must be reviewed before broader public deployment.

[Reviewed fixtures](../test/fixtures/economy/README.md) protect game outcomes,
settlement, and refunds across Rust and TypeScript. Required field/name/unit changes
need a deliberate schema migration and fixture review; additive fields need
compatibility tests. PaymentReceipt currently ignores unknown ancillary fields;
critical enums, IDs and money remain strictly validated.
