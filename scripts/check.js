import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['server.js'];
for (const dir of ['src', 'scripts', 'demos', 'test', 'service', 'examples', 'legacy']) for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url))) if (file.endsWith('.js')) files.push(`${dir}/${file}`);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
