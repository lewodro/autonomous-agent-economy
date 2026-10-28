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

Private state is persisted under `MATCHES_DIR/private-arena/<session-id>/` and
is bounded by the manager's instance and active-session limits. The public
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

Production bootstrap still starts with no private arenas. The clean-volume
guard rejects a developer's nonempty runtime directory, so local week-long
history cannot seed anyone's private arena.

Each private Survival scheduler now uses an owner-specific Rust session ID. Completed results wait for the configured result interval and then begin the next match indefinitely, including fast local speed settings. Reopening a private arena validates the canonical ledger while allowing only the separately validated private `agent-1` display/strategy/mind override; it then reapplies that override in memory. This prevents stale roster validation errors without weakening public ledger validation or leaking the custom agent into canonical rooms.
