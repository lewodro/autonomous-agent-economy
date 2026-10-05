# Hardening audit — 2026-10-03

Prepared October 3, 2026, America/Edmonton. Continued from `5cf0b46`; no project
restart, custody change, new gameplay, balance adjustment, mainnet or dependency
addition. The final report commit follows the code/CI revision `7fe833d`.

## Commit accounting

24 commits in this pass, including one integration merge, the GitHub workflow
correction and this report/artifact commit. Two concurrent README commits were
preserved, making 26 commits reachable since the starting revision. The substantive
changes have focused boundaries rather than empty or artificial contribution commits.
The report's own hash is available in git history; it cannot embed its own hash.

```text
2aa7521 hardening_001 cover economy conservation and terminal invariants
f76400b hardening_002 validate persisted payment proofs and receipt roundtrips
7384764 hardening_003 reject corrupted settlement recovery snapshots
54f0043 hardening_004 cover stale journal refund recovery
078700e hardening_005 reject malformed inner instruction evidence
e91c088 hardening_006 make malformed configuration errors actionable
b737557 hardening_007 add mode-aware doctor and canonical config checker
e551953 hardening_008 expose safe typed economy health counters
d196347 hardening_009 retain typed failures and log safe economy transitions
8abe5ab hardening_010 freeze cross-language settlement refund and outcome schemas
d1c7b67 hardening_011 add canonical match samples and parser validation
dc0b90e hardening_012 document implemented API and event contracts
ef73abb hardening_013 document custody authority and private security reporting
f207801 hardening_014 document failure recovery and actionable troubleshooting
ac24b89 hardening_015 strengthen validator preflight and document test custody setup
219e548 hardening_016 add contributor workflow and executable command reference
693939e hardening_017 correct durable funding status and architecture diagrams
4fb41c1 hardening_018 record dependency policy and actual unreleased milestones
c503d5d hardening_019 clear strict lint warnings with equivalent code
d645a7a hardening_020 validate docs examples and strict Rust lint in CI
ee62a91 hardening_021 make browser checks select an isolated debug port
4e10c28 hardening_022 preserve concurrent README edits before publication
7fe833d hardening_023 fix lint component input placement in workflow
[present report] hardening_024 record verified audit post and browser evidence
```

Concurrent remote commits retained:

```text
2f703b0 _revide_readme_improvedclarity_and_details
676dee2 _fix_typo_in_rdme_description
```

## Tests and regression protection

- 2/4/8/20-agent cohorts, seeds 9/42: confirmed entry sum equals pot, participant
  capital plus pot conserved, duplicate funding does not add money, all entries
  required to lock/start, winner belongs to participants, payout at most recorded
  pot, one successful settlement, zero terminal pot, terminal states cannot restart.
- Free sidecar retains existing zero-value intents/events/receipts but cannot make
  them payable or change balances. Ordinary free HTTP matches remain credit-only.
- Real persistent receipt writes/reopen: Pending/Confirmed/Rejected/Unknown and
  entry/payout/refund purposes preserve IDs, exact amounts, references and status.
  Critical enum/ID/money malformations are rejected. Unknown receipt ancillary
  fields remain forward-compatible. Failed records retain retry/error data.
- Persisted confirmed records require matching prepared intent, receipt identity,
  confirmed proof and local transaction reference; rails validate before reload.
- Host recovery rejects participant/config/winner/pot/payout changes and missing
  attestation, even inside a valid checksummed journal envelope. Existing invalid
  attestation, changed winner and submitted/confirmed payout recovery tests remain.
- A stale coordinator with already-confirmed refunds reopens the same rail journal
  without recrediting; duplicate refunds emit no new completion and cannot fund/start.
  Existing partial cancellation, timeout, pending-reason restart and wrong payment
  recipient/amount verification remain covered.
- RPC evidence matrix rejects missing signature, wrong signer/recipient/amount,
  invalid slot and malformed inner-instruction shape. Explicit null or empty array
  is required for inner instructions. This test failed before the focused fix.
- Config profile objects identify their index; alias lookup no longer reads inherited
  Object properties. Supplied falsey amount/mode values no longer silently default.
- Public health counts and opt-in logs have tests; secret/raw authorization/error
  objects are omitted. Cross-language fixtures freeze settlement/refund streams and
  game start/winner output; fixtures are reviewed contracts, not automatic rewrites.

## Configuration and developer tools

Exact SOL strings, cap/free conflicts and treasury/reserve failures identify their
field and remedy. Existing seed/count/ID/provider, fee, timeout, reserved custody and
mainnet validation remain authoritative in Rust. Normal valid config semantics are
preserved. Duplicate display names remain cosmetic; IDs must be unique.

New commands: `npm run doctor`, `npm run config:check -- SCHEMA FILE`,
`npm run examples:check`, `npm run docs:check`. The checker uses existing Rust
simulation/funded/scenario schemas without starting wallets or external providers.
Doctor marks tools/mode/storage/config clearly and keeps unnecessary Solana/model
tools optional. It rejects mainnet. Browser tests accept CHROME_DEBUG_URL to avoid
an occupied debugger port. Validator preflight checks HTTP/RPC shape, pin continuity
and rejects public clusters; failure cleans up only a validator child it started.

Canonical JSON samples in examples/matches: free-match, mock-funded-match,
local-validator-match, custom-model-match. Rust parser checks all four plus the
three existing economy scenarios. No second TOML config format was introduced.

## Observability and errors

EconomyHealth is typed on the Rust side: payment_mode, observed rpc_ready,
storage_ready, pending intents/receipts/settlements/refunds, mainnet_enabled=false.
HTTP aggregate health explicitly reports not_observed/ready/unavailable. These are
cached observations; journal-open status is not a future-write/disk-space guarantee.

ECONOMY_LOG=1 enables stderr JSON for public economy transitions and scheduler
reconciliation retries, with safe session/match/operation IDs, mode and sequence.
The worker's stdout JSON protocol remains intact. Typed worker errors retain Rust
codes; storage failures have an explicit storage_failure code. Existing persisted
adapter_failure codes remain readable. No keys, raw provider data or prepared
transaction authorization are logged.

## Documentation and security

Added API/events, trust boundaries, failure-recovery, local-validator,
troubleshooting, commands and dependencies docs; SECURITY.md, CONTRIBUTING.md,
CHANGELOG.md; reviewed fixture and canonical sample guides. Corrected stale README,
economy architecture and live transport claims about durable funding and SSE.
Simple Mermaid diagrams match simulation/render, custody and recovery flows.

The browser remains untrusted. Host-signed completion is trusted-host evidence, not
decentralized fairness. The local rail remains trusted test backend custody, not an
on-chain escrow. Checksums/OS locks do not protect against a privileged malicious
operator. Profiles/prompts are public; secrets must stay out of them. Private
reporting guidance makes no unverified contact, support SLA or bug-bounty claim.

## CI and validation evidence

- Final committed code checkout: 82 Node tests and 82 active Rust tests passed.
  Two normal Rust tests are ignored: local chain and full-size stress. The release
  20-agent/200-turn replay stress test was run separately and passed.
- npm build, strict TypeScript, JS syntax, cargo fmt, and all-target Clippy with
  warnings denied passed on an isolated checkout. Equivalent lint cleanups removed
  an unchecked winner unwrap and retained exact modulo-based strategy decisions.
- Free/mocked 0.02/0.05 economy output bytes match the pre-pass SHA-256 baseline:
  free `73d37e08117d8c3fbb1a2f1ec382f03e8ce9403990a0d25f609e43ed87f1bf9c`;
  0.02 `a1f6e0f48147dc7c2622558add235881af2d2e3601ff905edf48d00bf91635dd`;
  0.05 `a6a829c6e760e8a60e23708db3ae8e6e9d8db9d9218c38fbbab8036051c83d76`.
  All remain seed42, last-seat-v6, turn14, winner agent-3, identical histories/pot/math.
- Canonical free match and durable funded mock CLI completed. Verification-only
  reconcile completed against the same durable mock storage.
- Dedicated headless Chrome: live game, pause/resume, share/history, spectator
  reconnect, 20 seats, reduced motion and 360/390/430px checks passed; economy lab
  verified deposits, locked pot, winner, duplicate settlement and mobile layouts.
  Observed 20-agent RAF mean 16.67ms, p95 16.8ms; this is one local measurement.
- Local links/anchors resolve; all 18 Mermaid diagrams rendered through a temporary
  browser Mermaid import, with no added repo dependency. CI checks local links,
  Mermaid headers and canonical examples; CI does not perform network diagram rendering.
- npm audit: zero known vulnerabilities. Fresh RustSec: 37 locked dependencies,
  zero known vulnerabilities/warnings, 1290 loaded advisories. No lockfile changes.
- CI now includes docs/examples checks and strict Rust Clippy/formatting. GitHub
  caught one action-input indentation error; hardening_023 fixed it. Final remote
  [Node 22/24/26](https://github.com/lewodro/autonomous-agent-economy/actions/runs/37170545843)
  and [offline/Rust](https://github.com/lewodro/autonomous-agent-economy/actions/runs/37170545904)
  passed on the final code/CI revision `7fe833d`. Final report/artifact revision
  conclusions are checked separately after publication.

## Product status and limits

| Path | Current status |
|---|---|
| Ordinary live/free | Working, unchanged game credits only |
| Mock funded | Working, admission/attestation/journal/settlement/refund tested |
| Local funded | Implemented test backend custody; current chain run unverified |
| Devnet funded | Unavailable; economy adapter read-only |
| Optional devnet wallet | Capped test-SOL demo, separate from competition |
| Mainnet | Disabled; not production-ready for real-value competition |

Behavior changes are limited to rejecting malformed/inconsistent inputs, specific
errors, additive diagnostics and validator cleanup. Valid game decisions, pot/fee
math, payout policy, custody and layout are unchanged, with exact baseline evidence.

Current blockers: no Solana CLI/validator in PATH, so no new on-chain run is claimed.
Another process left local_rail.rs and funded-recovery.test.js work in progress in
the shared original checkout; these were neither overwritten nor included. The
isolated committed validation checkout was clean. Full shared-tree cleanliness
cannot be claimed while those unrelated edits exist. This is not a production audit.

## Exact next five implementation tasks

1. Run the existing chain regression and funded demo in an isolated, explicitly
   pinned local-validator CI job, including actual balances and transaction proof.
2. Extend original-operation fault injection to HTTP 500/timeout/invalid JSON,
   ambiguous broadcast and restart at every settlement/refund persistence boundary.
3. Add bounded journal retention/disk-pressure handling that preserves unresolved
   operations and a complete audit trail, with capacity/recovery tests.
4. Add a tested backup/restore procedure preserving host authority, rail journals,
   keys and validator genesis, including interrupted-copy and key-loss cases.
5. Generate reviewed API/event JSON schemas from authoritative types and check
   cross-language compatibility and all event variants in CI.

[Post draft](./hardening-x-post-2026-10-03.txt) ·
[Fresh live screenshot](../hardening-2026-10-03.png) · [Earlier daily audit](./audit-2026-10-03.md).
