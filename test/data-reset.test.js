import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resetDataDirectory } from '../service/data-reset.js';

test('local reset atomically archives all old data before preparing an empty directory', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'aae-reset-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const target = path.join(parent, 'matches'); await mkdir(path.join(target, 'economy'), { recursive: true });
  await writeFile(path.join(target, 'economy', 'ledger.json'), '{"retained":true}');
  await writeFile(path.join(target, 'arena.json'), '{"old":true}');
  const result = await resetDataDirectory(target, { confirmed: true, protectedRoot: path.join(parent, 'project'), now: new Date('2026-10-07T12:00:00.000Z'), pid: 9 });
  assert.equal(await readdir(target).then(files => files.length), 0);
  assert.equal(await readFile(path.join(result.backup, 'economy', 'ledger.json'), 'utf8'), '{"retained":true}');
  assert.equal(await readFile(path.join(result.backup, 'arena.json'), 'utf8'), '{"old":true}');
});

test('reset refuses production, missing confirmation, and a target containing project files', async t => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'aae-reset-')); t.after(() => rm(parent, { recursive: true, force: true }));
  const target = path.join(parent, 'matches'); await mkdir(target); await writeFile(path.join(target, 'keep'), 'data');
  await assert.rejects(resetDataDirectory(target, { production: true, confirmed: true }), /production/);
  await assert.rejects(resetDataDirectory(target, { confirmed: false }), /--confirm/);
  await assert.rejects(resetDataDirectory(parent, { confirmed: true, protectedRoot: path.join(parent, 'project') }), /contain the project/);
  assert.equal(await readFile(path.join(target, 'keep'), 'utf8'), 'data');
});

