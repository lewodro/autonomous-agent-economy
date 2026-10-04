import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[];
function collect(dir){for(const name of readdirSync(dir)){const file=path.join(dir,name);if(statSync(file).isDirectory())collect(file);else if(name.endsWith('.md'))files.push(file);}}
for(const dir of ['docs','examples','test/fixtures'])collect(path.join(root,dir));
for(const name of readdirSync(root))if(name.endsWith('.md'))files.push(path.join(root,name));
const withoutCode=text=>text.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm,'');
function anchors(file){const text=readFileSync(file,'utf8'),seen=new Map(),result=new Set();
 for(const match of withoutCode(text).matchAll(/^#{1,6}\s+(.+)$/gm)){let slug=match[1].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu,'').trim().replace(/\s/g,'-');const n=seen.get(slug)||0;seen.set(slug,n+1);if(n)slug+=`-${n}`;result.add(slug);}
 for(const m of text.matchAll(/(?:id|name)=["']([^"']+)["']/g))result.add(m[1]);return result;
}
const failures=[];let links=0,diagrams=0;
for(const file of files){const text=readFileSync(file,'utf8');
 for(const match of text.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)){diagrams++;if(!/^(flowchart|graph|sequenceDiagram|stateDiagram-v2)\b/.test(match[1].trim()))failures.push(`${path.relative(root,file)}: unsupported Mermaid header`);}
 const clean=withoutCode(text);
 const targets=[...clean.matchAll(/\[[^\]]*\]\((<?[^)]+>?)\)/g)].map(m=>m[1]);
 for(const m of clean.matchAll(/<(?:img|a)\b[^>]*\b(?:src|href)=["']([^"']+)["']/g))targets.push(m[1]);
 for(let target of targets){target=target.replace(/^<|>$/g,'').split(/\s+["']/)[0];if(/^(?:[a-z]+:|\/\/)/i.test(target))continue;
  links++;const [pathname,fragment]=target.split('#');let decoded;try{decoded=decodeURIComponent(pathname.split('?')[0]);}catch{failures.push(`${file}: invalid link encoding`);continue;}
  const resolved=decoded?path.resolve(path.dirname(file),decoded):file;
  if(!existsSync(resolved)){failures.push(`${path.relative(root,file)}: missing ${target}`);continue;}
  if(fragment&&resolved.endsWith('.md')&&!anchors(resolved).has(decodeURIComponent(fragment)))failures.push(`${path.relative(root,file)}: missing anchor ${target}`);
 }
}
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`OK ${files.length} Markdown files, ${links} local links, ${diagrams} Mermaid headers. External URLs and full Mermaid rendering are not checked.`);
