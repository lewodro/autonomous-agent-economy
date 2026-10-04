import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { validateDeploymentConfig } from '../service/deployment-config.js';

const env = { ...process.env, NODE_ENV: 'production' };
const config = validateDeploymentConfig(env);
for (const file of ['rust/target/debug/table-core', 'web/dist/main.js', 'index.html']) {
  accessSync(new URL(`../${file}`, import.meta.url), constants.R_OK);
}
accessSync(path.resolve(env.MATCHES_DIR), constants.W_OK);
console.log(JSON.stringify({ ok: true, port: config.port, publicOrigin: config.publicOrigin,
  storage: 'writable', engine: 'built', frontend: 'built', payments: 'disabled' }));
