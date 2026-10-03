import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.env.ECONOMY_DIR||'economy-data');await mkdir(root,{recursive:true});
const configPath=path.join(root,'local-validator.json');
let pinned=null;try{pinned=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
async function rpc(method){const r=await fetch('http://127.0.0.1:8899',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method}),signal:AbortSignal.timeout(1500)});const v=await r.json();if(v.error||v.id!==1||!('result'in v))throw Error('Invalid local RPC response');return v.result;}
let child;
try{await rpc('getHealth');}catch{
 child=spawn(process.env.SOLANA_TEST_VALIDATOR_BINARY||'solana-test-validator',['--ledger',path.join(root,'validator'),'--rpc-port','8899','--bind-address','127.0.0.1','--quiet'],{stdio:'inherit'});
 child.on('error',e=>{console.error('Install official Agave / solana-test-validator or set SOLANA_TEST_VALIDATOR_BINARY:',e.message);process.exit(1);});
}
let ready=false;for(let n=0;n<120;n++){try{if(await rpc('getHealth')==='ok'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
if(!ready){child?.kill();throw Error('Local validator readiness timeout');}
const genesis=await rpc('getGenesisHash');
if(['EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'].includes(genesis)||typeof genesis!=='string')throw Error('Public cluster rejected');
if(pinned&&pinned.genesis!==genesis)throw Error('Local ledger changed. Keep the prior ledger; existing payments require explicit migration.');
await writeFile(configPath,JSON.stringify({rpc:'http://127.0.0.1:8899',genesis},null,2));
console.log(`Local validator ready; pinned genesis ${genesis}. Run npm run demo:funded-local. Keep this terminal open.`);
if(child){for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code||0));}
