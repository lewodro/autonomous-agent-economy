import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createState } from '../src/economy.js';
import { playCell, verifyTicTacToeProof } from '../src/tictactoe.js';
import { chooseTicTacToeCell } from '../src/strategies.js';
import { withStorageFailure } from './http-error.js';
import { readBoundedJson } from './safe-json.js';
const MAX_TABLE_SNAPSHOT_BYTES=64*1024;
const MOVE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const empty = (revision,now=Date.now()) => ({version:1,id:'plaza-table',status:'empty',revision,players:[],match:null,updatedAt:now});
async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
export const visitorHash = token => createHash('sha256').update(token).digest('hex');
export function visitorIdentity(req) {
  const token=req.headers.cookie?.match(/(?:^|;\s*)world_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1]||randomUUID();
  return {token,hash:visitorHash(token)};
}
/** Seating/capabilities are separate from the existing deterministic board rules. Free only. */
export class TableSession {
  constructor(directory,{syncFolder=syncDirectory,now=Date.now}={}){this.directory=directory;this.syncFolder=syncFolder;this.now=now;this.state=empty(0,this.now());this.tail=Promise.resolve();this.lastSeen=new Map();}
  async restore(){
    await mkdir(this.directory,{recursive:true});let saved;
    try{saved=await readBoundedJson(path.join(this.directory,'table.json'),{maxBytes:MAX_TABLE_SNAPSHOT_BYTES,label:'World table checkpoint'});}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!saved)return;
    if(saved.version!==1||saved.id!=='plaza-table'||!['empty','waiting','ready','playing','finished'].includes(saved.status)
      ||!Array.isArray(saved.players)||saved.players.length>2||!Number.isSafeInteger(saved.revision)||saved.revision<0||!Number.isFinite(saved.updatedAt))throw new Error('Invalid table checkpoint');
    const players=saved.players;
    if(players.some(p=>!['human','npc'].includes(p.kind)||!['human-x','human-o','npc-founder'].includes(p.id)||
      (p.kind==='human'&&(!/^[a-f0-9]{64}$/.test(p.credential)||p.id==='npc-founder'))||
      (p.kind==='npc'&&(p.id!=='npc-founder'||p.credential!==undefined)))||new Set(players.map(p=>p.id)).size!==players.length||
      new Set(players.filter(p=>p.kind==='human').map(p=>p.credential)).size!==players.filter(p=>p.kind==='human').length||
      (players[0]&&players[0].id!=='human-x')||(players[1]&&!['human-o','npc-founder'].includes(players[1].id)))throw new Error('Invalid table seats');
    if((saved.status==='empty')!==(players.length===0)||(saved.status==='waiting')!==(players.length===1)||
      (players.length<2)!==(saved.match===null))throw new Error('Invalid table lifecycle');
    if(saved.match){
      const m=saved.match;let board=Array(9).fill(null),result=null;
      if(m.type!=='tictactoe'||!Array.isArray(m.moves)||m.moves.length>9||JSON.stringify(m.players)!==JSON.stringify(players.map(p=>p.id)))throw new Error('Invalid table match');
      const moveIds=new Set();
      for(const move of m.moves){
        if(move.move_id!==undefined&&(!MOVE_ID.test(move.move_id)||moveIds.has(move.move_id)))throw new Error('Invalid table move IDs');
        if(move.move_id!==undefined)moveIds.add(move.move_id);
        const index=m.players.indexOf(move.agentId);({board,result}=playCell(board,index===0?'a':index===1?'b':null,move.cell));
      }
      if(JSON.stringify(board)!==JSON.stringify(m.board)||result!==m.result||
        (saved.status==='finished')!==(result!==null)||m.status!==(result===null?'playing':'settled')||
        (saved.status==='ready'&&m.moves.length))throw new Error('Invalid table result');
      if(result!==null&&!verifyTicTacToeProof(m))throw new Error('Invalid table proof');
    }
    this.state=saved;
    const restoredAt=this.now();
    for(const player of saved.players)if(player.kind==='human')this.lastSeen.set(player.credential,restoredAt);
  }
  isExpired(state){
    if(state.status==='empty')return false;
    const ttl=state.status==='waiting'?120_000:600_000;
    let lastActivity=state.updatedAt;
    for(const player of state.players)if(player.kind==='human')lastActivity=Math.max(lastActivity,this.lastSeen.get(player.credential)||0);
    return this.now()>=lastActivity+ttl;
  }
  snapshot(credential){
    const state=structuredClone(this.state);
    if(this.isExpired(this.state))return {...empty(state.revision,this.now()),yourSeat:null,mode:'free',expired:true};
    if(state.players.some(player=>player.kind==='human'&&player.credential===credential))this.lastSeen.set(credential,this.now());
    const yourSeat=state.players.find(p=>p.credential===credential)?.id||null;
    return {...state,mode:'free',yourSeat,players:state.players.map(({credential,...safe})=>safe)};
  }
  observe(credential){
    const task=this.tail.then(async()=>{
      if(this.isExpired(this.state)){
        const next=empty(this.state.revision,this.now());
        await this.persist(next);this.lastSeen.clear();
        return {...this.snapshot(credential),expired:true};
      }
      return this.snapshot(credential);
    });
    this.tail=task.catch(()=>{});return task;
  }
  async persist(next){
    const file=path.join(this.directory,'table.json'),temporary=file+'.'+randomUUID()+'.tmp';let renamed=false;
    try{
      await withStorageFailure('world table state',async()=>{
        const handle=await open(temporary,'wx',0o600);
        try{await handle.writeFile(JSON.stringify(next));await handle.sync();}finally{await handle.close();}
        await rename(temporary,file);renamed=true;this.state=next;await this.syncFolder(this.directory);
      });
    }finally{if(!renamed)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  act(credential,action,data={}){
    const task=this.tail.then(async()=>{
      if(!/^[a-f0-9]{64}$/.test(credential))throw new Error('Invalid visitor capability');
      let next=structuredClone(this.state);
      if(this.isExpired(next)){next=empty(next.revision,this.now());this.lastSeen.clear();}
      const member=next.players.find(p=>p.credential===credential);
      if(action==='join'){
        if(!['human','npc'].includes(data.mode))throw new Error('Choose human or NPC practice');
        if(member)return this.snapshot(credential);
        if(next.players.length>=2)throw Object.assign(new Error('This table is occupied. Watch or try again shortly.'),{status:409});
        if(data.mode==='npc'&&next.players.length)throw Object.assign(new Error('Another visitor is waiting. Join the human table.'),{status:409});
        next.players.push({id:next.players.length?'human-o':'human-x',name:next.players.length?'Visitor O':'Visitor X',kind:'human',credential});
        if(data.mode==='npc')next.players.push({id:'npc-founder',name:'Founder · practice policy',kind:'npc'});
        next.status=next.players.length===2?'ready':'waiting';
        if(next.status==='ready')next.match={id:randomUUID(),type:'tictactoe',players:next.players.map(p=>p.id),status:'playing',board:Array(9).fill(null),moves:[],result:null};
      }else{
        if(!member)throw Object.assign(new Error('Sit at the table before playing'),{status:403});
        if(action==='leave')next=empty(next.revision);
        else if(action==='start'){
          if(next.status!=='ready')throw new Error('The table is not ready');next.status='playing';
        }else if(action==='move'){
          if(next.status!=='playing')throw new Error('No active table game');
          const match=next.match;
          if(!MOVE_ID.test(data.move_id||''))throw Object.assign(new Error('A UUID v4 move_id is required'),{status:400,code:'MOVE_ID_REQUIRED'});
          const previous=match.moves.find(move=>move.move_id===data.move_id);
          if(previous){
            if(previous.agentId!==member.id||previous.cell!==data.cell)throw Object.assign(new Error('Move ID was already used for another move'),{status:409,code:'MOVE_ID_REUSED'});
            return this.snapshot(credential);
          }
          if(data.revision!==next.revision)throw Object.assign(new Error('The board changed. Try your move again.'),{status:409,code:'TABLE_REVISION_CONFLICT'});
          const play=(id,cell)=>{const marker=match.players.indexOf(id)===0?'a':'b';const result=playCell(match.board,marker,cell);match.board=result.board;match.result=result.result;match.moves.push({agentId:id,cell});};
          play(member.id,data.cell);match.moves.at(-1).move_id=data.move_id;
          if(match.result===null&&next.players[1]?.kind==='npc'){
            const simulation=createState();simulation.rng=(next.revision+1)*97;
            play('npc-founder',chooseTicTacToeCell(simulation,simulation.agents[0],match.board,'b'));
          }
          if(match.result!==null){match.status='settled';next.status='finished';if(!verifyTicTacToeProof(match))throw new Error('Table result verification failed');}
        }else throw new Error('Unsupported table action');
      }
      next.revision++;next.updatedAt=this.now();
      await this.persist(next);
      const activeCredentials=new Set(next.players.filter(player=>player.kind==='human').map(player=>player.credential));
      for(const savedCredential of this.lastSeen.keys())if(!activeCredentials.has(savedCredential))this.lastSeen.delete(savedCredential);
      if(activeCredentials.has(credential))this.lastSeen.set(credential,this.now());
      return this.snapshot(credential);
    });this.tail=task.catch(()=>{});return task;
  }
}
