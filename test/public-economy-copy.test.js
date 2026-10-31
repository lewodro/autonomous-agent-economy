import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const publicGameFiles = [
  'index.html',
  'legacy/index.html',
  'legacy/script.js',
  'world/index.html',
  'world/arena.html',
  'world/private-arena.html',
  'world/compound.html',
  'web/src/main.ts',
  'web/src/world/app.ts',
  'web/src/world/lobby.ts',
  'web/src/world/private-arena.ts',
  'web/src/world/compound.ts',
  'web/src/world/survival.ts',
];

test('public game surfaces never denominate simulated agent value as SOL', async () => {
  const forbidden = [
    /simulated[ -]?sol/i,
    /agent capital\s*\/\s*sol/i,
    /treasury\s*\/\s*sol/i,
    /average stake/i,
    /max stake[^\n]*\bsol\b/i,
    /stake per agent[^\n]*\bsol\b/i,
    /creator revenue[^\n]*\bsol\b/i,
    /mock wallet capability/i,
  ];
  for (const file of publicGameFiles) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, `${file} contains misleading economy copy`);
  }
});

test('public copy separates internal credits from feature-gated test payments', async () => {
  const arena = await readFile(new URL('../legacy/index.html', import.meta.url), 'utf8');
  const lastSeat = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const world = await readFile(new URL('../web/src/world/app.ts', import.meta.url), 'utf8');
  assert.match(arena, /Local adaptive agents · internal credits/);
  assert.match(arena, /Risk per agent · credits/);
  assert.match(lastSeat, /Internal-credit test/);
  assert.match(lastSeat, /Local validator · test SOL/);
  assert.match(world, /Credits are not SOL or wallet funds/);
  assert.match(world, /Real payouts are disabled/);
});

test('mock economy documentation uses credits rather than fake SOL units', async () => {
  for (const file of ['examples/economy/README.md', 'docs/security/crypto-audit-2026.md', 'docs/research/audit-2026-10-03.md']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /mock SOL|simulated SOL-denominated/i, `${file} denominates mock value as SOL`);
  }
});
