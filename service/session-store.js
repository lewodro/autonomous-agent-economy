import {mkdir,open,rename,readFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withStorageFailure} from './http-error.js';
async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
const identifier=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Storage contains Rust-verifiable history plus orchestration metadata, never keys. */
export class SessionStore {
  constructor(directory,{syncFolder=syncDirectory}={}){this.directory=directory;this.syncFolder=syncFolder;this.pending=new Map();}
  file(session){if(!identifier.test(session))throw new Error('Invalid session identifier');return path.join(this.directory,`${session}.json`);}
  archiveFile(session){if(!identifier.test(session))throw new Error('Invalid session identifier');return path.join(this.directory,'finished',`${session}.json`);}
  save(session,replay,budget){
    const target=this.file(session),bytes=JSON.stringify({format:1,session,replay,budget});
    const prior=this.pending.get(session)||Promise.resolve();
    const writing=prior.catch(()=>{}).then(()=>withStorageFailure('match session',async()=>{
      await mkdir(this.directory,{recursive:true});
      const temp=`${target}.${randomUUID()}.tmp`;
      try {
        const file=await open(temp,'wx',0o600);
        try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
        await rename(temp,target);await this.syncFolder(this.directory);
      } finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    }));
    this.pending.set(session,writing);
    void writing.finally(()=>{if(this.pending.get(session)===writing)this.pending.delete(session);}).catch(()=>{});
    return writing;
  }
  async load(){
    let names;try{names=await readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const files=names.filter(name=>name.endsWith('.json')).sort();
    if(files.length>100)throw new Error('Stored session limit exceeded');
    const records=[];
    for(const name of files){
      const session=name.slice(0,-5),target=this.file(session);
      const record=JSON.parse(await readFile(target,'utf8'));
      if(record.format!==1||record.session!==session||!record.replay||!record.budget)throw new Error(`Invalid checkpoint: ${name}`);
      records.push(record);
    }
    return records;
  }
  async archive(session,matchId){
    if(!/^seat-[a-f0-9]{64}$/.test(matchId))throw new Error('Invalid archived match identifier');
    const target=this.archiveFile(session),temp=`${target}.${randomUUID()}.tmp`;
    const directory=path.dirname(target);
    await withStorageFailure('finished-session archive',async()=>{
      await mkdir(directory,{recursive:true});
      try{const file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify({format:1,session,match_id:matchId}));await file.sync();}finally{await file.close();}await rename(temp,target);await this.syncFolder(directory);}
      finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });
  }
  async archivedMatch(session){
    let record;try{record=JSON.parse(await readFile(this.archiveFile(session),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(record.format!==1||record.session!==session||!/^seat-[a-f0-9]{64}$/.test(record.match_id))throw new Error('Invalid finished-session archive');
    return record.match_id;
  }
  async remove(session){
    await this.pending.get(session)?.catch(()=>{});
    await unlink(this.file(session)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
