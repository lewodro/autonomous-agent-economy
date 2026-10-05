# Troubleshooting

| Symptom | Concrete check / remedy |
|---|---|
| Port 3000 in use | Run `PORT=3001 npm start`, then use that same port in links / GAME_URL. Inspect `lsof -iTCP:3000 -sTCP:LISTEN` before stopping another process. |
| Rust/Node mismatch | `npm run doctor`; Node must be 22+, Rust must satisfy Cargo rust-version (currently 1.89). Use the same Node line as CI and run `npm ci`. |
| TypeScript absent | `npm ci --ignore-scripts`, then `npm run build`; do not use an unrelated global compiler. |
| Solana CLI missing | Free/mock require no Solana tools. For local chain tests install official Agave tooling or configure SOLANA_TEST_VALIDATOR_BINARY; see local-validator guide. |
| RPC refused/not running | `npm run solana:local` in a separate terminal; `npm run doctor -- --mode local`. Endpoint is fixed to 127.0.0.1:8899. |
| Validator genesis changed | Restore the original ledger/pin for existing matches. Use an entirely new ECONOMY_DIR for a fresh experiment; never overwrite a pin around unresolved transfers. |
| Wallet balance too low | Inspect funded host wallets and fee sponsor. Local demo provisions test funds; entry plus reserve must fit starting treasury. Never airdrop into the recorded escrow pot. |
| Invalid config | `npm run config:check -- simulation examples/matches/free-match.json`; select funded/scenario for those schemas. Amounts are strings; seed >0, 2–20 agents, unique IDs. |
| Stale persisted state | Stop all writers and preserve journals/keys. Run economy:reconcile against the original storage; do not edit status to confirmed or delete pending operations. |
| Attestation verification failed | Check replay/version, match ID, authority key continuity and settlement fields. Preserve failed snapshot; do not bypass verification or generate a replacement authority for an old match. |
| No frontend events | GET /api/health, check browser console and SSE /api/matches/:session/events. Reload for a snapshot after a gap. Viewer limits are 4/session and 16 total. |
| Public local API blocked | Use localhost/127.0.0.1 with matching Origin and port, application/json POSTs. There is no public deployment mode. |
| Provider fails/falls back | Confirm server-approved MODEL_BASE_URL and MODEL_API_KEY_ENV match profile; key is exported separately. Check request/token budgets; do not dump credentials. |
| CI differs from local | Use `npm ci`, `npm run lint`, `npm test`, Cargo locked tests, docs/examples checks. Network wallet/validator tests are separate from offline CI. |
| Storage conflict | Only one writer may open a journal. Stop the other owned app/CLI before retry; do not remove writer.lock to bypass OS locking. |

`doctor` shows OK / OPTIONAL / BLOCKING; absent optional tools do not block mock
work. Aggregate health describes the last observed state, not continuous liveness.
See [commands](./commands.md) and [recovery](../economy/failure-recovery.md).
