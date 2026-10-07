import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { inspectPng } from './validate-avatar-assets.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceDirectory=path.join(root,'assets/sprites-agent');
const outputDirectory=path.join(root,'assets/agents');

function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data){
  const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,checksum]);
}
function encodePng(width,height,rgba){
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const rows=Buffer.alloc(height*(width*4+1));
  for(let y=0;y<height;y++)rgba.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

export function removeConnectedNavyBackground(image){
  const {width,height,rgba}=image,total=width*height,seen=new Uint8Array(total),queue=new Int32Array(total);
  let read=0,write=0;
  const isBackground=index=>{
    const offset=index*4,r=rgba[offset],g=rgba[offset+1],b=rgba[offset+2];
    return rgba[offset+3]===255&&r<48&&g<55&&b<68&&b-r>=3&&b-g>=3;
  };
  const enqueue=index=>{if(!seen[index]&&isBackground(index)){seen[index]=1;queue[write++]=index;}};
  for(let x=0;x<width;x++){enqueue(x);enqueue((height-1)*width+x);}
  for(let y=0;y<height;y++){enqueue(y*width);enqueue(y*width+width-1);}
  while(read<write){
    const index=queue[read++],x=index%width,y=Math.floor(index/width);rgba[index*4+3]=0;
    if(x>0)enqueue(index-1);if(x+1<width)enqueue(index+1);if(y>0)enqueue(index-width);if(y+1<height)enqueue(index+width);
  }
  return {rgba,removedPixels:write};
}

export async function buildAgentSprites(){
  await mkdir(outputDirectory,{recursive:true});
  const files=(await readdir(sourceDirectory)).filter(name=>/^\d{2}-[a-z0-9-]+\.png$/.test(name)).sort();
  if(!files.length)throw new Error('No source agent PNGs found in assets/sprites-agent');
  const results=[];
  for(const name of files){
    const image=inspectPng(await readFile(path.join(sourceDirectory,name)));
    if(image.width!==16||image.height!==16)throw new Error(`${name}: expected a 16×16 source sprite`);
    const {rgba,removedPixels}=removeConnectedNavyBackground(image);
    if(removedPixels===0&&image.transparentPixels===0)throw new Error(`${name}: no connected navy background or existing transparency found; inspect source before publishing`);
    await writeFile(path.join(outputDirectory,name),encodePng(image.width,image.height,rgba));
    results.push({name,removedPixels});
  }
  return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const results=await buildAgentSprites();
  console.log(`Cleaned ${results.length} agent sprites into assets/agents (${results.reduce((sum,result)=>sum+result.removedPixels,0)} background pixels made transparent).`);
}
