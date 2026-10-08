# Visitor experiments and data

On a browser's first visit to Last Seat, the site creates a free experiment with
a cryptographically random seed. The server gives each run a separate random
session ID and stores its replay/checkpoint in `MATCHES_DIR/sessions/<id>.json`.
The browser remembers that session and resumes it on later visits from the same
browser. Restart and replay continue to use the same seed; New / Remix starts a
new run. No account is required.

This is browser-local anonymous ownership, not a cross-device user account. A
visitor using another browser or clearing site storage receives a new run. The
shared RPS/Tic-Tac-Toe rooms remain shared; only Last Seat's personal first-run
session is per browser. Existing public archive links remain separately
addressable.

Completed run records contain the replay, configuration and public decisions.
They can support later aggregate statistics, but this release does not train a
model or associate runs with a real-world identity. Before using visitor runs
for training, add clear opt-in, retention/deletion controls, a minimal
aggregate-only record, and an auditable separation between user content and
training examples. Do not treat model-generated text or an individual run as
validated learning signal without evaluation.

## Reset local development data

Stop the local server first, then run:

```sh
npm run data:reset -- --confirm
```

The command moves the complete local `MATCHES_DIR` (including sessions, arena
history, world table and economy journals) into a dated sibling
`.matches.reset-backups/` folder and creates a new empty data directory. It
refuses to run in production. The backup is intentionally retained; inspect and
remove it manually only after confirming no recovery or audit data is needed.
The reset is a one-time local action, not a startup behavior. New runs begin
accumulating normally afterward.
