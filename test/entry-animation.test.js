import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = [
  'index.html',
  'legacy/index.html',
  'post/index.html',
  'world/index.html',
  'world/arena.html',
  'world/compound.html',
  'world/private-arena.html',
  'labs/economy.html',
  'labs/funded.html',
];

test('every public page plays the shared entry animation', async () => {
  for (const file of pages) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /href="\/entry\.css"/, `${file} must load the shared entry styles`);
    assert.match(source, /src="\/entry\.js"/, `${file} must load the shared entry animation`);
    assert.match(source, /id="entry-loader"[^>]*data-mode="transition"/, `${file} must show the short matrix transition`);
  }
});

test('the transition entry builds a visible ease-in progress bar', async () => {
  const script = await readFile(new URL('../entry.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../entry.css', import.meta.url), 'utf8');
  assert.match(script, /entry-loader__track--transition/, 'the transition must add its own progress track');
  assert.match(script, /role', 'progressbar'/, 'the added track must expose progress to assistive tech');
  assert.match(script, /easeIn\(amount\)/, 'the bar must fill on an ease-in curve');
  assert.match(styles, /\.entry-loader__track--transition\s*\{/, 'the transition track must be styled');
});

test('the world intro waits for the entry animation before opening', async () => {
  const world = await readFile(new URL('../web/src/world/app.ts', import.meta.url), 'utf8');
  assert.match(world, /entryGate/, 'the world must respect the shared entry gate');
  assert.doesNotMatch(world, /canvas\.focus\(\);openIntro\(\);/, 'the character card must not cover the entry animation');
});
