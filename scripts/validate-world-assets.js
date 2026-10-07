import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const root=fileURLToPath(new URL('../',import.meta.url));
const avatarNames=['ember','atlas','nova','echo'];

function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}

export function inspectPng(buffer,label='PNG'){
  const signature=Buffer.from([137,80,78,71,13,10,26,10]);
  if(buffer.length<33||!buffer.subarray(0,8).equals(signature))throw new Error(`${label}: invalid PNG signature`);
  let offset=8,width,height,depth,colorType,interlace;const idat=[];
  while(offset+12<=buffer.length){
    const length=buffer.readUInt32BE(offset),end=offset+12+length;
    if(end>buffer.length)throw new Error(`${label}: truncated PNG chunk`);
    const type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];colorType=data[9];interlace=data[12];}
    if(type==='IDAT')idat.push(data);
    offset=end;if(type==='IEND')break;
  }
  if(!width||!height||!idat.length)throw new Error(`${label}: missing image data`);
  if(depth!==8||colorType!==6||interlace!==0)throw new Error(`${label}: expected a non-interlaced 8-bit RGBA PNG`);
  const stride=width*4,raw=inflateSync(Buffer.concat(idat));
  if(raw.length!==(stride+1)*height)throw new Error(`${label}: decoded image dimensions do not match its data`);
  const pixels=Buffer.alloc(stride*height);let transparent=false,visible=false;
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],rowStart=y*stride,rawStart=y*(stride+1)+1;
    if(filter>4)throw new Error(`${label}: unsupported PNG filter ${filter}`);
    for(let x=0;x<stride;x++){
      const value=raw[rawStart+x],left=x>=4?pixels[rowStart+x-4]:0,above=y?pixels[rowStart-stride+x]:0,upperLeft=y&&x>=4?pixels[rowStart-stride+x-4]:0;
      const predictor=filter===1?left:filter===2?above:filter===3?Math.floor((left+above)/2):filter===4?paeth(left,above,upperLeft):0;
      pixels[rowStart+x]=(value+predictor)&255;
    }
    for(let x=3;x<stride;x+=4){const alpha=pixels[rowStart+x];if(alpha===0)transparent=true;if(alpha>0)visible=true;}
  }
  if(!transparent||!visible)throw new Error(`${label}: expected both transparent and visible pixels`);
  return {width,height};
}

async function validate(file,dimensions){
  const actual=inspectPng(await readFile(file),path.relative(root,file));
  if(actual.width!==dimensions.width||actual.height!==dimensions.height)throw new Error(`${path.relative(root,file)}: expected ${dimensions.width}x${dimensions.height}, got ${actual.width}x${actual.height}`);
}

export async function validateWorldAssets(){
  const agentDir=path.join(root,'assets/sprites-agent'),agentFiles=(await readdir(agentDir)).filter(name=>name.endsWith('.png')).sort();
  if(agentFiles.length!==20)throw new Error(`assets/sprites-agent: expected 20 registered agent sprites, found ${agentFiles.length}`);
  for(const name of agentFiles){
    if(!/^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(name))throw new Error(`assets/sprites-agent/${name}: use NN-kebab-case.png naming`);
    await validate(path.join(agentDir,name),{width:16,height:16});
  }
  const exampleDir=path.join(root,'assets/avatars/clean');
  for(const name of avatarNames){
    await validate(path.join(exampleDir,`${name}.png`),{width:96,height:128});
    await validate(path.join(exampleDir,`${name}_preview.png`),{width:256,height:256});
  }
  return agentFiles.length+avatarNames.length*2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(`OK ${await validateWorldAssets()} transparent world sprite assets`);}
  catch(error){console.error(error instanceof Error?error.message:'World asset validation failed');process.exitCode=1;}
}
