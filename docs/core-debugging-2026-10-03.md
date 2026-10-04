# Core debugging follow-up — 2026-10-03

Started from `e27ebea` (funding-deadline admission and bounded scheduler retries).
Preserved concurrent documentation/frontend/CI commits `d9d49e9` and `04648bb`.
Five focused follow-up commits use hardening_025 through hardening_029.

| Finding | Fix and regression |
|---|---|
| Scheduler recalculated the failed match from a changed registry | Retain the selected session across awaits. A regression grows the registry while its operation fails and verifies only that session receives backoff. |
| Scheduled financial commands did not hold the manual-operation lock | Lock the selected session through success/failure and release in finally. Concurrent manual cancellation now receives the existing busy response. |
| Fully funded matches could idle until expiry after interrupted admission | Retry verification-only reconciliation before the deadline; existing expired admission remains blocked. No new deposits are created. |
| A saved cancellation could be bypassed by recovered admission | Refuse admission while cancellation is saved. Tests restore the crash boundary, deny start and complete the original refund; ordinary funded recovery still starts. |
| Restore accepted a changed entry-price policy or settlement operation identity | Bind the validated amount, actual backend mode, instance-derived match ID and canonical payout ID. Checksummed corruption regressions reject altered policy and operation ID. |
| Confirmed/failed payment records could acquire new retry metadata | Reject retry mutation for terminal records before changing counters, timestamps or errors; assert exact record equality after rejection. Failed-record roundtrip coverage is retained. |
| Worker bridge accepted nonboolean success labels and incomplete envelopes | Require boolean ok and the appropriate result/error envelope; malformed protocol rejects all pending work and stops that worker. Ordinary typed failures still preserve the next request. |
| Worker stdout EOF could strand requests while the process remained alive | Reject pending/future requests on closed response stream and stop the worker. Stream errors follow the same failure path. |

Commit boundaries:

```text
f9451f2 hardening_025 bind scheduler failures and locks to the active match
4c968e2 hardening_026 resume funded admission without bypassing saved cancellation
fa5d0df hardening_027 bind restored policy rail and settlement identities
0dff835 hardening_028 keep terminal payment records immutable during retries
[this report] hardening_029 reject malformed worker replies and closed response streams
```

Verification on an isolated checkout, including the concurrent committed changes:

- Node: 93 passed, 4 local-validator tests skipped (97 total).
- Rust: 85 active tests passed; local-chain and full-size stress are normally ignored.
  The release-mode full-size replay stress test was separately run and passed.
- Build, TypeScript, JS syntax, cargo fmt and all-target strict Clippy passed.
- All seven canonical example configs parse; documentation paths/anchors resolve.
- Dedicated Chrome :9338 against isolated app :3019 passed live gameplay, pause,
  replay/share, 20-seat/mobile layout, reduced motion and read-only spectator recovery.
- Free/mock 0.02/mock 0.05 demo bytes retain the original hardening-baseline SHA-256
  hashes: game decisions, history, winner, event stream and pot arithmetic unchanged.
- RPC :8899 was unavailable in this follow-up; no fresh chain payment claim is made.
  The prior isolated-validator evidence remains in [funded-pass.md](funded-pass.md).
- Dependency manifests/lockfiles were not changed by these fixes. This pass does
  not substitute for a production custody audit or enable mainnet/devnet funding.

Architecture remains Rust game authority → deterministic admission/economy →
verified rail/journal facts. Node schedules and transports; browser/model output
cannot authorize funds. The fixes address recovery identity, asynchronous scheduling
and protocol failure boundaries, with no new gameplay, custody or payout policy.

Exact final GitHub Actions conclusions are checked after publication and reported
with the final commit hash; local checks are not a substitute for those results.
