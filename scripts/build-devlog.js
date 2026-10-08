import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=path.join(root,'docs/devlog');
const files=(await readdir(source)).filter(name=>/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(name)).sort();
const entries=[];
for(const name of files){
  const markdown=await readFile(path.join(source,name),'utf8');
  const match=markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if(!match)throw new Error(`Missing devlog metadata: ${name}`);
  const fields=Object.fromEntries(match[1].split('\n').map(line=>{const index=line.indexOf(':');if(index<1)throw new Error(`Invalid devlog metadata: ${name}`);return [line.slice(0,index).trim(),line.slice(index+1).trim()];}));
  for(const key of ['date','title','summary','commit'])if(!fields[key])throw new Error(`Missing ${key}: ${name}`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)||!/^https:\/\/github\.com\/lewodro\/autonomous-agent-economy\/(commit|pull)\/[a-zA-Z0-9]+$/.test(fields.commit))throw new Error(`Invalid devlog date or link: ${name}`);
  entries.push({date:fields.date,title:fields.title,summary:fields.summary,commit:fields.commit,pr:fields.pr||null,detail:match[2].trim(),source:name});
}
await writeFile(path.join(root,'post/devlog.json'),JSON.stringify({version:1,entries},null,2)+'\n');
console.log(`Built ${entries.length} devlog milestones from docs/devlog/`);
