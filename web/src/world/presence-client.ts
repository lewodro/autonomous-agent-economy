export interface PresencePosition {x:number;y:number}
export interface PresencePlayer {
  player_id:string;avatar:string;position:PresencePosition;direction:'up'|'down'|'left'|'right';
  animation_state:'idle'|'walk';activity:string;updated_at:string;
}
export interface PresenceSnapshot {world_id:string;players:PresencePlayer[]}
export type PresenceEvent =
  | ({type:'WorldJoined'}&PresenceSnapshot)
  | {type:'PlayerJoined'|'PlayerMoved'|'PlayerUpdated';world_id:string;player:PresencePlayer}
  | {type:'PlayerLeft';world_id:string;player_id:string;reason?:string};
interface ResponseLike {ok:boolean;status:number;json():Promise<unknown>}
interface EventSourceLike {
  addEventListener(type:string,listener:(event:MessageEvent<string>)=>void):void;
  close():void;
}
interface PresenceStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
interface PresenceOptions {
  worldId?:string;avatar:string;position:PresencePosition;direction?:PresencePlayer['direction'];activity?:string;
  fetcher?:(url:string,init?:RequestInit)=>Promise<ResponseLike>;
  eventSource?:(url:string)=>EventSourceLike;storage?:PresenceStorage;
  onPlayers?:(snapshot:PresenceSnapshot)=>void;onConnection?:(state:'connected'|'reconnecting'|'closed')=>void;
  now?:()=>number;newId?:()=>string;moveIntervalMs?:number;heartbeatIntervalMs?:number;
}
const sessionPrefix='aae-world-presence-v1:';
const eventNames=['WorldJoined','PlayerJoined','PlayerMoved','PlayerUpdated','PlayerLeft'] as const;

/** HTTP commands plus a snapshot-first SSE feed; this adapter has no game authority. */
export class WorldPresenceClient {
  private worldId:string;
  private fetcher:(url:string,init?:RequestInit)=>Promise<ResponseLike>;
  private createEventSource:(url:string)=>EventSourceLike;
  private storage?:PresenceStorage;
  private onPlayers:(snapshot:PresenceSnapshot)=>void;
  private onConnection:(state:'connected'|'reconnecting'|'closed')=>void;
  private now:()=>number;
  private moveIntervalMs:number;
  private heartbeatIntervalMs:number;
  private playerId:string;
  private token:string|null=null;
  private source?:EventSourceLike;
  private streamGeneration=0;
  private players=new Map<string,PresencePlayer>();
  private lastMoveAt=0;
  private lastHeartbeatAt=0;
  private closed=false;
  private moveInFlight=false;
  private heartbeatInFlight=false;
  private listeners:Array<[string,(event:MessageEvent<string>)=>void]>=[];
  private connecting?:Promise<PresenceSnapshot>;

  constructor(private options:PresenceOptions){
    this.worldId=options.worldId||'main';
    this.fetcher=options.fetcher||fetch;
    this.createEventSource=options.eventSource||((url)=>new EventSource(url));
    if(options.storage!==undefined)this.storage=options.storage;
    else try{this.storage=globalThis.sessionStorage;}catch{this.storage=undefined;}
    this.onPlayers=options.onPlayers||(()=>{});
    this.onConnection=options.onConnection||(()=>{});
    this.now=options.now||(()=>Date.now());
    this.moveIntervalMs=options.moveIntervalMs||66;
    this.heartbeatIntervalMs=options.heartbeatIntervalMs||1_000;
    this.playerId=this.storage?.getItem(`${sessionPrefix}${this.worldId}:player`)||`player_${(options.newId||(()=>globalThis.crypto?.randomUUID?.()||`${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`))()}`;
  }

  async connect():Promise<PresenceSnapshot>{
    if(this.connecting){
      if(!this.closed)return this.connecting;
      await this.connecting.catch(()=>undefined);
      return this.connect();
    }
    this.closed=false;this.source?.close();this.source=undefined;
    this.listeners=[];this.streamGeneration++;
    const connection=this.connectAndSubscribe();
    this.connecting=connection;
    try{return await connection;}finally{if(this.connecting===connection)this.connecting=undefined;}
  }

  private async connectAndSubscribe():Promise<PresenceSnapshot>{
    this.token=this.storage?.getItem(`${sessionPrefix}${this.worldId}:token`)||null;
    const joined=await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/join`,{
      player_id:this.playerId,session_token:this.token||undefined,avatar:this.options.avatar,
      position:this.options.position,direction:this.options.direction||'down',activity:this.options.activity||'Exploring',
    });
    const snapshot=joined as PresenceSnapshot&{player?:PresencePlayer;session_token?:string};
    if(!snapshot||snapshot.world_id!==this.worldId||!Array.isArray(snapshot.players)||typeof snapshot.session_token!=='string'||!snapshot.session_token){
      throw new Error('World presence returned an invalid join response');
    }
    this.token=snapshot.session_token;
    this.storage?.setItem(`${sessionPrefix}${this.worldId}:player`,this.playerId);
    this.storage?.setItem(`${sessionPrefix}${this.worldId}:token`,this.token);
    this.lastMoveAt=this.now();this.lastHeartbeatAt=this.now();
    this.replace(snapshot);
    if(this.closed)return {world_id:this.worldId,players:[...this.players.values()]};
    const generation=this.streamGeneration;
    const url=`/api/worlds/${encodeURIComponent(this.worldId)}/presence/events`;
    this.source=this.createEventSource(url);
    for(const type of eventNames){
      const listener=(event:MessageEvent<string>)=>{if(generation===this.streamGeneration)this.receive(type,event.data);};
      this.listeners.push([type,listener]);this.source.addEventListener(type,listener);
    }
    this.source.addEventListener('open',()=>{if(!this.closed&&generation===this.streamGeneration)this.onConnection('connected');});
    this.source.addEventListener('error',()=>{if(!this.closed&&generation===this.streamGeneration)this.onConnection('reconnecting');});
    return {world_id:this.worldId,players:[...this.players.values()]};
  }

  get player_id():string{return this.playerId;}
  snapshot():PresenceSnapshot{return {world_id:this.worldId,players:[...this.players.values()]};}

  async move(position:PresencePosition,direction:PresencePlayer['direction'],animation_state:PresencePlayer['animation_state']):Promise<boolean>{
    if(this.closed||!this.token||this.moveInFlight||this.now()-this.lastMoveAt<this.moveIntervalMs)return false;
    this.moveInFlight=true;this.lastMoveAt=this.now();
    try{
      await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/move`,{
        player_id:this.playerId,session_token:this.token,position,direction,animation_state,
      });
      return true;
    }finally{this.moveInFlight=false;}
  }

  async heartbeat(activity?:string):Promise<boolean>{
    if(this.closed||!this.token||this.heartbeatInFlight||this.now()-this.lastHeartbeatAt<this.heartbeatIntervalMs)return false;
    this.heartbeatInFlight=true;this.lastHeartbeatAt=this.now();
    try{
      await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/heartbeat`,{
        player_id:this.playerId,session_token:this.token,...(activity===undefined?{}:{activity}),
      });
      return true;
    }finally{this.heartbeatInFlight=false;}
  }

  async leave():Promise<void>{
    if(this.closed)return;
    if(this.connecting)await this.connecting.catch(()=>undefined);
    if(this.closed)return;
    this.closed=true;this.streamGeneration++;this.source?.close();this.source=undefined;this.listeners=[];
    try{
      if(this.token)await this.request(`/api/worlds/${encodeURIComponent(this.worldId)}/presence/leave`,{player_id:this.playerId,session_token:this.token});
    }finally{
      this.token=null;this.storage?.removeItem(`${sessionPrefix}${this.worldId}:token`);this.onConnection('closed');
    }
  }

  close():void{
    if(this.closed)return;this.closed=true;this.streamGeneration++;this.source?.close();this.source=undefined;this.listeners=[];
    this.onConnection('closed');
  }

  private async request(path:string,body:Record<string,unknown>):Promise<unknown>{
    const response=await this.fetcher(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5_000)});
    const result=await response.json() as {error?:string;code?:string};
    if(!response.ok)throw new Error(result?.error||`World presence request failed (${response.status})`);
    return result;
  }

  private receive(type:string,raw:string):void{
    if(this.closed)return;
    let value:Record<string,unknown>;
    try{value=JSON.parse(raw) as Record<string,unknown>;}catch{return;}
    if(value.world_id!==this.worldId)return;
    if(type==='WorldJoined'){
      if(!Array.isArray(value.players))return;
      this.replace(value as unknown as PresenceSnapshot);return;
    }
    if(type==='PlayerLeft'){
      if(typeof value.player_id!=='string')return;
      this.players.delete(value.player_id);this.publish();return;
    }
    const player=value.player as PresencePlayer|undefined;
    if(!player||typeof player.player_id!=='string'||!player.position||!Number.isFinite(player.position.x)||!Number.isFinite(player.position.y))return;
    this.players.set(player.player_id,player);this.publish();
  }

  private replace(snapshot:PresenceSnapshot):void{
    this.players=new Map(snapshot.players.filter(player=>player&&typeof player.player_id==='string').map(player=>[player.player_id,player]));
    this.publish();
  }
  private publish():void{this.onPlayers(this.snapshot());}
}
