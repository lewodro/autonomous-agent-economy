import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ArenaRoomPool } from './arena-rooms.js';
import { ArenaSurvivalService } from './arena-survival.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_INSTANCES=40;
const MAX_ACTIVE=20;
const AGENT_NAME=/^[A-Za-z][A-Za-z0-9 _-]{1,31}$/;
const STRATEGIES=new Set(['balanced','aggressive','conservative','opportunist','cooperative']);
export function validatePrivateAgent(input={}){
  if(!input||typeof input!=='object'||!AGENT_NAME.test(input.name||''))throw Object.assign(new Error('Agent name must be 2-32 letters, numbers, spaces, _ or -'),{status:400});
  if(!STRATEGIES.has(input.strategy))throw Object.assign(new Error('Choose an approved built-in strategy'),{status:400});
  const mcp=input.mcp===undefined?{controller_type:'builtin',endpoint:null,capabilities:[]}:input.mcp;
  if(!mcp||!['builtin','mcp'].includes(mcp.controller_type))throw Object.assign(new Error('Invalid controller type'),{status:400});
  if(mcp.controller_type==='mcp'){
    if(typeof mcp.endpoint!=='string')throw Object.assign(new Error('MCP endpoint is required'),{status:400});
    let endpoint;try{endpoint=new URL(mcp.endpoint);}catch{throw Object.assign(new Error('MCP endpoint must be HTTPS'),{status:400});}
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw Object.assign(new Error('MCP endpoint must be HTTPS without embedded credentials'),{status:400});
    if(!Array.isArray(mcp.capabilities)||mcp.capabilities.length>6||!mcp.capabilities.every(value=>typeof value==='string'&&/^[a-z_]{1,32}$/.test(value)))throw Object.assign(new Error('Invalid MCP capabilities'),{status:400});
    return {name:input.name.trim(),strategy:input.strategy,mcp:{controller_type:'mcp',endpoint:endpoint.toString(),capabilities:[...new Set(mcp.capabilities)]}};
  }
  return {name:input.name.trim(),strategy:input.strategy,mcp:{controller_type:'builtin',endpoint:null,capabilities:[]}};
}

class PrivateArenaSession {
  constructor(core,directory,owner){
    this.owner=owner;this.directory=directory;this.rooms=new ArenaRoomPool(path.join(directory,'rooms'));this.survival=new ArenaSurvivalService(core,path.join(directory,'survival'),{profiles:()=>this.rooms.profiles()});this.started=false;this.createdAt=new Date().toISOString();this.customAgent=null;
  }
  async restore(){await mkdir(this.directory,{recursive:true});try{this.customAgent=validatePrivateAgent(JSON.parse(await readFile(path.join(this.directory,'agent.json'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}this.rooms.setAgentOverride(this.customAgent);await this.rooms.restore();this.rooms.setAgentOverride(this.customAgent);await this.survival.restore();}
  async setAgent(input){if(this.started)throw Object.assign(new Error('Pause your private arena before changing its agent'),{status:409});this.customAgent=validatePrivateAgent(input);this.rooms.setAgentOverride(this.customAgent);await writeFile(path.join(this.directory,'agent.json'),JSON.stringify(this.customAgent),{mode:0o600});return this.view();}
  start(){if(this.started)return;this.rooms.start();this.survival.start();this.started=true;}
  async stop(){if(!this.started)return;await this.rooms.close();await this.survival.close();this.started=false;}
  view(){const statistics=this.survival.statistics(this.rooms.statistics());return {owner_scoped:true,started:this.started,created_at:this.createdAt,custom_agent:this.customAgent,rooms:this.rooms.listRooms(),survival:this.survival.snapshot(),statistics,history:[...this.rooms.history(),...this.survival.history()].sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))).slice(0,120)};}
  export(){const view=this.view();return {version:1,mode:'private-arena-simulation',created_at:this.createdAt,custom_agent:view.custom_agent,modes:['rps','tictactoe','survival'],statistics:view.statistics,rooms:view.rooms,survival:view.survival,history:view.history};}
  async close(){await this.rooms.close();await this.survival.close();}
}

/** Owner-scoped private RPS, Tic-Tac-Toe, and Survival arenas. */
export class PrivateArenaManager {
  constructor(core,directory,{maxInstances=MAX_INSTANCES,maxActive=MAX_ACTIVE}={}){this.core=core;this.directory=directory;this.maxInstances=maxInstances;this.maxActive=maxActive;this.sessions=new Map();this.loading=new Map();}
  validateOwner(owner){if(!UUID.test(owner||''))throw Object.assign(new Error('Invalid private arena owner'),{status:404});return owner;}
  async get(owner){owner=this.validateOwner(owner);const existing=this.sessions.get(owner);if(existing)return existing;const pending=this.loading.get(owner);if(pending)return pending;const task=(async()=>{if(this.sessions.size>=this.maxInstances)throw Object.assign(new Error('Private arena capacity reached'),{status:429});const session=new PrivateArenaSession(this.core,path.join(this.directory,owner),owner);await session.restore();this.sessions.set(owner,session);return session;})();this.loading.set(owner,task);try{return await task;}finally{if(this.loading.get(owner)===task)this.loading.delete(owner);}}
  async start(owner){const session=await this.get(owner);const active=[...this.sessions.values()].filter(value=>value.started).length;if(!session.started&&active>=this.maxActive)throw Object.assign(new Error('Private arena active limit reached'),{status:429});session.start();return session.view();}
  async setAgent(owner,input){return (await this.get(owner)).setAgent(input);}
  async stop(owner){const session=await this.get(owner);await session.close();this.sessions.delete(owner);return (await this.get(owner)).view();}
  async view(owner){return (await this.get(owner)).view();}
  async export(owner){return (await this.get(owner)).export();}
  health(){const sessions=[...this.sessions.values()];return {status:'ok',instances:sessions.length,active:sessions.filter(session=>session.started).length,limits:{instances:this.maxInstances,active:this.maxActive}};}
  async close(){await Promise.allSettled([...this.sessions.values()].map(session=>session.close()));this.sessions.clear();}
}
