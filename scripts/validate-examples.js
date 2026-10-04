import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const samples=[];
for(const file of readdirSync(path.join(root,'examples/matches')))if(file.endsWith('.json'))samples.push([file.includes('funded')||file.includes('validator')?'funded':'simulation',`examples/matches/${file}`]);
for(const file of readdirSync(path.join(root,'examples/economy')))if(file.endsWith('.json'))samples.push(['scenario',`examples/economy/${file}`]);
for(const [schema,file] of samples){const result=spawnSync(path.join(root,'rust/target/debug/config-check'),[schema,file],{cwd:root,encoding:'utf8'});if(result.status!==0){console.error(`${file}: ${result.error?.message||result.stderr}`);process.exit(1);}console.log(`OK ${schema}: ${file}`);}
