# Active match checkpoints

`matches/sessions/<session>.json` stores a Rust-verifiable event history and the
inference budget (global reservations and per-agent counts). `MATCHES_DIR` selects
an operator-owned directory. Configs/history are public; credentials and private
keys are never saved. Match IDs change with history; session IDs remain stable.

The service restores and verifies all checkpoints before accepting requests.
Corrupt state fails startup rather than silently resetting a match or spending
budget. The directory supports at most 100 active sessions; archive or remove
finished session files while the server is stopped to reclaim capacity.
Verified Arena ledgers migrate the exact previous `assets/sprites-agent/` path
to the current `assets/agents/` path during load; other participant or ledger
mismatches remain fatal. For a local clean start, use the backup-first
[data reset command](./visitor-experiments.md#reset-local-development-data).

Writes are serialized per session, use a private temporary file, flush its data,
then atomically rename. Each model reservation is checkpointed **before** its HTTP
request. Each resolved turn is checkpointed before acknowledging the transition.
After a storage failure, the next attempted turn first checkpoints current Rust
state before making another decision. Clients reconcile a stale revision through
GET. A crash between Rust resolution and checkpoint publication restores the last
checkpoint: an unacknowledged turn may need to be resolved again. Already reserved
inference remains charged; this is conservative accounting, not exactly-once
provider execution. Parent-directory fsync and distributed storage are not included.

Wallets and machine-payment balances have independent lifecycles. This module does
not persist secret keys, blockchain settlement, or mock payment receipts. Existing
content-addressed share archives remain separate from mutable session checkpoints.

This is single-process local persistence, not a distributed/public hosting system.
