# Remote branch audit — 2026-10-08

Baseline: `origin/main` at `aa02032a35d66db741e175faf2e4f61ba3d00b52` after PR #19. `git fetch --all --prune`, `git branch -r`, `git log --all --graph --decorate --oneline --date-order -200`, ancestor checks, both directional logs and patch-ID checks were used. Ahead counts alone were not used for decisions. No remote branch was deleted. Future work branches from `main`.

| Branch | HEAD | Unique commits | Classification | Action |
| --- | --- | ---: | --- | --- |
| `origin/224-add-ownership-mode-safety-gates` | `ade9fb8` | 81 | UNIQUE / REVIEW NEEDED | Do not merge wholesale; safety concepts selected below; ownership mode remains experimental. |
| `origin/debug-new-features` | `2fbe3cb` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/debugging-initial` | `72ba11f` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/debugging-world-ci` | `edfae7e` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/feat/autonomous-agent-world` | `2786009` | 3 | SUPERSEDED | Equivalent world_070/071 and Survival work reached main via later integration; do not merge old merge commit. |
| `origin/feat/survival-tactical-arena` | `2fb25b7` | 0 | ALREADY IN MAIN | PR #19 merged; keep as rollback/history. |
| `origin/fix/agent-sprite-serving` | `9c7df68` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/fix/final-integration-record` | `48b24eb` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/fix/world-browser-screenshot-timing` | `89c3f1b` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/fix/world-presence-client-integration` | `eb504dd` | 0 | ALREADY IN MAIN | Keep as rollback/history. |
| `origin/integration/data-recovery-ready` | `acea221` | 0 | ALREADY IN MAIN | PR #18 merged; keep as rollback/history. |
| `origin/integration/public-release` | `ca11aa6` | 0 | ALREADY IN MAIN | PR #18 merged; keep as rollback/history. |
| `origin/integration/survival-ready` | `13e85a1` | 0 | ALREADY IN MAIN | PR #18 merged; keep as rollback/history. |
| `origin/integration/world-backend` | `5a045d8` | 0 | ALREADY IN MAIN | Keep as rollback/history. |

## Special audit: `224-add-ownership-mode-safety-gates`

Its 81 commits are all patch-unique against this main (`git cherry -v` reports `+`), but patch uniqueness does not imply a public-release requirement. The branch also predates the PR #18/#19 Survival and recovery integration and changes 91 files. Its ownership, wallet and profile implementation is a separate experimental product path. A whole-branch merge would overwrite current world/Arena assumptions. The table below records every unique commit and its release disposition. `Deferred` means it is preserved on the remote branch for a separate review, not falsely claimed to be equivalent to main.

Selected public-release safeguards were **adapted into the current main architecture**, without cherry-picking old branch commits: signed private visitor sessions and owner checks, limited private checkpoint/export size, bounded public replay archive and reads, production provider TLS, default-off public model inference, presence-join throttling, and updated domain guidance. No ownership/funding feature was imported. The exact adapted release commits are listed in the release PR.

| Commit | Historical change | Release disposition |
| --- | --- | --- |
| [`f79b7f0`](https://github.com/lewodro/autonomous-agent-economy/commit/f79b7f0) | 223-fix-completed-session-retention | Adapted safeguard in release branch |
| [`b408142`](https://github.com/lewodro/autonomous-agent-economy/commit/b408142) | 224-add-ownership-mode-safety-gates | Deferred for separate review; no wholesale merge |
| [`595fa46`](https://github.com/lewodro/autonomous-agent-economy/commit/595fa46) | 225-add-wallet-signature-auth-boundary | Deferred for separate review; no wholesale merge |
| [`5db8932`](https://github.com/lewodro/autonomous-agent-economy/commit/5db8932) | 226-add-persistent-owner-agent-registry | Deferred for separate review; no wholesale merge |
| [`5420d77`](https://github.com/lewodro/autonomous-agent-economy/commit/5420d77) | 227-wire-owner-agent-profile-api | Deferred for separate review; no wholesale merge |
| [`5a05665`](https://github.com/lewodro/autonomous-agent-economy/commit/5a05665) | 228-document-self-hosting-and-mainnet-safety | Deferred for separate review; no wholesale merge |
| [`6cae216`](https://github.com/lewodro/autonomous-agent-economy/commit/6cae216) | 229-add-owner-profile-funding-safety-ui | Deferred for separate review; no wholesale merge |
| [`2227d3c`](https://github.com/lewodro/autonomous-agent-economy/commit/2227d3c) | 230-harden-owner-ledger-and-document-world-contract | Deferred for separate review; no wholesale merge |
| [`c5e26b6`](https://github.com/lewodro/autonomous-agent-economy/commit/c5e26b6) | 231-verify-production-owner-profile-browser-flow | Deferred for separate review; no wholesale merge |
| [`be85714`](https://github.com/lewodro/autonomous-agent-economy/commit/be85714) | 232-link-wallets-to-existing-guest-agents | Deferred for separate review; no wholesale merge |
| [`170382f`](https://github.com/lewodro/autonomous-agent-economy/commit/170382f) | 233-bound-public-agent-directory-pagination | Deferred for separate review; no wholesale merge |
| [`2739017`](https://github.com/lewodro/autonomous-agent-economy/commit/2739017) | 234-scope-public-rate-limits-per-client | Deferred for separate review; no wholesale merge |
| [`f2bcc9c`](https://github.com/lewodro/autonomous-agent-economy/commit/f2bcc9c) | 235-test-production-wallet-ownership-boundary | Deferred for separate review; no wholesale merge |
| [`c0fb015`](https://github.com/lewodro/autonomous-agent-economy/commit/c0fb015) | 236-preserve-owner-state-after-sync-errors | Deferred for separate review; no wholesale merge |
| [`af7e710`](https://github.com/lewodro/autonomous-agent-economy/commit/af7e710) | 237-idempotent-agent-creation-retries | Deferred for separate review; no wholesale merge |
| [`e7128c1`](https://github.com/lewodro/autonomous-agent-economy/commit/e7128c1) | 238-idempotent-mock-agent-funding | Deferred for separate review; no wholesale merge |
| [`3ea70f2`](https://github.com/lewodro/autonomous-agent-economy/commit/3ea70f2) | 239-cover-mock-funding-in-world-browser-smoke | Deferred for separate review; no wholesale merge |
| [`e476a69`](https://github.com/lewodro/autonomous-agent-economy/commit/e476a69) | 240-connect-owned-agents-to-world-profiles | Deferred for separate review; no wholesale merge |
| [`8f76ecc`](https://github.com/lewodro/autonomous-agent-economy/commit/8f76ecc) | 241-limit-mock-agent-funding | Deferred for separate review; no wholesale merge |
| [`5fb6e6f`](https://github.com/lewodro/autonomous-agent-economy/commit/5fb6e6f) | 242-clear-stale-owner-sessions | Deferred for separate review; no wholesale merge |
| [`daed888`](https://github.com/lewodro/autonomous-agent-economy/commit/daed888) | 243-limit-agent-policy-write-rate | Deferred for separate review; no wholesale merge |
| [`6143470`](https://github.com/lewodro/autonomous-agent-economy/commit/6143470) | 244-bound-private-treasury-history | Deferred for separate review; no wholesale merge |
| [`c13c7b7`](https://github.com/lewodro/autonomous-agent-economy/commit/c13c7b7) | 245-fsync-human-table-checkpoints | Deferred for separate review; no wholesale merge |
| [`fa4f1fb`](https://github.com/lewodro/autonomous-agent-economy/commit/fa4f1fb) | 246-throttle-world-presence-joins | Adapted safeguard in release branch |
| [`754778e`](https://github.com/lewodro/autonomous-agent-economy/commit/754778e) | 247-honor-trusted-proxy-client-ip | Deferred for separate review; no wholesale merge |
| [`74d9956`](https://github.com/lewodro/autonomous-agent-economy/commit/74d9956) | 248-fsync-arena-room-checkpoints | Deferred for separate review; no wholesale merge |
| [`3f8eacc`](https://github.com/lewodro/autonomous-agent-economy/commit/3f8eacc) | 249-fsync-session-checkpoint-directories | Deferred for separate review; no wholesale merge |
| [`b2bccdd`](https://github.com/lewodro/autonomous-agent-economy/commit/b2bccdd) | 250-fsync-mcp-host-session-store | Deferred for separate review; no wholesale merge |
| [`3f5d20a`](https://github.com/lewodro/autonomous-agent-economy/commit/3f5d20a) | 251-fsync-completed-replay-archives | Deferred for separate review; no wholesale merge |
| [`5e47f89`](https://github.com/lewodro/autonomous-agent-economy/commit/5e47f89) | 252-allow-verified-replay-prefix-archives | Deferred for separate review; no wholesale merge |
| [`5a23f3f`](https://github.com/lewodro/autonomous-agent-economy/commit/5a23f3f) | 253-clean-up-failed-funded-match-admission | Deferred for separate review; no wholesale merge |
| [`b99e820`](https://github.com/lewodro/autonomous-agent-economy/commit/b99e820) | 254-bound-local-development-key-file-loading | Deferred for separate review; no wholesale merge |
| [`46e7d7c`](https://github.com/lewodro/autonomous-agent-economy/commit/46e7d7c) | 255-test-wallet-owned-agent-browser-flow | Deferred for separate review; no wholesale merge |
| [`febff8e`](https://github.com/lewodro/autonomous-agent-economy/commit/febff8e) | 256-bound-and-protect-mcp-host-session-store | Deferred for separate review; no wholesale merge |
| [`2aa761f`](https://github.com/lewodro/autonomous-agent-economy/commit/2aa761f) | 257-serialize-mcp-session-store-writes | Deferred for separate review; no wholesale merge |
| [`e794f10`](https://github.com/lewodro/autonomous-agent-economy/commit/e794f10) | 258-assert-mcp-store-writes-are-serialized | Deferred for separate review; no wholesale merge |
| [`b757cf7`](https://github.com/lewodro/autonomous-agent-economy/commit/b757cf7) | 259-cap-owned-agent-registry-storage | Deferred for separate review; no wholesale merge |
| [`9d21925`](https://github.com/lewodro/autonomous-agent-economy/commit/9d21925) | 260-bind-wallet-challenge-verification-to-origin | Deferred for separate review; no wholesale merge |
| [`b8b2f74`](https://github.com/lewodro/autonomous-agent-economy/commit/b8b2f74) | 261-retain-ownership-idempotency-records | Deferred for separate review; no wholesale merge |
| [`92abc0e`](https://github.com/lewodro/autonomous-agent-economy/commit/92abc0e) | 262-bound-public-replay-archive | Adapted safeguard in release branch |
| [`bf1d11b`](https://github.com/lewodro/autonomous-agent-economy/commit/bf1d11b) | 263-protect-replay-import-sessions | Adapted safeguard in release branch |
| [`29ed011`](https://github.com/lewodro/autonomous-agent-economy/commit/29ed011) | 264-debug-revoke-owner-sessions-on-logout | Deferred for separate review; no wholesale merge |
| [`3fbc711`](https://github.com/lewodro/autonomous-agent-economy/commit/3fbc711) | 265-debug-hide-owner-session-version-from-api | Deferred for separate review; no wholesale merge |
| [`da9bfe8`](https://github.com/lewodro/autonomous-agent-economy/commit/da9bfe8) | 266-debug-drive-owned-agent-sprites-from-manifest | Deferred for separate review; no wholesale merge |
| [`0809f31`](https://github.com/lewodro/autonomous-agent-economy/commit/0809f31) | 267-debug-preserve-owner-on-free-entry | Deferred for separate review; no wholesale merge |
| [`12e4b6f`](https://github.com/lewodro/autonomous-agent-economy/commit/12e4b6f) | 268-debug-preserve-wallet-profile-in-free-entry | Deferred for separate review; no wholesale merge |
| [`d34ca0c`](https://github.com/lewodro/autonomous-agent-economy/commit/d34ca0c) | 269-debug-expire-auth-cookies-at-boundary | Deferred for separate review; no wholesale merge |
| [`e731aab`](https://github.com/lewodro/autonomous-agent-economy/commit/e731aab) | 270-debug-gate-public-server-model-spend | Adapted safeguard in release branch |
| [`5b11037`](https://github.com/lewodro/autonomous-agent-economy/commit/5b11037) | 271-debug-gate-funded-model-spend | Deferred for separate review; no wholesale merge |
| [`9413ba4`](https://github.com/lewodro/autonomous-agent-economy/commit/9413ba4) | 272-debug-bind-wallet-link-to-owner-session | Deferred for separate review; no wholesale merge |
| [`839fa07`](https://github.com/lewodro/autonomous-agent-economy/commit/839fa07) | 273-debug-report-unobserved-economy-rpc | Deferred for separate review; no wholesale merge |
| [`62a7073`](https://github.com/lewodro/autonomous-agent-economy/commit/62a7073) | 274-debug-persist-arena-run-epoch | Deferred for separate review; no wholesale merge |
| [`7aace7a`](https://github.com/lewodro/autonomous-agent-economy/commit/7aace7a) | 275-debug-reject-incomplete-rps-proofs | Deferred for separate review; no wholesale merge |
| [`a81a876`](https://github.com/lewodro/autonomous-agent-economy/commit/a81a876) | 276-debug-stage-room-epoch-before-publish | Deferred for separate review; no wholesale merge |
| [`bda6366`](https://github.com/lewodro/autonomous-agent-economy/commit/bda6366) | 277-debug-retry-ambiguous-room-checkpoint | Deferred for separate review; no wholesale merge |
| [`cb408e8`](https://github.com/lewodro/autonomous-agent-economy/commit/cb408e8) | 278-debug-hide-inflight-matches-from-history | Deferred for separate review; no wholesale merge |
| [`0c4a722`](https://github.com/lewodro/autonomous-agent-economy/commit/0c4a722) | 279-debug-rate-limit-room-spectator-joins | Deferred for separate review; no wholesale merge |
| [`86e982e`](https://github.com/lewodro/autonomous-agent-economy/commit/86e982e) | 280-debug-idempotent-free-identity-creation | Deferred for separate review; no wholesale merge |
| [`4a07981`](https://github.com/lewodro/autonomous-agent-economy/commit/4a07981) | 281-debug-prevent-wallet-session-switch | Deferred for separate review; no wholesale merge |
| [`cc0c641`](https://github.com/lewodro/autonomous-agent-economy/commit/cc0c641) | 282-debug-bound-guest-identity-request-body | Deferred for separate review; no wholesale merge |
| [`cc190c0`](https://github.com/lewodro/autonomous-agent-economy/commit/cc190c0) | 283-debug-test-funding-retry-after-sync-failure | Deferred for separate review; no wholesale merge |
| [`cbbdc3e`](https://github.com/lewodro/autonomous-agent-economy/commit/cbbdc3e) | 284-debug-limit-wallet-demo-processes | Deferred for separate review; no wholesale merge |
| [`0bb0742`](https://github.com/lewodro/autonomous-agent-economy/commit/0bb0742) | 285-debug-reconcile-engine-after-checkpoint-failure | Deferred for separate review; no wholesale merge |
| [`c8cc04b`](https://github.com/lewodro/autonomous-agent-economy/commit/c8cc04b) | 286-debug-refresh-funded-state-after-checkpoint-failure | Deferred for separate review; no wholesale merge |
| [`32c7e20`](https://github.com/lewodro/autonomous-agent-economy/commit/32c7e20) | 287-debug-correct-public-deployment-troubleshooting | Deferred for separate review; no wholesale merge |
| [`f630304`](https://github.com/lewodro/autonomous-agent-economy/commit/f630304) | 288-debug-redact-devnet-rpc-credentials-from-snapshots | Deferred for separate review; no wholesale merge |
| [`38021be`](https://github.com/lewodro/autonomous-agent-economy/commit/38021be) | 289-debug-bound-finished-session-archive-retention | Adapted safeguard in release branch |
| [`12fd6e8`](https://github.com/lewodro/autonomous-agent-economy/commit/12fd6e8) | 290-debug-reconcile-replay-retention-on-startup | Adapted safeguard in release branch |
| [`ad6dc40`](https://github.com/lewodro/autonomous-agent-economy/commit/ad6dc40) | 291-debug-merge-mcp-host-session-writes | Deferred for separate review; no wholesale merge |
| [`58e7233`](https://github.com/lewodro/autonomous-agent-economy/commit/58e7233) | 292-debug-serialize-match-capacity-admission | Deferred for separate review; no wholesale merge |
| [`b2daefc`](https://github.com/lewodro/autonomous-agent-economy/commit/b2daefc) | 293-debug-preserve-cumulative-arena-statistics | Current Survival/world presentation supersedes this path |
| [`b1d2557`](https://github.com/lewodro/autonomous-agent-economy/commit/b1d2557) | 294-debug-bound-persisted-json-reads | Adapted safeguard in release branch |
| [`825ac69`](https://github.com/lewodro/autonomous-agent-economy/commit/825ac69) | 295-debug-require-tls-for-production-model-providers | Adapted safeguard in release branch |
| [`40351d9`](https://github.com/lewodro/autonomous-agent-economy/commit/40351d9) | 296-debug-test-production-provider-transport-guard | Adapted safeguard in release branch |
| [`3b69729`](https://github.com/lewodro/autonomous-agent-economy/commit/3b69729) | 297-debug-load-archived-replays-through-bounded-store | Adapted safeguard in release branch |
| [`de2aa99`](https://github.com/lewodro/autonomous-agent-economy/commit/de2aa99) | 298-debug-server-assigns-world-presence-identities | Deferred for separate review; no wholesale merge |
| [`94c8486`](https://github.com/lewodro/autonomous-agent-economy/commit/94c8486) | 299-debug-server-assigns-spectator-identities | Deferred for separate review; no wholesale merge |
| [`414b163`](https://github.com/lewodro/autonomous-agent-economy/commit/414b163) | 300-debug-resume-and-idempotently-play-shared-table | Deferred for separate review; no wholesale merge |
| [`87901ec`](https://github.com/lewodro/autonomous-agent-economy/commit/87901ec) | 301-doc-run-local-experiments-and-domain-launch | Adapted safeguard in release branch |
| [`4e4e706`](https://github.com/lewodro/autonomous-agent-economy/commit/4e4e706) | 302-debug-animate-arena-agent-pairings | Current Survival/world presentation supersedes this path |
| [`ade9fb8`](https://github.com/lewodro/autonomous-agent-economy/commit/ade9fb8) | 303-debug-stabilize-table-drain-regression | Deferred for separate review; no wholesale merge |

## Public-launch decision

The 224 branch remains **UNIQUE / REVIEW NEEDED**, especially wallet signatures, owner registries, funding and policy APIs; those are outside the first free launch. Main contains its own shared world, Rust-authored Survival, recovery path and browser smoke coverage. The three unique commits on `feat/autonomous-agent-world` are a historical merge plus old `world_070/071` forms; main has `841f91b`, `50ce548`, `1413eb4`, PR #18 and PR #19, so that branch is superseded. All other remote refs are ancestors of main. Treat every old branch as archived/rollback-only for development, and do not delete them automatically.
