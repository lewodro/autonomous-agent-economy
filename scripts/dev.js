import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('node_modules/typescript/bin/tsc')) {
  console.log('Installing the locked local TypeScript compiler…');
  const install = spawnSync('npm', ['ci', '--ignore-scripts'], { stdio: 'inherit' }); if (install.status !== 0) process.exit(install.status || 1);
}
for (const [cmd, args] of [['cargo', ['build', '--manifest-path', 'rust/Cargo.toml', '--locked']], [process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'web/tsconfig.json']]]) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.error) { console.error(`Install Rust/Cargo and Node 22+. ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
await import('../server.js');
