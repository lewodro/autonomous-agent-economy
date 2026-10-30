# Human farm loop, accounts and payout ledger

The shared world now carries a small human economy on top of the agent plaza:

1. Farm plots spawn on open ground across the garden, market and southern fields.
2. A visitor walks to a plot, presses **E**, and plants wheat, carrot or pumpkin.
3. The crop ripens in **60–120 seconds**. A top-left notice and a canvas arrow point
   back to the plot when it is ready.
4. Harvesting puts one produce item in the visitor's bag.
5. Carrying produce changes the arrow: it now points at the bazaar in the lower market.
6. Selling at the bazaar converts produce into world credits and XP.
7. Every minute in the world also earns credits. Signed-in visitors can link a public
   Solana address and queue a payout request.

Everything that decides state — growth, inventory, prices, XP, play time and payouts —
runs on the server. The browser only renders snapshots and sends intents.

## Domain model

| Module | Responsibility |
|---|---|
| `service/world-farm.js` | Server-authoritative farm loop: tiles, growth, inventory, sale prices, XP, play-time credits and the payout ledger. |
| `service/world-store.js` | Durable document store. Uses Postgres when `DATABASE_URL` is set, otherwise a local JSON file. Writes are serialized. |
| `service/world-identity.js` | Clerk session-token verification (RS256 against Clerk's public JWKS) and the signed `aae_account` cookie. No Clerk secret key is required. |
| `web/src/world/farm.ts` | Browser client, Clerk loader, RPG HUD and notice stack. |
| `web/src/world/renderer.ts` | Pixel-art soil/crops and the on-screen/edge arrow pointers. |

Tiles are anchored to fixed open-ground positions (`FARM_ANCHORS`) with small random
jitter, so a plot never lands inside a wall. Wild soil relocates after four minutes,
which is what makes plots feel like they are spawning around the map.

A player can tend three plots at once. Harvest locations and the bazaar are validated
against the visitor's live presence position, so a browser cannot sell or harvest from
the other side of the map.

### API

| Route | Method | Notes |
|---|---|---|
| `/api/world/farm` | GET | Snapshot: account, tiles, bazaar prices, rates, auth configuration. |
| `/api/world/farm/plant` | POST | `{tile_id, crop}`; requires presence near the plot. |
| `/api/world/farm/harvest` | POST | `{tile_id}`; requires presence near the plot and plot ownership. |
| `/api/world/farm/sell` | POST | `{crop, quantity}`; requires presence near the bazaar. |
| `/api/world/farm/heartbeat` | POST | `{seconds}`; play-time credits, capped at 30 seconds per call. |
| `/api/world/farm/wallet` | POST | `{wallet_address, display_name?}`; saves a **public** address only. |
| `/api/world/farm/payout` | POST | `{amount_credits}`; signed-in accounts only. Creates a queued payout. |
| `/api/world/auth` | GET | `{provider, configured, publishable_key}` for the browser. |
| `/api/world/auth/clerk` | POST | `{token}`; verifies a Clerk session token and sets the signed account cookie. |
| `/api/world/auth/logout` | POST | Clears the account cookie. |

## Accounts and social login (Clerk)

Clerk was chosen because it gives Google/GitHub/Apple/X sign-in with a hosted UI and a
single publishable key. The integration is deliberately optional:

* Without `CLERK_PUBLISHABLE_KEY`, the farm runs as a browser guest and the HUD shows
  **GUEST**. No third-party script is loaded.
* With the key, the world loads Clerk's browser SDK lazily, opens the hosted sign-in
  modal, and exchanges the resulting session token for a server-signed
  `aae_account` cookie.
* The server verifies the token against `https://<frontend-api>/.well-known/jwks.json`
  using `node:crypto`. There is no Clerk secret key in this service and no JWT library
  dependency.

Guest progress is merged into the account the first time a visitor signs in: credits,
XP, play time, inventory, statistics and owned plots all move to `clerk:<subject>`.

### Setting up Clerk

1. Create an application at <https://dashboard.clerk.com>.
2. Enable the social providers you want (Google, GitHub, Apple, X).
3. Add your production URL (`https://lastseat.ing`) and, for local testing,
   `http://localhost:3000` under **Domains / Allowed origins**.
4. Copy the **Publishable key** (`pk_test_…` or `pk_live_…`).
5. Add it to the Render service as `CLERK_PUBLISHABLE_KEY`.

No secret key is needed. If you later add webhooks or the Clerk Backend SDK, add the
secret as a separate Render secret and never send it to the browser.

## Database on Render

The store is a single JSONB document in a table called `world_state`:

```sql
create table if not exists world_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
```

The table is created automatically on boot. One row (`id = 'main'`) holds accounts,
tiles, inventory and the payout ledger. This is intentionally simple for the current
single-process, low-traffic world; split it into normalized tables when concurrency or
row size demands it.

### Blueprint (already in `render.yaml`)

```yaml
databases:
  - name: lastseat-db
    plan: free
    databaseName: lastseat
    user: lastseat

services:
  - type: web
    name: lastseat
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: lastseat-db
          property: connectionString
```

Deploying the blueprint provisions the database and injects `DATABASE_URL` into the
web service. Nothing else is required.

### Manual setup in the Render dashboard

1. **New → Postgres**.
2. Name it `lastseat-db`, choose the region closest to the web service, and pick a plan.
3. After it is available, open the database and copy the **Internal Database URL**.
4. Open the `lastseat` web service → **Environment**.
5. Add `DATABASE_URL` with that internal URL.
6. Save; Render redeploys the service.
7. Confirm with `GET /api/health`:

```json
{ "world_farm": { "status": "ok", "storage": "postgres", "tiles": 6, "queued_payouts": 0 } }
```

Notes:

* Use the **internal** URL for a Render web service in the same region; it avoids
  public egress and TLS quirks.
* Free Render Postgres instances expire after the free window. For a permanent world,
  move to a paid plan before the expiry date, or point `DATABASE_URL` at any managed
  Postgres (Neon, Supabase, RDS). The code only needs a standard connection string.
* If `DATABASE_URL` is absent, the app falls back to `MATCHES_DIR/world/world-farm.json`.
  That file is ephemeral on Render's free web-service filesystem and resets on deploy.
* To migrate existing JSON state into Postgres: copy `world-farm.json`, then insert it
  once with `insert into world_state (id, state) values ('main', '<json>');`.

## Payouts and safety

This pass implements a **ledger**, not a signing service.

* Play time earns `WORLD_CREDITS_PER_MINUTE` credits (default `1`/minute). Credits from
  play time are tracked separately as `time_credits`.
* Selling produce earns credits immediately at the bazaar.
* A signed-in account with a linked public wallet can request a payout at or above
  `WORLD_MIN_WITHDRAWAL_CREDITS` (default `50`). Requesting deducts credits and creates
  a `queued` payout row with the wallet address, credit amount, optional lamport value,
  timestamp and note.
* `WORLD_LAMPORTS_PER_CREDIT` is bookkeeping only in this release. With the default `0`,
  payout rows record `amount_lamports: 0` and the note says no SOL rate is configured.
* `WORLD_SOL_PAYOUTS_ENABLED` stays `0` and the existing `WorldEconomy` treasury flow is
  unchanged. Nothing in this feature signs a transaction, holds a keypair, or sends SOL.
* Wallet addresses are public identifiers and are stored as self-declared. No seed
  phrase, private key or signature is accepted anywhere in the flow.

Processing the queue is a separate, reviewed operation: a treasury signer reads queued
rows, marks them `sent` with a transaction signature, or `rejected` with a reason. Do not
enable live transfers by flipping a flag; build and audit that signer first.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | unset | Enables Postgres storage. Unset = JSON file under `MATCHES_DIR`. |
| `CLERK_PUBLISHABLE_KEY` | unset | Enables the sign-in button and Clerk token verification. |
| `WORLD_CREDITS_PER_MINUTE` | `1` | Play-time credits per minute (0–60). |
| `WORLD_MIN_WITHDRAWAL_CREDITS` | `50` | Minimum payout request. |
| `WORLD_LAMPORTS_PER_CREDIT` | `0` | Bookkeeping conversion; `0` keeps payouts ledger-only. |
| `WORLD_SOL_PAYOUTS_ENABLED` | `0` | Existing economy payout flag; remains disabled. |

## Testing

```bash
node --test test/world-farm.test.js test/world-identity.test.js test/world-farm-http.test.js
npm test
```

The unit tests cover growth timing, plot ownership, plot limits, bazaar range, play-time
caps, wallet validation, queued payouts, guest-to-account merging and restart
persistence. The HTTP test boots the real server and exercises the same routes the
browser uses.
