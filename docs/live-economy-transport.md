# Live transport and economy boundary

The current game uses HTTP to start/step a host match and SSE to stream its semantic
transitions to read-only spectators. Node checkpoints verified histories/inference
reservations; the Rust worker owns game state. This is adequate for a local prototype:
no polling loop per viewer, and viewer pause never sends an engine step. Existing
[stream behavior](live-spectators.md) and [recovery guarantees](persistence.md) apply.

The optional economy lab uses small explicit HTTP commands and complete public
snapshots/event prefixes. Its TypeScript reducer rejects gaps and cross-instance
streams, ignores duplicates, and uses Rust amounts exactly. No economy SSE stream or
paid live admission is implemented. Lab reset intentionally replaces its ephemeral
mock sidecar; it is not a durable transaction or a refund guarantee.

| Boundary | Current owner | Next implementation |
|---|---|---|
| Winner / survival | Rust engine | Keep authoritative |
| Public decision explanation | Public summary + selected observable facts | Wire structured rationale to spectator inspection without private provider fields |
| Economy identity | Rust binding + instance | Durable registry shared with host completion attestation |
| Funding/settlement authorization | Rust coordinator / escrow | Native testnet adapter and operation journal |
| Live game stream | Node SSE + browser observer | Cursor/snapshot resync across multiple hosts when deployment requires it |
| Economy stream | HTTP lab snapshot, separate typed reducer | Publish durable economy events on a separate versioned channel |
| Animation | Game/economy effect drivers | Replace renderer only after a measured need |

Before connecting money to normal live matches, enforce admission in the host runtime:
fund/lock before the first turn, bind authoritative completion, journal settlement,
and reconcile pending operations on restart. Do not let a browser message claiming
`Settled` or an animation callback authorize any of those steps. WebSocket migration
is optional; bidirectional socket access would still need the same authorization.
