import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ArenaRoomPool } from './arena-rooms.js';
import { ArenaSurvivalService } from './arena-survival.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_INSTANCES=40;
const MAX_ACTIVE=20;

class PrivateArenaSession {
  constructor(core,directory,owner){
    this.owner=owner;this.directory=directory;this.rooms=new ArenaRoomPool(path.join(directory,'rooms'));this.survival=new ArenaSurvivalService(core,path.join(directory,'survival'),{profiles:()=>this.rooms.profiles()});this.started=false;this.createdAt=new Date().toISOString();
  }
  async restore(){await mkdir(this.directory,{recursive:true});await this.rooms.restore();await this.survival.restore();}
  start(){if(this.started)return;this.rooms.start();this.survival.start();this.started=true;}
  async stop(){if(!this.started)return;await this.rooms.close();await this.survival.close();this.started=false;}
  view(){const statistics=this.survival.statistics(this.rooms.statistics());return {owner_scoped:true,started:this.started,created_at:this.createdAt,rooms:this.rooms.listRooms(),survival:this.survival.snapshot(),statistics,history:[...this.rooms.history(),...this.survival.history()].sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))).slice(0,120)};}
  export(){const view=this.view();return {version:1,mode:'private-arena-simulation',created_at:this.createdAt,modes:['rps','tictactoe','survival'],statistics:view.statistics,rooms:view.rooms,survival:view.survival,history:view.history};}
  async close(){await this.rooms.close();await this.survival.close();}
}

/** Owner-scoped private RPS, Tic-Tac-Toe, and Survival arenas. */
export class PrivateArenaManager {
  constructor(core,directory,{maxInstances=MAX_INSTANCES,maxActive=MAX_ACTIVE}={}){this.core=core;this.directory=directory;this.maxInstances=maxInstances;this.maxActive=maxActive;this.sessions=new Map();this.loading=new Map();}
  validateOwner(owner){if(!UUID.test(owner||''))throw Object.assign(new Error('Invalid private arena owner'),{status:404});return owner;}
  async get(owner){owner=this.validateOwner(owner);const existing=this.sessions.get(owner);if(existing)return existing;const pending=this.loading.get(owner);if(pending)return pending;const task=(async()=>{if(this.sessions.size>=this.maxInstances)throw Object.assign(new Error('Private arena capacity reached'),{status:429});const session=new PrivateArenaSession(this.core,path.join(this.directory,owner),owner);await session.restore();this.sessions.set(owner,session);return session;})();this.loading.set(owner,task);try{return await task;}finally{if(this.loading.get(owner)===task)this.loading.delete(owner);}}
  async start(owner){const session=await this.get(owner);const active=[...this.sessions.values()].filter(value=>value.started).length;if(!session.started&&active>=this.maxActive)throw Object.assign(new Error('Private arena active limit reached'),{status:429});session.start();return session.view();}
  async stop(owner){const session=await this.get(owner);await session.close();this.sessions.delete(owner);return (await this.get(owner)).view();}
  async view(owner){return (await this.get(owner)).view();}
  async export(owner){return (await this.get(owner)).export();}
  health(){const sessions=[...this.sessions.values()];return {status:'ok',instances:sessions.length,active:sessions.filter(session=>session.started).length,limits:{instances:this.maxInstances,active:this.maxActive}};}
  async close(){await Promise.allSettled([...this.sessions.values()].map(session=>session.close()));this.sessions.clear();}
}
