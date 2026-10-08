# Public deployment: Railway, one service

Use **one Railway persistent service** built from `main`, with one attached volume. This repository already has `Dockerfile` and `railway.toml`. The container builds Node 22, the Rust 1.89+ worker and the TypeScript frontend, then runs a long-lived Node HTTP server. Railway's HTTPS edge forwards HTTP and SSE to the service. A request-only serverless function would stop the continuous Survival and Arena loops, discard in-memory presence, and interrupt long-lived event streams.

The exact image build is `npm ci && npm run build` inside the Dockerfile. The production command is `sh scripts/start-production.sh`, which makes the mounted directory writable and drops to the `node` user before `node server.js`. For a local clean checkout, use `npm ci`, `npm run build`, then `npm start`. Railway sets `PORT`; the server binds `0.0.0.0` in production. The health check is `/api/health`.

## Data and one-instance rule

Attach **one Railway volume at `/data/matches`** and set `MATCHES_DIR=/data/matches`. It stores private experiment metadata (`experiments/`), authoritative match checkpoints (`sessions/`), the bounded public replay archive, Survival and RPS/Tic-Tac-Toe room/research checkpoints (`arena/`), free table state (`world/`), and any enabled economy journals. A stable signed browser cookie holds the anonymous visitor ID; its signing secret must survive redeploys. Presence positions and animation frames are transient and reset when the single process restarts.

Use **one replica**. Multiple instances would need shared transactional storage and cross-instance event delivery before their world, sessions and background Arena loops could agree. Configure `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0` so a new release does not briefly run a second shared Arena against the same volume. Do not mount ephemeral build storage as `MATCHES_DIR`.

Private experiments are logical namespaces within this service. Each record binds a random experiment ID to a signed, server-generated anonymous visitor ID. Every private read, step and export checks that owner. Another browser sees the same `/world` and shared Arena but gets separate experiments. Match and experiment JSON are downloaded from the private routes; the server excludes prompts, provider credentials and hidden reasoning from those exports. A user who loses their browser cookie loses access to that anonymous identity; account recovery is future work.

## Set up the service

1. On [Railway](https://railway.com/), create a project and choose **New service → GitHub Repo**. Connect `lewodro/autonomous-agent-economy` and select **main** as the deployment branch. Confirm Dockerfile build detection and `railway.toml` health path.
2. Add a volume to this service with mount path `/data/matches`. Keep this path exact. The startup script handles Railway's root-owned volume while running the application as `node`.
3. In Variables, set `NODE_ENV=production`, `MATCHES_DIR=/data/matches`, `HOST_SESSION_SECRET=<generated 64-character hex>`, `ECONOMY_MODE=SIMULATED`, `ENTRY_FEE_ENABLED=false`, `ENABLE_PUBLIC_MODEL_INFERENCE=false`, `EXPERIMENT_MAX_MATCHES=8`, `EXPERIMENT_RETENTION_DAYS=30`, and `EVENT_LOG_MAX_SIZE=32000000`. Generate the secret locally with `openssl rand -hex 32`; paste its output into Railway Variables and keep it stable. Never commit it. Leave provider and Solana credentials unset for free launch.
4. In service Settings → Networking → Public Networking, select **Generate Domain**. Railway supplies the temporary `RAILWAY_PUBLIC_DOMAIN`. Set `PUBLIC_ORIGIN=https://<temporary-railway-domain>` until the custom domain is ready. Railway supplies `PORT`; do not force a value.
5. Deploy the staged settings. The process must stay running. Check `https://<temporary-railway-domain>/api/health`: `ok`, `storage`, `session`, `experiments`, `presence`, `arena` and `survival` must report ready/ok. `payments` should be `disabled`.
6. Run `DEPLOYMENT_VERIFY_URL=https://<temporary-railway-domain> npm run verify:deployment` from a built checkout. This creates one small **free private test experiment** and never deletes data. Confirm its JSON result. The verifier also checks world, RPS/TTT rooms, Survival, two anonymous identities and cross-user denial.
7. Attach the custom domain using [docs/domain.md](domain.md). Switch `PUBLIC_ORIGIN` to the exact canonical HTTPS domain, redeploy, and repeat verification there. Keep the Railway temporary domain configured for emergency checks.
8. Check Railway's deployment SHA and logs. Set the GitHub branch trigger to `main`; enable **Wait for CI** if offered for this repository. Each production deployment must map to a merged commit. Avoid deploying old feature branches.

The first public experience is free: create/select a character, walk in `/world`, spectate Survival and RPS/Tic-Tac-Toe, inspect agents, create a private Last Seat experiment, run it and download both JSON exports. The legacy economy paths remain disabled by default. Devnet is optional and must be labeled **DEVNET · TEST SOL · NO REAL VALUE**. Mainnet match wagering is disabled; see [mainnet.md](mainnet.md).

## Readiness, retention and backup

`/api/health` reports only safe status and counts. No key, RPC credential or cookie appears there. The replay archive is limited to 1,000 files and 256 MiB, with each replay at most 32 MB. Private experiments are limited to 8 per browser by default and 100 total live metadata records; completed checkpoints are pruned after 30 days at startup and before new creation. `EVENT_LOG_MAX_SIZE` limits checkpoint and export bytes. These are single-service limits, not distributed quotas. Watch volume usage and expand before full. Active experiments remain until completed or manually recovered; they are not silently erased by the completed-run policy.

In Railway, open the attached volume's **Backups** tab and enable a daily schedule; take a manual backup before changing storage formats or restoring. Test a restore in a separate nonproduction Railway project or copied volume before replacing live data. A Railway volume restore swaps the attached volume and redeploys; review the staged change first. The local `npm run data:reset` command is backup-first and refuses `NODE_ENV=production`; it is **not** a production cleanup command. The Rust replay verifier and startup recovery reject damaged checkpoints rather than inventing results.

For code rollback, redeploy the last known good **main commit SHA** from Railway deployment history while retaining the same volume and `HOST_SESSION_SECRET`. For a data rollback, take a backup of the current volume first, then restore the known good snapshot and verify `/api/health`, Research House, Survival, private exports and economy journals if enabled. Do not replace a data volume with an empty one to fix an application error. Schema-changing releases need a tested migration and backup before rollout; this release uses the current JSON storage adapter and has no database migration.

## Monitoring and limits

Use Railway service logs for `server_started`, `request_failed`, Arena retry events and shutdown drains. Watch health status, volume size, restart count and 429 rates. `EXPERIMENT_MAX_MATCHES`, `EXPERIMENT_RETENTION_DAYS` and `EVENT_LOG_MAX_SIZE` are documented in [.env.example](../.env.example). Creation, stepping, downloading, replay sharing and presence joins have bounded admission; movement and heartbeat are independently throttled. A sustained public audience may require account-backed storage and distributed limits before adding replicas.

Provider calls are disabled for public experiments unless `ENABLE_PUBLIC_MODEL_INFERENCE=true` is explicitly set. When enabled, configured remote provider URLs must use HTTPS and server credentials stay in Railway Variables. Do not set a paid provider key for the initial free launch. No wallet, Solana RPC or token is needed for free play.

Railway setup details should be checked against its current [services](https://docs.railway.com/services), [volumes](https://docs.railway.com/volumes), [backups](https://docs.railway.com/volumes/backups), [domains](https://docs.railway.com/networking/domains/working-with-domains) and [GitHub autodeploy](https://docs.railway.com/deployments/github-autodeploys) documentation.
