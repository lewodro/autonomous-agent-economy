import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['script.js', 'server.js'];
for (const dir of ['src', 'scripts', 'demos', 'test']) for (const file of readdirSync(dir)) if (file.endsWith('.js')) files.push(`${dir}/${file}`);
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
