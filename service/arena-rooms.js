import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { configureRun } from '../src/config.js';
import { createState } from '../src/economy.js';
import { Orchestrator, eligibility } from '../src/orchestrator.js';
import { validateState } from '../src/storage.js';

const SLOTS = [['rps-1','rps'],['rps-2','rps'],['ttt-1','tictactoe'],['ttt-2','tictactoe']];
const MAX_STEP_RETRIES = 3;
const fresh = () => configureRun({ seed: randomInt(1, 4294967296), rounds:64 });
const completionTime = ({run,match}) => run.state.events.find(event=>event.type==='GAME_FINISHED'&&event.data.matchId===match.id)?.time||'';
/** Bounded, free-to-watch simulations. Never calls the Rust/funded/wallet runtimes. */
export class ArenaRoomPool {
  constructor(directory, { stageMs=1000, restMs=2500, retryMs=500 }={}) {
    this.directory=directory;this.stageMs=stageMs;this.restMs=restMs;this.retryMs=retryMs;this.rooms=new Map();this.closed=false;this.waiters=new Set();
  }
  async restore() {
    await mkdir(this.directory,{recursive:true});
    for(const [id,game] of SLOTS) {
      let saved;
      try { saved=JSON.parse(await readFile(path.join(this.directory,id+'.json'),'utf8')); }
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(saved) {
        if(saved.version!==1||saved.id!==id||saved.game!==game||!Array.isArray(saved.previous)||saved.previous.length>3)throw new Error(`Invalid arena checkpoint: ${id}`);
        for(const run of [saved,...saved.previous]) {
          if(!/^[a-f0-9-]{36}$/.test(run.runId)||run.state.matches.length>64)throw new Error(`Invalid arena run: ${id}`);
          run.state=await validateState(run.state);
          if(run.state.matches.some(m=>(m.type||'rps')!==game))throw new Error(`Arena game mismatch: ${id}`);
        }
      } else saved={version:1,id,game,runId:randomUUID(),state:fresh(),previous:[]};
      this.rooms.set(id,{saved,state:structuredClone(saved.state),phase:'waiting',status:'waiting',current:null});
    }
  }
  listRooms() {
    return [...this.rooms.entries()].map(([id,r])=>({id,game:r.saved.game,status:r.status,phase:r.phase,mode:'simulation',runId:r.saved.runId,
      matchId:r.current?.id||null,participants:(r.current?.players||[]).map(pid=>{
        const a=r.state.agents.find(a=>a.id===pid);return {id:pid,name:a.name,sprite:a.sprite};
      }),url:`/arena/${r.saved.game}/${id}`}));
  }
  getRoom(id) {
    const room=this.rooms.get(id);if(!room)throw Object.assign(new Error('Room not found'),{status:404});
    const state=structuredClone(room.state);
    delete state.events; // Full verified ledgers are available through the explicit log route.
    return {room:this.listRooms().find(r=>r.id===id),state,phase:room.phase,current:structuredClone(room.current)};
  }
  runs() {return [...this.rooms.values()].flatMap(r=>[r.saved,...r.saved.previous].map(run=>({...run,roomId:r.saved.id,game:r.saved.game})));}
  profiles() {
    // Start with retained epochs oldest-first so timestamp ties remain chronological.
    const chronologicalRuns=this.runs().reverse();
    return createState().agents.map(base=>{
      const entries=chronologicalRuns.flatMap(run=>run.state.matches.filter(m=>m.status==='settled'&&m.players.includes(base.id)).map(match=>({run,match})))
        .sort((a,b)=>completionTime(a).localeCompare(completionTime(b)));
      const wins=entries.filter(({match})=>match.result!=='draw'&&match.players[match.result==='a'?0:1]===base.id).length;
      const draws=entries.filter(({match})=>match.result==='draw').length;
      const latest=entries.at(-1);
      const live=this.listRooms().find(r=>['live','starting'].includes(r.status)&&r.participants.some(a=>a.id===base.id));
      return {id:base.id,name:base.name,sprite:base.sprite,strategy:base.strategy,wins,draws,losses:entries.length-wins-draws,matches:entries.length,scope:'retained arena runs',
        recentWinner:!!latest&&latest.match.result!=='draw'&&latest.match.players[latest.match.result==='a'?0:1]===base.id,
        roomId:live?.id||null,
        memory:entries.slice(-6).map(({run,match})=>({...run.state.agents.find(a=>a.id===base.id).memory.find(m=>m.matchId===match.id),runId:run.runId,game:run.game})),
        latestMatch:latest?{runId:latest.run.runId,matchId:latest.match.id,game:latest.run.game}:null};
    });
  }
  history() {
    return this.runs().reverse().flatMap(run=>run.state.matches.map(match=>({runId:run.runId,roomId:run.roomId,game:run.game,id:match.id,result:match.result,
      players:match.players.map(id=>({id,name:run.state.agents.find(a=>a.id===id).name})),
      moves:match.type==='tictactoe'?match.moves.map((move,i)=>({turn:i+1,agent:move.agentId,action:'place',cell:[Math.floor(move.cell/3),move.cell%3]}))
        :match.players.map(id=>({round:1,agent:id,action:match.reveals[id].move})),
      completedAt:run.state.events.find(e=>e.type==='GAME_FINISHED'&&e.data.matchId===match.id)?.time,
      logUrl:`/api/arena/logs/${run.runId}`}))).sort((a,b)=>(a.completedAt||'').localeCompare(b.completedAt||'')).reverse().slice(0,60);
  }
  log(runId) {
    const run=this.runs().find(r=>r.runId===runId);
    if(!run)throw Object.assign(new Error('This retained run is no longer available'),{status:404});
    return structuredClone({version:1,mode:'simulation',runId,roomId:run.roomId,game:run.game,state:run.state});
  }
  async checkpoint(room) {
    const saved={...room.saved,state:structuredClone(room.state)};
    const target=path.join(this.directory,saved.id+'.json'),temp=target+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify(saved),{mode:0o600});await rename(temp,target);room.saved=saved;
  }
  async step(id) {
    const room=this.rooms.get(id);if(!room)throw new Error('Unknown room');
    if(room.running)throw new Error('Room is already running');
    if(room.state.matches.length>=64||room.state.agents.filter(a=>eligibility(room.state,a).eligible).length<2){
      room.saved={...room.saved,runId:randomUUID(),state:fresh(),previous:[{runId:room.saved.runId,state:room.saved.state},...room.saved.previous].slice(0,3)};
      room.state=structuredClone(room.saved.state);
    }
    room.status='starting';room.running=true;
    const orchestrator=new Orchestrator(room.state,{onStage:async(phase,match)=>{
      room.phase=phase;room.current=match;room.status=phase==='settle'?'finished':'live';
      if(this.stageMs)await this.delay(this.stageMs);
    },onSave:()=>this.checkpoint(room)});
    try {await orchestrator.step(null,room.saved.game);room.status='finished';}
    catch(error){room.state=structuredClone(room.saved.state);room.current=room.state.matches.at(-1)||null;room.status='failed';throw error;}
    finally {room.running=false;}
  }
  delay(ms) {return new Promise(resolve=>{const done=()=>{clearTimeout(timer);this.waiters.delete(done);resolve();};const timer=setTimeout(done,ms);this.waiters.add(done);});}
  start() {
    if(this.started)return;this.started=true;
    for(const id of this.rooms.keys())this.run(id);
  }
  async run(id) {
    let failures=0;
    while(!this.closed){
      try{await this.step(id);failures=0;}
      catch{
        failures++;
        const retrying=failures<=MAX_STEP_RETRIES;
        console.error(JSON.stringify({event:'arena_room_failed',roomId:id,attempt:failures,retrying}));
        if(!retrying)break;
        await this.delay(Math.min(5000,this.retryMs*2**(failures-1)));
        continue;
      }
      if(!this.closed)await this.delay(this.restMs);
      if(!this.closed){this.rooms.get(id).status='resetting';this.rooms.get(id).phase='waiting';}
    }
  }
  close(){this.closed=true;for(const done of this.waiters)done();}
}
