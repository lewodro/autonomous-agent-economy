import { readFile, writeFile } from 'node:fs/promises';
import { Core } from '../service/core.js';
import { InferenceBudget } from '../service/model-adapter.js';
import { decisionsFor } from '../service/adapters.js';
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const core=new Core(),budget=new InferenceBudget();
try {
  const config=option('--config')?JSON.parse(await readFile(option('--config'),'utf8')):await core.request({command:'defaults',count:Number(option('--agents','4'))});
  if(args.includes('--seed'))config.seed=Number(option('--seed'));
  let {replay}=await core.request({command:'start',session:'cli',config});
  while(!replay.final_state.ended){
    const info=await core.request({command:'observe',session:'cli'});
    let decisions=await decisionsFor(info.config,info.observation,budget);
    if(decisions){const defaults=await core.request({command:'decide',session:'cli'});decisions=decisions.map((d,i)=>d||defaults.decisions[i]);}
    ({replay}=await core.request({command:'step',session:'cli',decisions}));
  }
  const file=option('--out','match.json');await writeFile(file,JSON.stringify(replay,null,2));
  console.log(`${replay.match_id}\nTurn ${replay.final_state.turn} · winner ${replay.winner||'draw'} · replay ${file}`);
}catch(error){console.error(error.message);process.exitCode=1;}finally{core.stop();}
