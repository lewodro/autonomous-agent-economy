export interface PresencePosition {x:number;y:number}
export interface PresencePlayer {
  player_id:string;display_name:string;avatar:string;position:PresencePosition;direction:'up'|'down'|'left'|'right';
  animation_state:'idle'|'walk';activity:string;updated_at:string;
}
export interface PresenceAgent extends PresencePlayer {agent_id:string;strategy:string;kind:'canonical_agent'}
export interface PresenceSnapshot {world_id:string;players:PresencePlayer[];agents:PresenceAgent[]}
export type PresenceEvent=
  |({type:'WorldJoined'}&PresenceSnapshot)
  |{type:'PlayerJoined'|'PlayerMoved'|'PlayerUpdated';world_id:string;player:PresencePlayer}
  |{type:'PlayerLeft';world_id:string;player_id:string;reason?:string}
  |{type:'AgentJoined'|'AgentMoved'|'AgentUpdated';world_id:string;agent:PresenceAgent}
  |{type:'AgentLeft';world_id:string;agent_id:string};
interface ResponseLike {ok:boolean;status:number;json():Promise<unknown>}
interface EventSourceLike {addEventListener(type:string,listener:(event:MessageEvent<string>)=>void):void;close():void}
interface PresenceOptions {
  worldId?:string;avatar:string;position:PresencePosition;direction?:PresencePlayer['direction'];activity?:string;
  fetcher?:(url:string,init?:RequestInit)=>Promise<ResponseLike>;eventSource?:(url:string)=>EventSourceLike;
  onPlayers?:(snapshot:PresenceSnapshot)=>void;onConnection?:(state:'connected'|'reconnecting'|'closed')=>void;
  now?:()=>number;moveIntervalMs?:number;heartbeatIntervalMs?:number;
}
const eventNames=['WorldJoined','PlayerJoined','PlayerMoved','PlayerUpdated','PlayerLeft','AgentJoined','AgentMoved','AgentUpdated','AgentLeft'] as const;

/** Cookie-owned HTTP commands plus a snapshot-first SSE feed; the browser owns no identity capability. */
export class WorldPresenceClient {
  private worldId:string;private fetcher:(url:string,init?:RequestInit)=>Promise<ResponseLike>;private createEventSource:(url:string)=>EventSourceLike;
  private onPlayers:(snapshot:PresenceSnapshot)=>void;private onConnection:(state:'connected'|'reconnecting'|'closed')=>void;private now:()=>number;
  private moveIntervalMs:number;private heartbeatIntervalMs:number;private playerId='';private source?:EventSourceLike;private streamGeneration=0;
  private players=new Map<string,PresencePlayer>();private agents=new Map<string,PresenceAgent>();private lastMoveAt=0;private lastHeartbeatAt=0;
  private closed=false;private moveInFlight=false;private heartbeatInFlight=false;private listeners:Array<[string,(event:MessageEvent<string>)=>void]>=[];private connecting?:Promise<PresenceSnapshot>;
  constructor(private options:PresenceOptions){this.worldId=options.worldId||'main';this.fetcher=options.fetcher||fetch;this.createEventSource=options.eventSource||((url)=>new EventSource(url));this.onPlayers=options.onPlayers||(()=>{});this.onConnection=options.onConnection||(()=>{});this.now=options.now||(()=>Date.now());this.moveIntervalMs=options.moveIntervalMs||66;this.heartbeatIntervalMs=options.heartbeatIntervalMs||1_000;}
  async connect():Promise<PresenceSnapshot>{if(this.connecting){if(!this.closed)return this.connecting;await this.connecting.catch(()=>undefined);return this.connect();}this.closed=false;this.source?.close();this.source=undefined;this.listeners=[];this.streamGeneration++;const connection=this.connectAndSubscribe();this.connecting=connection;try{return await connection;}finally{if(this.connecting===connection)this.connecting=undefined;}}
  private async connectAndSubscribe():Promise<PresenceSnapshot>{
    const joined=await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/join`,{avatar:this.options.avatar,position:this.options.position,direction:this.options.direction||'down',activity:this.options.activity||'Exploring'});
    const snapshot=joined as PresenceSnapshot&{player?:PresencePlayer;presence_id?:string};
    if(!snapshot||snapshot.world_id!==this.worldId||!Array.isArray(snapshot.players)||!Array.isArray(snapshot.agents)||!snapshot.player||typeof snapshot.presence_id!=='string'||snapshot.player.player_id!==snapshot.presence_id)throw new Error('World presence returned an invalid join response');
    this.playerId=snapshot.presence_id;this.lastMoveAt=this.now();this.lastHeartbeatAt=this.now();this.replace(snapshot);
    if(this.closed)return this.snapshot();
    const generation=this.streamGeneration,url=`/api/worlds/${encodeURIComponent(this.worldId)}/presence/events`;this.source=this.createEventSource(url);
    for(const type of eventNames){const listener=(event:MessageEvent<string>)=>{if(generation===this.streamGeneration)this.receive(type,event.data);};this.listeners.push([type,listener]);this.source.addEventListener(type,listener);}
    this.source.addEventListener('open',()=>{if(!this.closed&&generation===this.streamGeneration)this.onConnection('connected');});
    this.source.addEventListener('error',()=>{if(!this.closed&&generation===this.streamGeneration)this.onConnection('reconnecting');});
    return this.snapshot();
  }
  get player_id():string{return this.playerId;}
  snapshot():PresenceSnapshot{return{world_id:this.worldId,players:[...this.players.values()],agents:[...this.agents.values()]};}
  async updateAvatar(avatar:string):Promise<PresenceSnapshot>{this.options.avatar=avatar;return this.connect();}
  async move(position:PresencePosition,direction:PresencePlayer['direction'],animation_state:PresencePlayer['animation_state']):Promise<boolean>{if(this.closed||!this.playerId||this.moveInFlight||this.now()-this.lastMoveAt<this.moveIntervalMs)return false;this.moveInFlight=true;this.lastMoveAt=this.now();try{await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/move`,{position,direction,animation_state});return true;}finally{this.moveInFlight=false;}}
  async heartbeat(activity?:string):Promise<boolean>{if(this.closed||!this.playerId||this.heartbeatInFlight||this.now()-this.lastHeartbeatAt<this.heartbeatIntervalMs)return false;this.heartbeatInFlight=true;this.lastHeartbeatAt=this.now();try{await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/heartbeat`,activity===undefined?{}:{activity});return true;}finally{this.heartbeatInFlight=false;}}
  async leave():Promise<void>{if(this.closed)return;if(this.connecting)await this.connecting.catch(()=>undefined);if(this.closed)return;this.closed=true;this.streamGeneration++;this.source?.close();this.source=undefined;this.listeners=[];try{if(this.playerId)await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/leave`,{});}finally{this.playerId='';this.onConnection('closed');}}
  close():void{if(this.closed)return;this.closed=true;this.streamGeneration++;this.source?.close();this.source=undefined;this.listeners=[];this.onConnection('closed');}
  private async request(path:string,body:Record<string,unknown>):Promise<unknown>{const response=await this.fetcher(path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body),signal:AbortSignal.timeout(5_000)});const result=await response.json() as{error?:string;code?:string};if(!response.ok)throw Object.assign(new Error(result?.error||`World presence request failed (${response.status})`),{status:response.status,code:result?.code});return result;}
  private receive(type:string,raw:string):void{if(this.closed)return;let value:Record<string,unknown>;try{value=JSON.parse(raw) as Record<string,unknown>;}catch{return;}if(value.world_id!==this.worldId)return;if(type==='WorldJoined'){if(!Array.isArray(value.players)||!Array.isArray(value.agents))return;this.replace(value as unknown as PresenceSnapshot);return;}if(type==='PlayerLeft'){if(typeof value.player_id!=='string')return;this.players.delete(value.player_id);this.publish();return;}if(type==='AgentLeft'){if(typeof value.agent_id!=='string')return;this.agents.delete(value.agent_id);this.publish();return;}if(type.startsWith('Agent')){const agent=value.agent as PresenceAgent|undefined;if(!agent||typeof agent.agent_id!=='string'||!agent.position||!Number.isFinite(agent.position.x)||!Number.isFinite(agent.position.y))return;this.agents.set(agent.agent_id,agent);this.publish();return;}const player=value.player as PresencePlayer|undefined;if(!player||typeof player.player_id!=='string'||!player.position||!Number.isFinite(player.position.x)||!Number.isFinite(player.position.y))return;this.players.set(player.player_id,player);this.publish();}
  private replace(snapshot:PresenceSnapshot):void{this.players=new Map(snapshot.players.filter(player=>player&&typeof player.player_id==='string').map(player=>[player.player_id,player]));this.agents=new Map(snapshot.agents.filter(agent=>agent&&typeof agent.agent_id==='string').map(agent=>[agent.agent_id,agent]));this.publish();}
  private publish():void{this.onPlayers(this.snapshot());}
}
