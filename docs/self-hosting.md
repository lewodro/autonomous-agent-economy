# Self-hosting Autonomous Agent Economy

The standard install runs the walkable world, free games, mock agents, profiles,
and match spectators without a wallet, RPC provider, database service, or model
API key. The Node service starts the Rust engine and owns game/economy state.

## Requirements

| Tool | Version/use |
|---|---|
| Git | Clone the repository |
| Node.js | 22 or newer; HTTP service, tests, and browser bundle |
| npm | Lockfile install and scripts |
| Rust/Cargo | Stable toolchain; authoritative Last Seat engine |
| Solana CLI | Only for local-validator mode |

## Free mode

```sh
git clone https://github.com/lewodro/autonomous-agent-economy.git
cd autonomous-agent-economy
npm ci
npm run dev
```

Open `http://localhost:3000`. Free visitor movement, mock games, spectators,
and creating agents at `/profile/` need no wallet. Agent creation stores only
the approved avatar, mock strategy, short public personality, and basic profile.
It does not activate model inference or real payments.

## Runtime modes

| Mode | Configuration | What works | External requirement |
|---|---|---|---|
| Free | `APP_MODE=free` (default) | World, free games, profiles, mock strategies | None |
| Mock | `APP_MODE=mock` | Free game plus simulated agent test credits | None; local only |
| Local validator | `APP_MODE=local-validator`, `SOLANA_NETWORK=localnet` | Existing test-only match economy | Solana CLI and validator; `npm run solana:local` |
| Devnet | `APP_MODE=devnet`, `SOLANA_NETWORK=devnet` | Existing opt-in match test-SOL experiment | Dedicated HTTPS RPC; see [public Devnet guide](economy/public-devnet.md) |
| Mainnet ownership | Not activatable | Wallet ownership foundation exists; mainnet agent transfers are disabled | All blockers in [mainnet readiness](mainnet.md) must be closed first |

The owner/agent profile registry uses an atomic JSON file at
`$MATCHES_DIR/identity/state.json`. Set `MATCHES_DIR` to persistent storage when
restarting the service. This format is intended for a **single application
instance**; it is not a multi-writer database. Do not run multiple replicas
against one directory. The application has no database migrations.

Mock is a local development mode and public production rejects it. The profile
“mock funding” button only creates simulated `MOCK_CREDIT` receipts. It does
not create SOL, use the match-economy payment rail, or send a chain transaction.

## Local validator

Install a Solana CLI version supported by `scripts/start-local-validator.js`,
then run:

```sh
npm run solana:local
```

In a second terminal, start the app with `APP_MODE=local-validator` and
`SOLANA_NETWORK=localnet` (the funded local economy lab has its own opt-in
configuration). The local validator is test-only and the funded match demo
uses trusted-backend test custody. Do not reuse its key files for Devnet or
Mainnet. See [local-validator setup](economy/local-validator.md).

## Devnet

Devnet is separate from public agent ownership. Existing Devnet support concerns
the funded match experiment and requires explicit test-SOL acknowledgement.
The optional profile wallet sign-in proves ownership of a public key, but the
profile currently has **no verified on-chain agent funding or withdrawal flow**.
Never send mainnet funds to an address shown by a mock or local demo.

## Production self-host

The recommended single-service deployment uses a persistent volume. Follow
[deployment.md](deployment.md) for the exact Docker/Railway commands and
environment requirements. For a production-shaped local check, configure
`NODE_ENV=production`, `PUBLIC_ORIGIN`, `HOST_SESSION_SECRET`, and an absolute
writable `MATCHES_DIR`, then run:

```sh
npm ci
npm run build
npm run verify:production
npm start
```

The verifier does not contact model providers or send transactions. Do not set
mainnet flags: this release rejects mainnet activation, and always rejects
mainnet match wagering.
