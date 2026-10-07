import {mkdir,open,rename,unlink,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withStorageFailure} from './http-error.js';

async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
const matchIdPattern=/^seat-[a-f0-9]{64}$/;

/** Atomically stores completed, engine-owned public replay records. */
export class ReplayArchive {
  constructor(directory,{syncFolder=syncDirectory}={}){this.directory=directory;this.syncFolder=syncFolder;}
  file(matchId){if(!matchIdPattern.test(matchId))throw new Error('Invalid replay match identifier');return path.join(this.directory,`${matchId}.json`);}
  async save(replay){
    const target=this.file(replay?.match_id),temp=`${target}.${randomUUID()}.tmp`;
    const bytes=JSON.stringify(replay);
    if(!bytes||!replay?.final_state?.ended)throw new Error('Only completed replay records can be archived');
    await withStorageFailure('replay archive',async()=>{
      await mkdir(this.directory,{recursive:true});
      try{
        const file=await open(temp,'wx',0o600);
        try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
        await rename(temp,target);
        await this.syncFolder(this.directory);
      }finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });
    return target;
  }
  async load(matchId){
    let replay;try{replay=JSON.parse(await readFile(this.file(matchId),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(replay?.match_id!==matchId||replay?.final_state?.ended!==true)throw new Error('Invalid completed replay archive');
    return replay;
  }
}
