import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectPng, validateWorldAssets } from '../scripts/validate-world-assets.js';

test('registered world sprites have expected dimensions and real transparent pixels',async()=>{
  assert.equal(await validateWorldAssets(),28);
});

test('sprite validator rejects malformed and unsupported PNG files',async()=>{
  assert.throws(()=>inspectPng(Buffer.from('not an image'),'invalid.png'),/invalid PNG signature/);
  const png=await readFile(new URL('../assets/sprites-agent/01-founder.png',import.meta.url));
  const copy=Buffer.from(png);
  assert.deepEqual(inspectPng(copy,'founder.png'),{width:16,height:16});
  copy[25]=2;
  assert.throws(()=>inspectPng(copy,'rgb.png'),/expected a non-interlaced 8-bit RGBA PNG/);
});
