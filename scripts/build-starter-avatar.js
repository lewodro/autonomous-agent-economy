import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng } from './build-agent-sprites.js';
import { inspectPng } from './validate-avatar-assets.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const kitDirectory=path.join(root,'assets/aae_avatar_kit');
const layerDirectory=path.join(kitDirectory,'layers');
const outputDirectory=path.join(root,'assets/avatars/clean');
const FRAME=32,COLUMNS=3,ROWS=4;

/** Alpha-composites one RGBA layer over another without changing either input. */
export function compositeLayer(target,source){
  for(let offset=0;offset<target.rgba.length;offset+=4){
    const sourceAlpha=source.rgba[offset+3]/255;
    if(sourceAlpha===0)continue;
    const targetAlpha=target.rgba[offset+3]/255;
    const alpha=sourceAlpha+targetAlpha*(1-sourceAlpha);
    for(let channel=0;channel<3;channel++){
      target.rgba[offset+channel]=Math.round((source.rgba[offset+channel]*sourceAlpha+target.rgba[offset+channel]*targetAlpha*(1-sourceAlpha))/alpha);
    }
    target.rgba[offset+3]=Math.round(alpha*255);
  }
  target.transparentPixels=0;target.visiblePixels=0;
  for(let offset=3;offset<target.rgba.length;offset+=4)target.rgba[offset]===0?target.transparentPixels++:target.visiblePixels++;
  return target;
}

/** Scales a single 32×32 frame into a 256×256 nearest-neighbour preview. */
export function buildPreview(sheet,frameX=0,frameY=0,scale=8){
  const size=FRAME*scale,rgba=Buffer.alloc(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const sourceX=frameX+x/scale,sourceY=frameY+y/scale;
    const source=((Math.floor(sourceY)*sheet.width)+Math.floor(sourceX))*4;
    const target=(y*size+x)*4;
    rgba[target]=sheet.rgba[source];rgba[target+1]=sheet.rgba[source+1];rgba[target+2]=sheet.rgba[source+2];rgba[target+3]=sheet.rgba[source+3];
  }
  return {width:size,height:size,rgba};
}

/** Builds the base skin from the first (starter) layer in each kit category. */
export async function buildStarterAvatar(){
  const manifest=JSON.parse(await readFile(path.join(kitDirectory,'avatar-manifest.json'),'utf8'));
  const chosen={
    body:manifest.layers.body[0],
    outfit:manifest.layers.outfits[0],
    hair:manifest.layers.hair[0],
    accessory:manifest.layers.accessories[0],
  };
  const composite={width:manifest.sheet.width,height:manifest.sheet.height,rgba:Buffer.alloc(manifest.sheet.width*manifest.sheet.height*4),transparentPixels:0,visiblePixels:0};
  for(const category of manifest.compositionOrder){
    const folder=category==='outfit'?'outfits':category==='accessory'?'accessories':category;
    const layer=inspectPng(await readFile(path.join(layerDirectory,folder,chosen[category])));
    if(layer.width!==composite.width||layer.height!==composite.height)throw new Error(`${chosen[category]} does not match the ${composite.width}×${composite.height} kit grid`);
    compositeLayer(composite,layer);
  }
  const preview=buildPreview(composite);
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(path.join(outputDirectory,'starter.png'),encodePng(composite.width,composite.height,composite.rgba));
  await writeFile(path.join(outputDirectory,'starter_preview.png'),encodePng(preview.width,preview.height,preview.rgba));
  return {chosen,sheet:'/assets/avatars/clean/starter.png',preview:'/assets/avatars/clean/starter_preview.png'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await buildStarterAvatar();
  console.log(`Built starter avatar from ${Object.values(result.chosen).join(', ')}`);
}
