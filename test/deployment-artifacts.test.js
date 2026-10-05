import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production image includes every runtime-owned browser and service directory', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  for (const line of [
    'COPY service ./service',
    'COPY src ./src',
    'COPY legacy ./legacy',
    'COPY post ./post',
    'COPY labs ./labs',
    'COPY assets ./assets',
    'COPY package.json server.js index.html styles.css entry.css entry.js ./',
    'COPY --from=build /app/web/dist ./web/dist',
    'COPY --from=build /app/rust/target/debug/table-core ./rust/target/debug/table-core',
  ]) assert.ok(dockerfile.includes(line), `Missing runtime artifact: ${line}`);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "server\.js"\]/);
});

test('Railway uses the Docker build and health endpoint', async () => {
  const railway = await readFile(new URL('../railway.toml', import.meta.url), 'utf8');
  assert.match(railway, /builder = "DOCKERFILE"/);
  assert.match(railway, /healthcheckPath = "\/api\/health"/);
});
