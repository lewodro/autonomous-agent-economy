import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

test('local wallet execution requires a pinned genesis before key files or RPC activity', () => {
  for (const genesis of [undefined, '', '   ']) {
    const env = { ...process.env };
    if (genesis === undefined) delete env.LOCAL_GENESIS_HASH;
    else env.LOCAL_GENESIS_HASH = genesis;
    const output = join(tmpdir(), `wallet-policy-${randomUUID()}`);
    const result = spawnSync('rust/target/debug/wallet-demo', ['--local', '--fund', '--save-test-wallet', output], { env, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit LOCAL_GENESIS_HASH/);
    assert.equal(existsSync(output), false);
  }
});
