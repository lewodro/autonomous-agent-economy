import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const base='http://127.0.0.1:3000',debug='http://127.0.0.1:9322';
const directory=await mkdtemp(path.join(os.tmpdir(),'world-browser-ci-'));
const chromePath=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const tracked=[];

function launch(command,args,options={}){
  const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],...options});
  let output='';
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{output=(output+chunk.toString()).slice(-6000);});
  child.on('error',error=>{child.spawnError=error;});
  child.output=()=>output;
  tracked.push(child);
  return child;
}
async function waitFor(url,label,children){
  let lastError;
  for(let attempt=0;attempt<100;attempt++){
    const failed=children.find(child=>child.spawnError);
    if(failed)throw new Error(`${label} could not start: ${failed.spawnError.message}`);
    const dead=children.find(child=>child.exitCode!==null||child.signalCode!==null);
    if(dead)throw new Error(`${label} exited before becoming ready:\n${dead.output()}`);
    try{const response=await fetch(url,{signal:AbortSignal.timeout(750)});if(response.ok)return;}catch(error){lastError=error;}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error(`${label} did not become ready (${lastError?.message||'timeout'}):\n${children.map(child=>child.output()).join('\n')}`);
}
async function stop(child){
  if(child.spawnError||child.exitCode!==null||child.signalCode!==null)return;
  const exited=once(child,'exit');let timer;child.kill('SIGTERM');
  await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);clearTimeout(timer);
  if(child.exitCode===null&&child.signalCode===null){const killed=once(child,'exit');child.kill('SIGKILL');await killed;}
}

try{
  console.log(`Using headless Chrome at ${chromePath}`);
  const server=launch(process.execPath,['server.js'],{env:{...process.env,PORT:'3000',MATCHES_DIR:path.join(directory,'matches'),WORLD_LAB:'1'}});
  const chrome=launch(chromePath,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9322','--remote-allow-origins=*',`--user-data-dir=${path.join(directory,'chrome')}`,'about:blank']);
  await waitFor(`${base}/api/health`,'Axile server',[server]);
  await waitFor(`${debug}/json/version`,'Chrome DevTools',[chrome]);
  const smoke=launch(process.execPath,['scripts/world-browser-smoke.js'],{stdio:'inherit',env:{...process.env,GAME_URL:base,CHROME_DEBUG_URL:debug}});
  const [code,signal]=await once(smoke,'exit');
  if(code!==0)throw new Error(`World browser journey failed (${signal||code}):\n${smoke.output()}`);
}finally{
  for(const child of tracked.slice().reverse())await stop(child);
}
