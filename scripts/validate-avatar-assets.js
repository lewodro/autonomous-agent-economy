import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const root=fileURLToPath(new URL('../',import.meta.url));

function paeth(left,up,upperLeft){
  const p=left+up-upperLeft,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-upperLeft);
  return a<=b&&a<=c?left:b<=c?up:upperLeft;
}

export function inspectPng(bytes){
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG signature is invalid');
  let offset=8,width=0,height=0,bitDepth=0,colorType=0;const data=[];
  while(offset+12<=bytes.length){
    const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),chunk=bytes.subarray(offset+8,offset+8+size);
    if(type==='IHDR'){width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);bitDepth=chunk[8];colorType=chunk[9];}
    if(type==='IDAT')data.push(chunk);
    offset+=12+size;if(type==='IEND')break;
  }
  assert.ok(width>0&&height>0,'PNG dimensions are invalid');
  assert.equal(bitDepth,8,'Expected 8-bit PNG');assert.equal(colorType,6,'Expected RGBA PNG with alpha channel');
  const stride=width*4,raw=inflateSync(Buffer.concat(data));assert.equal(raw.length,(stride+1)*height,'PNG data size is invalid');
  let previous=Buffer.alloc(stride),transparentPixels=0;const rgba=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++){
    const start=y*(stride+1),filter=raw[start],source=raw.subarray(start+1,start+1+stride),row=Buffer.alloc(stride);
    for(let i=0;i<stride;i++){
      const left=i>=4?row[i-4]:0,up=previous[i]||0,upperLeft=i>=4?previous[i-4]||0:0,value=source[i];
      if(filter===0)row[i]=value;
      else if(filter===1)row[i]=(value+left)&255;
      else if(filter===2)row[i]=(value+up)&255;
      else if(filter===3)row[i]=(value+Math.floor((left+up)/2))&255;
      else if(filter===4)row[i]=(value+paeth(left,up,upperLeft))&255;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }
    rgba.set(row,y*stride);
    for(let i=3;i<stride;i+=4)if(row[i]<255)transparentPixels++;
    previous=row;
  }
  return {width,height,colorType,transparentPixels,rgba};
}

export function approvedAssets(avatars){
  return avatars.filter(asset=>asset?.approved===true&&asset.placeholder!==true&&asset.debug!==true
    &&typeof asset.id==='string'&&!/(placeholder|debug|invalid)/i.test(asset.id));
}

function localAsset(url){
  assert.match(url,/^\/assets\/[a-z0-9_/-]+\.png$/i,'asset URL must be a local PNG path');
  const target=path.resolve(root,`.${url}`);assert.ok(target.startsWith(path.join(root,'assets')+path.sep),'asset path escaped assets/');return target;
}

export async function validateAssets(){
  const manifest=JSON.parse(await readFile(path.join(root,'assets/avatars/index.json'),'utf8'));
  assert.equal(manifest.version,1,'unsupported avatar index version');
  assert.ok(Array.isArray(manifest.avatars),'avatar index must contain an avatar list');
  const selectable=approvedAssets(manifest.avatars);
  assert.equal(selectable.length,4,'the current picker must contain only the four approved visitor avatars');
  assert.equal(new Set(selectable.map(asset=>asset.id)).size,selectable.length,'avatar IDs must be unique');
  const ids=new Set();
  for(const asset of selectable){
    assert.match(asset.id,/^visitor_[a-z0-9]+$/,'visitor avatar ID is invalid');ids.add(asset.id);
    assert.equal(asset.frameWidth,32);assert.equal(asset.frameHeight,32);assert.equal(asset.columns,3);assert.equal(asset.rows,4);
    const sheet=inspectPng(await readFile(localAsset(asset.sheet)));
    assert.deepEqual([sheet.width,sheet.height],[96,128],`${asset.id} sheet must use a 3×4 grid of 32px frames`);
    assert.ok(sheet.transparentPixels>0,`${asset.id} sheet must have transparent pixels`);
    const preview=inspectPng(await readFile(localAsset(asset.preview)));
    assert.deepEqual([preview.width,preview.height],[256,256],`${asset.id} preview must be 256×256`);
    assert.ok(preview.transparentPixels>0,`${asset.id} preview must have transparent pixels`);
  }
  const source=await readFile(path.join(root,'web/src/world/sprites.ts'),'utf8');
  const block=source.match(/export const AVATARS\s*=\s*\[([^\]]+)\]/)?.[1];assert.ok(block,'picker allowlist is missing');
  const registered=[...block.matchAll(/'([^']+)'/g)].map(match=>match[1]);
  assert.deepEqual([...registered].sort(),[...ids].sort(),'picker allowlist and approved asset index must agree');
  const agents=await readdir(path.join(root,'assets/sprites-agent'));
  for(const name of agents.filter(file=>file.endsWith('.png'))){
    const source=inspectPng(await readFile(path.join(root,'assets/sprites-agent',name)));
    const clean=inspectPng(await readFile(path.join(root,'assets/agents',name)));
    assert.deepEqual([clean.width,clean.height],[source.width,source.height],`${name} cleaned dimensions differ from source`);
    assert.ok(clean.transparentPixels>0,`${name} cleaned agent sprite must retain transparent pixels`);
    assert.ok(clean.transparentPixels<clean.width*clean.height,`${name} cleanup removed the whole sprite`);
  }
  return {avatars:selectable.length,agentSprites:agents.filter(file=>file.endsWith('.png')).length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await validateAssets();console.log(`OK ${result.avatars} approved transparent avatars and ${result.agentSprites} transparent agent sprites`);
}
