# Developer command reference

Run commands from the repository root. npm test builds Rust and TypeScript first;
standalone Node test files that import web/dist require npm run build first.

| Purpose | Implemented command |
|---|---|
| Locked compiler install | `npm ci --ignore-scripts` |
| Local app (default :3000) | `npm start` / `npm run dev` |
| Debug economy transitions | `ECONOMY_LOG=1 npm start` (stderr JSON) |
| Build binaries/browser | `npm run build` |
| TypeScript check | `npm run typecheck` |
| JS syntax check | `npm run check` |
| Combined lint | `npm run lint` |
| Node tests | `npm test` |
| Rust tests | `cargo test --manifest-path rust/Cargo.toml --locked` |
| Rust formatting | `cargo fmt --manifest-path rust/Cargo.toml --check` |
| Rust lint | `cargo clippy --manifest-path rust/Cargo.toml --locked --all-targets -- -D warnings` |
| Environment preflight | `npm run doctor -- --mode mock` |
| Local RPC preflight | `npm run doctor -- --mode local` |
| Canonical config | `npm run config:check -- simulation examples/matches/free-match.json` |
| Reset local data | Stop the app, then `npm run data:reset -- --confirm` (backs up the entire configured data directory; development only) |
| All canonical samples | `npm run examples:check` |
| Relative docs links | `npm run docs:check` |
| Mock economy | `npm run demo:economy -- examples/economy/mock-0.02.json` |
| Free sidecar | `npm run demo:economy -- examples/economy/free.json` |
| Durable mock funded match | `npm run demo:funded-local -- --mode mock --agents 4 --entry 0.02` |
| Start/pin validator | `npm run solana:local` |
| Local funded match | `npm run demo:funded-local -- --mode local --agents 4 --entry 0.02` |
| Verify original operations | `npm run economy:reconcile -- SESSION` (omit SESSION for all) |
| Free seeded match | `npm run match -- --agents 4 --seed 42 --out /tmp/match.json` |
| Canonical agents | `npm run match -- --config examples/matches/free-match.json --out /tmp/free.json` |
| Balance measurement | `npm run balance -- 120 last-seat-v6` |
| Full-size replay stress | `cargo test --release --manifest-path rust/Cargo.toml --locked maximum_size_match_is_replayable_within_transport_limits -- --ignored` |
| Offline wallet | `npm run demo:wallet` |
| Mock tool payment | `npm run demo:payments` (app running) |
| Crypto signatures | `npm run demo:crypto` |
| Solana wire simulation | `npm run demo:solana` |
| Browser game smoke | `npm run test:browser` (app + dedicated Chrome debug :9322) |
| Walkable world smoke | `npm run test:browser:world` (app + dedicated Chrome debug :9322) |
| Browser funded smoke | `npm run test:browser:economy` (app + dedicated Chrome debug :9322) |
| npm vulnerability audit | `npm audit --audit-level=low` |
| Rust vulnerability audit | `cargo audit --file rust/Cargo.lock` (install cargo-audit separately) |

Use MATCHES_DIR for session/archive storage and ECONOMY_DIR for funded journals,
keys and validator pin. PORT changes the app port; GAME_URL must match in browser
checks. FUNDED_AUTO_RUN=0 disables scheduling for manual tests. ECONOMY_LAB=1
exposes test operator labs, not public hosting. MODEL_BASE_URL / MODEL_API_KEY_ENV
approve model destinations; never put the actual credential into profiles.

See [browser setup](./TESTING.md), [local validator](../economy/local-validator.md),
[API](../architecture/api.md), [recovery](../economy/failure-recovery.md), and [dependency policy](./dependencies.md).
