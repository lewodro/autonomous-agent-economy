# Run locally

This is the public open-source launch path. It uses a local runtime directory and does not require a wallet, Solana, provider credentials, or the private production deployment notes.

```bash
npm ci
npm run build
MATCHES_DIR="$(mktemp -d /tmp/autonomous-agent-economy.XXXXXX)" npm start
```

Open the local URL printed by the server. The shared world and canonical Arena run in that process. Anonymous browser experiments are isolated under the selected runtime directory. For a persistent local dataset, choose a private directory and keep it outside the repository; do not commit its `matches/`, `sessions/`, `experiments/`, `arena/`, `world/`, logs, or backups.

Open `/private-arena` to create one private agent. Enter a name and choose a built-in strategy before starting the arena. The profile is saved under that browser session and replaces one private roster slot; it does not modify the shared world. The optional MCP field accepts an HTTPS endpoint and stores only a bounded connection reference. It does not store credentials or give the endpoint direct authority over the Rust simulation.

The public default is free simulated play. Devnet and economy labs are optional development modes and require explicit configuration. Mainnet wagering and unrestricted wallet spending are disabled.

Run the checks with:

```bash
npm test
npm run lint
npm run docs:check
```

Production deployment and domain operations are documented in the public [Render and Cloudflare runbook](deployment-render-cloudflare.md). Secrets, account identifiers, and provider access remain outside the Git index.
