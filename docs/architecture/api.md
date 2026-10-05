# Local HTTP API

The implemented routes live in `server.js`. The server binds loopback (default
port 3000), checks Host/Origin, and requires application/json for POST. This is
an operator-controlled local service, with no authentication or public hosting.
Session identifiers are opaque UUIDs; history IDs are `seat-` plus a SHA-256 hash.

| Method | Path | Request / result |
|---|---|---|
| GET | `/api/health` | Rust metadata, including simulation versions |
| GET | `/api/config?agents=4` | Canonical default simulation Config |
| POST | `/api/matches` | `{config}` short/full Config → `{session,replay}`; free game credits |
| GET | `/api/matches/:session` | Current replay; funded hosts also include economy |
| POST | `/api/matches/:session/step` | `{expected_turn,decisions?,compact?}`; decisions validated by Rust |
| GET | `/api/matches/:session/events` | Read-only SSE: snapshot, transition, economy |
| POST | `/api/matches/:session/share` | Verify/archive history → `{match_id}` |
| POST | `/api/replays/share` | `{replay}` → verified archive ID |
| POST | `/api/replays/import` | `{replay}` → imported session |
| GET | `/api/replays/:historyId` | Verify archive before returning `{replay}` |
| GET | `/api/funded-matches` | Local session/state/mode list |
| POST | `/api/funded-matches` | See funded request below → `{session,replay,economy}` |
| GET | `/api/funded-matches/:session` | Authoritative public host view |
| POST | `/api/funded-matches/:session/fund` | `{agent_id}`; prepare and verify entry |
| POST | `/api/funded-matches/:session/fund-all` | `{}`; operator test funding for all entries |
| POST | `/api/funded-matches/:session/cancel` | `{}`; authorized pre-start refund |
| POST | `/api/funded-matches/:session/settle` | `{}`; Rust completion/attestation determines winner |
| POST | `/api/funded-matches/:session/reconcile` | `{}`; verification-only recovery |
| GET | `/api/economy/health` | Aggregate observed counters/modes; mainnet false |
| POST | `/api/wallet-demo` | Offline wallet capability only; no caller-supplied CLI arguments |
| GET | `/premium-tool` | 402 quote or verified mock tool result with X-Demo-Payment |
| POST | `/api/payments/pay` | `{challenge_id,payer}` → signed mock tool receipt |
| POST | `/api/labs/economy` | `{action,agent_id?}`; opt-in ECONOMY_LAB=1 |

`/labs/economy` and `/labs/funded` are opt-in HTML lab pages. Unknown API routes
return 404. The legacy `/rps` frontend remains separate.

A funded request uses `config` for the simulation, plus top-level `mode`,
`entry_amount_sol`, optional `fees`, and `funding_timeout_seconds`:

```json
{"config":{"seed":42,"agents":[{"name":"One"},{"name":"Two"}]},"mode":"mock","entry_amount_sol":"0.02","funding_timeout_seconds":600}
```

The full FundedMatchConfig sample is a Rust schema, not this HTTP envelope: map
its `simulation` to `config` and its `economy.mode` / `economy.entry_amount_sol`
to those top-level fields. HTTP test treasury/reserve/cap defaults remain fixed
at 1 / 0.005 / 0.05 SOL. Fees support winner 10000 bps / house 0 only.
No endpoint accepts a caller-selected payout winner or a claimed confirmed receipt.

Ordinary request bodies are capped at 1 MB; replay requests at 32 MB and economy
lab requests at 2 KB. Errors return `{error,code?}`; codes include invalid_input,
invalid_attestation, storage_failure, rpc_unavailable, unverified_payment,
settlement_not_authorized, and mainnet_not_implemented. Statuses include 400,
404, 405, 409 (busy), 413, 415, and 429 (capacity). Code/detail shapes come from
[typed Rust errors](../../rust/src/economy/primitives.rs); legacy errors may have no code.

Health is a cached observation, not a fresh RPC or filesystem probe. `doctor`
performs preflight checks. Host storage_ready means the journal was opened with a
writer lease; it does not guarantee future writes or free disk space. Mock
rpc_ready means ledger reads succeeded, not that an external chain was checked.
See [events](./events.md) and [trust boundaries](../security/trust-boundaries.md).
