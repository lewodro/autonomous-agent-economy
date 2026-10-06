import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createState } from '../src/economy.js';
import { playCell, verifyTicTacToeProof } from '../src/tictactoe.js';
import { chooseTicTacToeCell } from '../src/strategies.js';
const empty = revision => ({version:1,id:'plaza-table',status:'empty',revision,players:[],match:null,updatedAt:Date.now()});
export const visitorHash = token => createHash('sha256').update(token).digest('hex');
export function visitorIdentity(req) {
  const token=req.headers.cookie?.match(/(?:^|;\s*)world_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1]||randomUUID();
  return {token,hash:visitorHash(token)};
}
/** Seating/capabilities are separate from the existing deterministic board rules. Free only. */
export class TableSession {
  constructor(directory){this.directory=directory;this.state=empty(0);this.tail=Promise.resolve();}
  async restore(){
    await mkdir(this.directory,{recursive:true});let saved;
    try{saved=JSON.parse(await readFile(path.join(this.directory,'table.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
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
      for(const move of m.moves){const index=m.players.indexOf(move.agentId);({board,result}=playCell(board,index===0?'a':index===1?'b':null,move.cell));}
      if(JSON.stringify(board)!==JSON.stringify(m.board)||result!==m.result||
        (saved.status==='finished')!==(result!==null)||m.status!==(result===null?'playing':'settled')||
        (saved.status==='ready'&&m.moves.length))throw new Error('Invalid table result');
      if(result!==null&&!verifyTicTacToeProof(m))throw new Error('Invalid table proof');
    }
    this.state=saved;
  }
  snapshot(credential){
    const state=structuredClone(this.state);
    const expires=state.updatedAt+(state.status==='waiting'?120_000:600_000);
    if(state.status!=='empty'&&Date.now()>=expires)return {...empty(state.revision),yourSeat:null,mode:'free',expired:true};
    const yourSeat=state.players.find(p=>p.credential===credential)?.id||null;
    return {...state,mode:'free',yourSeat,players:state.players.map(({credential,...safe})=>safe)};
  }
  act(credential,action,data={}){
    const task=this.tail.then(async()=>{
      if(!/^[a-f0-9]{64}$/.test(credential))throw new Error('Invalid visitor capability');
      let next=structuredClone(this.state);
      if(next.status!=='empty'&&Date.now()>=next.updatedAt+(next.status==='waiting'?120_000:600_000))next=empty(next.revision);
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
          if(data.revision!==next.revision)throw Object.assign(new Error('The board changed. Try your move again.'),{status:409});
          const match=next.match;
          const play=(id,cell)=>{const marker=match.players.indexOf(id)===0?'a':'b';const result=playCell(match.board,marker,cell);match.board=result.board;match.result=result.result;match.moves.push({agentId:id,cell});};
          play(member.id,data.cell);
          if(match.result===null&&next.players[1]?.kind==='npc'){
            const simulation=createState();simulation.rng=(next.revision+1)*97;
            play('npc-founder',chooseTicTacToeCell(simulation,simulation.agents[0],match.board,'b'));
          }
          if(match.result!==null){match.status='settled';next.status='finished';if(!verifyTicTacToeProof(match))throw new Error('Table result verification failed');}
        }else throw new Error('Unsupported table action');
      }
      next.revision++;next.updatedAt=Date.now();
      const file=path.join(this.directory,'table.json'),temporary=file+'.'+randomUUID()+'.tmp';
      await writeFile(temporary,JSON.stringify(next),{mode:0o600});await rename(temporary,file);this.state=next;
      return this.snapshot(credential);
    });this.tail=task.catch(()=>{});return task;
  }
}
