import {mkdir,open,rename,unlink,readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withStorageFailure} from './http-error.js';

async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
const matchIdPattern=/^seat-[a-f0-9]{64}$/;
const MAX_REPLAY_BYTES=32_000_000,MAX_ARCHIVE_RECORDS=1000,MAX_ARCHIVE_BYTES=256*1024*1024;

/** Atomically stores verified replay records with bounded newest-first retention. */
export class ReplayArchive {
  constructor(directory,{syncFolder=syncDirectory,maxRecords=MAX_ARCHIVE_RECORDS,maxBytes=MAX_ARCHIVE_BYTES,maxReplayBytes=MAX_REPLAY_BYTES}={}){
    if(!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>MAX_ARCHIVE_RECORDS||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_ARCHIVE_BYTES||!Number.isSafeInteger(maxReplayBytes)||maxReplayBytes<1||maxReplayBytes>MAX_REPLAY_BYTES)throw new Error('Invalid replay archive limits');
    this.directory=directory;this.syncFolder=syncFolder;this.maxRecords=maxRecords;this.maxBytes=maxBytes;this.maxReplayBytes=maxReplayBytes;this.pending=Promise.resolve();
  }
  file(matchId){if(typeof matchId!=='string'||!matchIdPattern.test(matchId))throw new Error('Invalid replay match identifier');return path.join(this.directory,`${matchId}.json`);}
  async save(replay){
    const operation=this.pending.then(()=>this.saveOne(replay));this.pending=operation.catch(()=>{});return operation;
  }
  async saveOne(replay){
    const target=this.file(replay?.match_id),temp=`${target}.${randomUUID()}.tmp`;
    const bytes=JSON.stringify(replay);
    if(!bytes||!replay?.final_state||!Array.isArray(replay.events))throw new Error('Invalid replay archive record');
    const size=Buffer.byteLength(bytes);
    if(size>this.maxReplayBytes||size>this.maxBytes)throw Object.assign(new Error('Replay exceeds the archive record limit'),{status:413,code:'REPLAY_TOO_LARGE'});
    await withStorageFailure('replay archive',async()=>{
      await mkdir(this.directory,{recursive:true});
      try{
        const file=await open(temp,'wx',0o600);
        try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
        await rename(temp,target);
        await this.syncFolder(this.directory);
        const records=[];let totalBytes=0;
        for(const entry of await readdir(this.directory,{withFileTypes:true})){
          if(!entry.isFile()||!matchIdPattern.test(entry.name.slice(0,-5))||!entry.name.endsWith('.json'))continue;
          const filePath=path.join(this.directory,entry.name),metadata=await stat(filePath);
          records.push({path:filePath,name:entry.name,size:metadata.size,modified:metadata.mtimeMs});totalBytes+=metadata.size;
        }
        records.sort((a,b)=>a.modified-b.modified||a.name.localeCompare(b.name));
        let removed=false;
        while(records.length>this.maxRecords||totalBytes>this.maxBytes){
          const index=records.findIndex(record=>record.path!==target);
          if(index<0)throw new Error('Replay archive capacity could not retain the newest record');
          const [oldest]=records.splice(index,1);await unlink(oldest.path);totalBytes-=oldest.size;removed=true;
        }
        if(removed)await this.syncFolder(this.directory);
      }finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });
    return target;
  }
  async load(matchId){
    let replay;try{replay=JSON.parse(await readFile(this.file(matchId),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(replay?.match_id!==matchId||!replay?.final_state||!Array.isArray(replay.events))throw new Error('Invalid replay archive');
    return replay;
  }
}
