# Private multi-mode arenas

Each anonymous browser can create one logical private arena namespace. It is
identified by the signed visitor session, not by a URL parameter and not by a
separate operating-system process.

## Modes

The namespace contains fresh, owner-scoped instances of:

- RPS;
- Tic-Tac-Toe; and
- Rust-authoritative Survival.

The public `/arena` continues to run its own canonical rooms and Survival
loop. Private matches never contribute to public rankings, Research House
totals, public history, or public agent memory.

## Lifecycle

```text
new browser
  -> signed anonymous session
  -> GET /api/private-arena (fresh empty namespace)
  -> POST /api/private-arena/start
  -> autonomous private rooms and Survival
  -> owner-scoped history and JSON export
```

Private state is stored in per-owner Postgres `durable_state` namespaces when
`DATABASE_URL` is configured, with `MATCHES_DIR/private-arena/<session-id>/` as
the local fallback and one-time legacy import source. It is bounded by the manager's
instance and active-session limits. The public
deployment uses a single process initially; presence and private schedulers
therefore share the same host and Rust worker. A future multi-instance
deployment must move this ownership and scheduling boundary to shared durable
storage before horizontal scaling.

## Ownership and reset

The server derives the owner from the signed HTTP-only visitor cookie. Private
arena IDs are never accepted from the request body, and the export endpoint
uses the same owner check. A second browser gets a different session and an
empty private history. Stopping an arena closes its schedulers while retaining
its checkpoint; starting it again resumes that owner's state.

Fresh production starts with no private arenas. Existing database-owned arenas are
restored on demand. A legacy file is imported only when the owner's database record is
absent, and the stable namespace prevents another visitor from reading it.

Each private Survival scheduler now uses an owner-specific Rust session ID. Completed results wait for the configured result interval and then begin the next match indefinitely, including fast local speed settings. Reopening a private arena validates the canonical ledger while allowing only the separately validated private `agent-1` display/strategy/mind override; it then reapplies that override in memory. This prevents stale roster validation errors without weakening public ledger validation or leaking the custom agent into canonical rooms.
