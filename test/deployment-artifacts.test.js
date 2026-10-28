import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production image includes every runtime-owned browser and service directory', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  for (const line of [
    'COPY service ./service',
    'COPY src ./src',
    'COPY legacy ./legacy',
    'COPY --from=build /app/post ./post',
    'COPY world ./world',
    'COPY labs ./labs',
    'COPY assets ./assets',
    'COPY package.json server.js index.html styles.css entry.css entry.js ./',
    'COPY --from=build /app/web/dist ./web/dist',
    'COPY --from=build /app/rust/target/debug/table-core ./rust/target/debug/table-core',
  ]) assert.ok(dockerfile.includes(line), `Missing runtime artifact: ${line}`);
  assert.match(dockerfile, /COPY docs\/devlog \.\/docs\/devlog/);
  assert.match(dockerfile, /COPY examples \.\/examples/);
  assert.match(dockerfile, /CMD \["sh", "scripts\/start-production\.sh"\]/);
  const startup=await readFile(new URL('../scripts/start-production.sh',import.meta.url),'utf8');
  assert.match(startup,/chown node:node/);
  assert.match(startup,/runuser -u node -- node server\.js/);
  assert.match(dockerfile, /COPY scripts\/production-init\.js \.\/scripts\/production-init\.js/);
});

test('Render free demo uses Docker, readiness checks, and safe non-payment flags', async () => {
  const render = await readFile(new URL('../render.yaml', import.meta.url), 'utf8');
  assert.match(render, /runtime: docker/);
  assert.match(render, /plan: free/);
  assert.match(render, /healthCheckPath: \/api\/health/);
  assert.match(render, /PUBLIC_ORIGIN\n\s+value: https:\/\/lastseat\.ing/);
  assert.match(render, /HOST_SESSION_SECRET\n\s+generateValue: true/);
  assert.match(render, /MATCHES_DIR\n\s+value: \/data\/matches/);
  assert.match(render, /DEPLOYMENT_MODE\n\s+value: EPHEMERAL_DEMO/);
  assert.match(render, /WORLD_SOL_PAYOUTS_ENABLED\n\s+value: "0"/);
  assert.doesNotMatch(render, /^\s+disk:/m);
});
