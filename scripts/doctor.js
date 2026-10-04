import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
let blocked=false;
function report(status,label,detail){console.log(`${status.padEnd(8)} ${label}: ${detail}`);if(status==='BLOCKING')blocked=true;}
function version(command,optional=false){const r=spawnSync(command,['--version'],{encoding:'utf8'});report(r.status===0?'OK':optional?'OPTIONAL':'BLOCKING',command,r.status===0?r.stdout.trim().split('\n')[0]:'not installed');}
function option(name){const i=args.indexOf(name);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--')){report('BLOCKING',name,'requires a value');return null;}return args[i+1];}
const mode=option('--mode')??'mock';
const config=option('--config'),schema=option('--schema')??(mode==='free'?'simulation':'funded');
for(const arg of args.filter(x=>x.startsWith('--')))if(!['--mode','--config','--schema'].includes(arg))report('BLOCKING','arguments',`unknown option ${arg}`);
report(Number(process.versions.node.split('.')[0])>=22?'OK':'BLOCKING','Node',process.version+' (requires 22+)');
version('rustc');version('cargo');version('npm');
version('solana',true);version(process.env.SOLANA_TEST_VALIDATOR_BINARY||'solana-test-validator',true);
report(['free','mock','local'].includes(mode)?'OK':'BLOCKING','payment mode',`${mode}; funded admission supports mock/local only`);
report(mode==='mainnet'?'BLOCKING':'OK','mainnet','disabled in Rust; no activation flag');
const storage=path.resolve(process.env.ECONOMY_DIR||path.join(process.env.MATCHES_DIR||path.join(root,'matches'),'economy'));
try{await mkdir(storage,{recursive:true});const probe=await mkdtemp(path.join(storage,'.doctor-'));await rm(probe,{recursive:true});report('OK','storage','directory writable');}catch{report('BLOCKING','storage','cannot write ECONOMY_DIR; choose a writable directory');}
if(mode==='local'){
 report('OK','RPC mode','fixed http://127.0.0.1:8899');
 try{
  const response=await fetch('http://127.0.0.1:8899',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'}),signal:AbortSignal.timeout(1500)});
  const value=await response.json();if(!response.ok||value.jsonrpc!=='2.0'||value.id!==1||value.error||value.result!=='ok')throw Error();
  report('OK','RPC health','validator reports ok (not a genesis authorization check)');
 }catch{report('BLOCKING','RPC health','start npm run solana:local; validator unavailable or malformed response');}
 report(process.env.LOCAL_GENESIS_HASH?'OK':'OPTIONAL','LOCAL_GENESIS_HASH',process.env.LOCAL_GENESIS_HASH?'set; validated by Rust before transfers':'funded demo reads the pin written by solana:local');
}else report('OPTIONAL','RPC','not required for free/mock runs');
report(process.env.MODEL_BASE_URL?'OK':'OPTIONAL','model endpoint',process.env.MODEL_BASE_URL?'configured; credentials and URL omitted':'not needed for mock strategies');
if(config){const result=spawnSync(path.join(root,'rust/target/debug/config-check'),[schema,config],{encoding:'utf8'});report(result.status===0?'OK':'BLOCKING','config',result.status===0?`${schema} schema accepted`:result.error?'build config-check with npm run build':(result.stderr||result.stdout).trim());}
else report('OPTIONAL','config','pass --config file.json --schema simulation|funded|scenario');
process.exitCode=blocked?1:0;
