# Deployment guide

For the current public website, use the single-service Railway + persistent
volume topology. This repo does not use Prisma/PostgreSQL and has no migration
command. Match checkpoints, owner profiles, and arena state are file-backed.

Follow [the detailed Railway and Cloudflare deployment steps](operations/deployment.md)
for connecting GitHub, setting the volume, checking health, adding a domain,
redeploying, viewing logs, and rolling back.

The production image runs:

```sh
# Docker build stage
npm ci
npm run build

# Container start
node server.js
```

For a production-shaped local check, set `NODE_ENV=production`, a public HTTPS
`PUBLIC_ORIGIN`, a stable `HOST_SESSION_SECRET` of at least 32 characters, and
an absolute writable persistent `MATCHES_DIR`. Then run:

```sh
npm run verify:production
npm start
curl -fsS "$PUBLIC_ORIGIN/api/health"
```

Keep one application replica attached to the persistent directory. The current
JSON owner registry is atomic and restart durable, but is not a shared,
multi-instance database. The browser uses same-origin HTTP and SSE routes; the
site is served over HTTPS by the host. `PORT` is provided by Railway. There is
no database migration step. Verified replay archives are capped at 1,000
records and 256 MiB; older records are pruned as new ones are saved. Finished
session lookup records are separately capped at 1,000 entries and pruned during
archive writes and startup recovery. Public
replay sharing is limited to 10 requests and replay imports to 6 requests per
client IP per minute. Imported sessions receive a scoped host cookie so only
the importing browser can continue that run in production.
