import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedAssets, hasUsableTransparency } from '../scripts/validate-avatar-assets.js';

test('avatar catalog excludes unapproved, placeholder, debug and invalid entries',()=>{
  const entries=[
    {id:'visitor_ember',approved:true},
    {id:'visitor_placeholder',approved:true},
    {id:'visitor_debug',approved:true},
    {id:'visitor_invalid',approved:true},
    {id:'visitor_hidden',approved:false},
  ];
  assert.deepEqual(approvedAssets(entries).map(asset=>asset.id),['visitor_ember']);
});

test('asset transparency rejects opaque previews with only incidental partial alpha',()=>{
  assert.equal(hasUsableTransparency({width:100,height:100,visiblePixels:10_000,transparentPixels:0}),false);
  assert.equal(hasUsableTransparency({width:100,height:100,visiblePixels:9_999,transparentPixels:1}),false);
  assert.equal(hasUsableTransparency({width:100,height:100,visiblePixels:9_000,transparentPixels:1_000}),true);
  assert.equal(hasUsableTransparency({width:100,height:100,visiblePixels:0,transparentPixels:10_000}),false);
});
