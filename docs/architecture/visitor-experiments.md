# Visitor experiments and data

On a browser's first private-experiment request, the server issues a cryptographically
random anonymous session in a signed HTTP-only cookie. Creating an experiment assigns
a separate random experiment ID and seed, binds the metadata to that session, and
stores its replay/checkpoint under the persistent `MATCHES_DIR`. The browser can list
and resume its experiments on later visits. Restart and replay retain the seed; New /
Remix creates another owned experiment. No account is required.

This is browser-local anonymous ownership, not a cross-device user account. A
visitor using another browser, losing the signed cookie, or clearing site data receives
a new anonymous identity. The canonical `/world`, Survival, RPS/Tic-Tac-Toe rooms,
public profiles, statistics, and Research House remain shared. Private Last Seat runs
stay outside those public statistics and cannot resolve a public prediction. Existing
public archive links remain separately addressable and read-only.

Experiment IDs are locators, not authorization. List, load, step, delete, match export,
and full experiment export compare the record's `owner_session_id` with the verified
cookie session. A URL copied into another browser cannot bypass that check.

Completed run records contain the replay, configuration, public decision summaries,
results, structured events, and bounded research summaries. Owner downloads exclude
credentials, signing material, provider secrets, hidden reasoning, and other users' data.
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
