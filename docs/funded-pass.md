# Persistent funded implementation pass

This pass preserves the authoritative V6 game and adds durable economy admission,
trusted completion and isolated-validator settlement. Public devnet funded matches
and mainnet remain unavailable. The local prototype is trusted backend custody.

## Implemented boundaries

| Concern | Implementation |
|---|---|
| Intents / receipts | Canonical match-purpose-account IDs, exact lamports, retry metadata, duplicate proof checks |
| Persistence | Checksummed append-only JSON revisions, atomic rename/fsync, single-writer lease |
| Recovery | Restore verified host/replay, reload newer rail facts, reconcile original transaction |
| Authority | Persisted Ed25519 host key signs match/version/final-state/event hashes and winner |
| Local rail | Pinned loopback validator, native two-signature System transfer + intent memo |
| Escrow | Backend test account; exact verified entries, lock, payout/refund |
| Fees | Zero house fee, full pot to sole winner, separate network fee sponsor |
| Admission | All entries verified, exact pot, configuration and server deadline checked |
| Live UI | Existing SSE stream, compact authoritative pot/funding/payout view |
| Retry | Persist intent before RPC; capped automatic backoff, explicit retry/reconcile |

Signing keys and wire authorization never appear in public HTTP/SSE views.
Draws refund entries rather than choosing a made-up winner.

## Actual local-validator results

The six HTTP/process-recovery tests passed against an isolated Agave 4.3.0
validator, pinned genesis `Abn1nLiuKahcrTM3wazozf7PtZLw9pr6HsM2sNBfug8r`.
Each matrix case verified native entries, exact escrow balance, signed completion,
winner payout, duplicate settlement and a complete process restart.

| Agents | Entry SOL | Pot lamports | Pot SOL | Result |
|---:|---:|---:|---:|---|
| 2 | 0.05 | 100000000 | 0.10 | Passed |
| 4 | 0.02 | 80000000 | 0.08 | Passed |
| 4 | 0.03 | 120000000 | 0.12 | Passed |
| 4 | 0.05 | 200000000 | 0.20 | Passed |
| 8 | 0.02 | 160000000 | 0.16 | Passed |

Fixtures use seed 42, except the eight-agent payout fixture uses seed 44: seed 42
at the five-turn limit produces a legitimate draw. No rules or winner logic changed.

| Interrupted boundary | Actual test result |
|---|---|
| 2/4 mock entries, kill Node/Rust process group, restart, finish funding | Same pot/deposits; admission and one payout passed |
| Local payout sent, worker exits before recording confirmation | Restart + verification-only reconcile recognized original signature; no second payout |
| First of two local refunds sent, worker exits | Restart + authorized cancellation recovered original refund and paid the remaining one once |
| Local latest-blockhash RPC unavailable before signing | Created intent/retry persisted; restart completed the same intent once |
| Late recovered final deposit | Admission rejected after deadline; read-only reconciliation emitted no refund; explicit expiry refunded |

The Rust native transfer/restart test also passed with `--ignored` explicitly enabled.
The normal test suite skips tests that require a validator; it does not claim network
execution from mock success.

## Browser evidence and commands

Desktop and 360/390/430px funded UI checks passed: configure four local agents,
fund 0.02 each, receive a 0.08 payout, reload and repeat settlement without another
payment. The existing free-game browser suite passed, including 20 seats and
reduced motion. Browser screenshots are generated in the system temporary directory.

```sh
npm run solana:local
ECONOMY_LAB=1 PORT=3001 npm start
npm run demo:funded-local -- --mode local --agents 4 --entry 0.02
npm run economy:reconcile -- SESSION_ID
FUNDED_LOCAL_TESTS=1 LOCAL_GENESIS_HASH=YOUR_LOCAL_GENESIS node --test test/funded-recovery.test.js
GAME_URL=http://localhost:3001 node scripts/funded-browser-smoke.js
```

Routes: `/`, `/?watch=SESSION`, `/labs/funded`, `/labs/economy`, `/rps`.
Funded HTTP commands live under `/api/funded-matches`; health is
`/api/economy/health`. All remain local development controls without production
authentication or participant wallet consent.

## Next five tasks

1. Persist last-valid block height and prove non-landing before authorizing expired-transaction replacement.
2. Add an opt-in CI local-validator job that executes the same amount/crash matrix.
3. Design participant authorization and separate spectator/operator permissions before hosting funded controls.
4. Implement a bounded devnet rail with finality/reorg rules and sponsor-fee accounting; test the full recovery matrix there.
5. Test storage backups, capacity/retention and reconciliation monitoring before considering production custody.

Mainnet additionally requires an explicit custody/escrow design, independent security
review, key management, settlement/refund guarantees and legal review. See
[readiness](mainnet-readiness.md), [trust boundaries](trust-boundaries.md) and
[recovery](failure-recovery.md).
