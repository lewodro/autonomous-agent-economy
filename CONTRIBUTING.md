# Contributing

Use Node 22+ and Rust/Cargo satisfying `rust/Cargo.toml` (currently Rust 1.89+).
No Solana tools or paid model account are needed for ordinary work.

```sh
npm ci --ignore-scripts
npm run build
npm run doctor
npm test
npm run lint
cargo test --manifest-path rust/Cargo.toml --locked
npm run examples:check
npm run docs:check
```

Start a focused branch from current main. Make coherent commits with an imperative
message; `hardening_NNN description` is used for this pass, not a mandatory project
prefix. No empty commits or contribution-count splitting. Describe the concrete
problem, resulting behavior and relevant checks in your PR. Preserve unrelated
working-tree edits. Do not commit generated web/dist, matches, keys or node_modules.

Game authority: `rust/src/engine.rs`, `strategy.rs`, `model.rs`, versioned rules.
Rendering: `web/src/` projection/player/renderer/animation drivers. Transport/model
scheduling: `service/` and `server.js`. Funded authority: `rust/src/economy/host.rs`;
rail, escrow, attestation and recovery modules stay independent of game credits.
Legacy RPS code remains in src/legacy and is not the live game engine.

Add a strategy through Rust strategy dispatch and config validation; expose its
name only where the existing profile/UI contract needs it. Add deterministic rule
and replay tests, and do not change probabilities/balance without evidence and a
version decision. A model provider uses the adapter registry and existing bounded
HTTP policy, not direct wallet access.

A new payment rail implements PaymentRail with exact integer amounts, intent-bound
verification, durable original operation identity and uncertain-outcome recovery.
Keep MatchEscrow and completion attestation authorization intact. Test conservation,
duplicate operations, wrong recipient/amount, crash/reload and failure paths. This
pass does not authorize enabling public devnet funded competition or mainnet.

Use cargo fmt and the strict TypeScript build. JS is dependency-free ESM; preserve
nearby style and avoid mass formatting. Fixtures are reviewed contract artifacts;
never blindly refresh them. Relative doc links and canonical examples are checked
in CI. See [commands](docs/commands.md) for browser and stress checks.

Profiles/prompts/replays are public. Keep API keys only in operator-approved server
environment names and ignored test wallet seeds on disk. Never paste secrets into
logs, screenshots, PRs or fixtures. [SECURITY.md](SECURITY.md) explains private
reporting and [trust boundaries](docs/trust-boundaries.md) describe custody limits.
No project-wide license is currently declared; discuss redistribution/artwork first.
