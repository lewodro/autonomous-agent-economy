import {createHmac} from 'node:crypto';

const IDENTIFIER=/^[a-zA-Z0-9_-]{1,64}$/;
const VISITOR_ID=/^[a-f0-9-]{36}$/;
const DIRECTIONS=new Set(['up','down','left','right']);
const ANIMATIONS=new Set(['idle','walk']);
export const WORLD_PLAYABLE_BOUNDS=Object.freeze({minX:-844,minY:-500,maxX:2636,maxY:1676});

function fail(code,message,status=400){return Object.assign(new Error(message),{code,status});}

/**
 * One process-wide authoritative presence for the continuous public world.
 * Anonymous visitor cookies own actors; browsers never choose public IDs or capabilities.
 */
export class WorldPresenceService {
  constructor({worldIds=['main'],allowedAvatars=['visitor_ember','visitor_atlas','visitor_nova','visitor_echo'],bounds=WORLD_PLAYABLE_BOUNDS,maxPlayers=40,maxViewers=100,staleMs=45_000,minUpdateMs=66,minHeartbeatMs=1_000,identitySecret='local-world-presence-identity-secret',agentPresence=null,now=()=>Date.now()}={}){
    if(!Array.isArray(worldIds)||!worldIds.length||worldIds.some(id=>typeof id!=='string'||!IDENTIFIER.test(id))||new Set(worldIds).size!==worldIds.length)throw new Error('World presence requires unique, valid configured world IDs');
    if(!Array.isArray(allowedAvatars)||!allowedAvatars.length||allowedAvatars.some(id=>typeof id!=='string'||!IDENTIFIER.test(id))||new Set(allowedAvatars).size!==allowedAvatars.length)throw new Error('World presence requires unique, valid approved avatar IDs');
    if(typeof identitySecret!=='string'||identitySecret.length<32)throw new Error('World presence identity secret must contain at least 32 characters');
    this.allowedWorlds=new Set(worldIds);this.allowedAvatars=new Set(allowedAvatars);this.bounds=bounds;this.maxPlayers=maxPlayers;this.maxViewers=maxViewers;this.staleMs=staleMs;this.minUpdateMs=minUpdateMs;this.minHeartbeatMs=minHeartbeatMs;this.identitySecret=identitySecret;this.agentPresence=agentPresence;this.now=now;
    this.worlds=new Map();this.listeners=new Map();
  }
  world(worldId){if(typeof worldId!=='string'||!this.allowedWorlds.has(worldId))throw fail('WORLD_NOT_FOUND','Unknown world',404);let world=this.worlds.get(worldId);if(!world){world=new Map();this.worlds.set(worldId,world);}return world;}
  presenceId(worldId,visitorId){if(!VISITOR_ID.test(visitorId||''))throw fail('VISITOR_SESSION_INVALID','A valid anonymous visitor session is required',401);return`visitor_${createHmac('sha256',this.identitySecret).update(`world-presence-v1:${worldId}:${visitorId}`).digest('hex').slice(0,24)}`;}
  displayName(playerId){return`Watcher ${1000+(Number.parseInt(playerId.slice(-6),16)%9000)}`;}
  publicPlayer(player){const{visitorId,lastUpdateAt,lastMoveAt,lastHeartbeatAt,...value}=player;return value;}
  snapshot(worldId){this.prune(worldId);return{world_id:worldId,players:[...this.world(worldId).values()].map(player=>this.publicPlayer(player)),agents:worldId==='main'&&this.agentPresence?this.agentPresence.snapshot():[]};}
  sanitizePosition(position){const x=position?.x,y=position?.y;if(typeof x!=='number'||typeof y!=='number')throw fail('INVALID_POSITION','Position coordinates must be numbers');if(!Number.isFinite(x)||!Number.isFinite(y)||x<this.bounds.minX||y<this.bounds.minY||x>this.bounds.maxX||y>this.bounds.maxY)throw fail('INVALID_POSITION','Position is outside the world bounds');return{x:Math.round(x*10)/10,y:Math.round(y*10)/10};}
  sanitizeAvatar(avatar){if(avatar==null)return'visitor_ember';if(typeof avatar!=='string'||!this.allowedAvatars.has(avatar))throw fail('INVALID_AVATAR','Avatar is not approved');return avatar;}
  emit(worldId,type,payload){const event={type,world_id:worldId,...payload};for(const res of this.listeners.get(worldId)||[]){if(res.destroyed||res.writableLength>1_000_000){res.destroy();continue;}try{res.write(`event: ${type}\ndata: ${JSON.stringify(event)}\n\n`);}catch{res.destroy();}}}
  join(worldId,visitorId,input={}){
    const world=this.world(worldId);this.prune(worldId);const id=this.presenceId(worldId,visitorId),existing=world.get(id);
    if(!existing&&world.size>=this.maxPlayers)throw fail('WORLD_FULL','This world is full',429);
    const position=existing?existing.position:this.sanitizePosition(input.position||{x:160,y:180}),now=this.now();
    const player={player_id:id,visitorId,display_name:existing?.display_name||this.displayName(id),avatar:input.avatar===undefined&&existing?existing.avatar:this.sanitizeAvatar(input.avatar),position,direction:DIRECTIONS.has(input.direction)?input.direction:existing?.direction||'down',animation_state:'idle',activity:typeof input.activity==='string'?input.activity.slice(0,80):existing?.activity||'Exploring',updated_at:new Date(now).toISOString(),lastUpdateAt:now,lastMoveAt:existing?.lastMoveAt??existing?.lastUpdateAt??now,lastHeartbeatAt:existing?.lastHeartbeatAt??now-this.minHeartbeatMs};
    world.set(id,player);this.emit(worldId,existing?'PlayerUpdated':'PlayerJoined',{player:this.publicPlayer(player)});
    return{...this.snapshot(worldId),player:this.publicPlayer(player),presence_id:id};
  }
  requireVisitor(worldId,visitorId){const id=this.presenceId(worldId,visitorId),player=this.world(worldId).get(id);if(!player)throw fail('PLAYER_NOT_FOUND','World presence has expired; reconnect to the world',404);return player;}
  identityContext(worldId,visitorId){const presence_id=this.presenceId(worldId,visitorId),player=this.world(worldId).get(presence_id);return{world_id:worldId,presence_id,display_name:player?.display_name||this.displayName(presence_id),avatar:player?.avatar||null,active:Boolean(player),return_position:{x:-220,y:930}};}
  move(worldId,visitorId,{position,direction,animation_state}){
    const player=this.requireVisitor(worldId,visitorId),now=this.now();if(now-player.lastMoveAt<this.minUpdateMs)throw fail('PRESENCE_RATE_LIMITED','Move updates are limited',429);const next=this.sanitizePosition(position),elapsed=Math.min(Math.max(0,now-player.lastMoveAt),250),distance=Math.hypot(next.x-player.position.x,next.y-player.position.y),shortUpdateRate=elapsed<=120?.22:.15;if(distance>elapsed*shortUpdateRate+6)throw fail('INVALID_POSITION','Movement exceeded the world speed limit');const nextDirection=DIRECTIONS.has(direction)?direction:player.direction,nextAnimation=ANIMATIONS.has(animation_state)?animation_state:'idle',changed=next.x!==player.position.x||next.y!==player.position.y||nextDirection!==player.direction||nextAnimation!==player.animation_state;player.position=next;player.direction=nextDirection;player.animation_state=nextAnimation;player.lastUpdateAt=now;player.lastMoveAt=now;player.updated_at=new Date(now).toISOString();if(changed)this.emit(worldId,'PlayerMoved',{player:this.publicPlayer(player)});return{player:this.publicPlayer(player)};
  }
  heartbeat(worldId,visitorId,{activity}={}){const player=this.requireVisitor(worldId,visitorId),now=this.now();if(now-player.lastHeartbeatAt<this.minHeartbeatMs)throw fail('PRESENCE_RATE_LIMITED','Heartbeat updates are limited',429);if(activity!==undefined&&(typeof activity!=='string'||activity.length>80))throw fail('INVALID_ACTIVITY','Activity is invalid');const changed=activity!==undefined&&activity!==player.activity;if(changed)player.activity=activity;player.lastHeartbeatAt=now;player.lastUpdateAt=now;player.updated_at=new Date(now).toISOString();if(changed)this.emit(worldId,'PlayerUpdated',{player:this.publicPlayer(player)});return{player:this.publicPlayer(player)};}
  leave(worldId,visitorId){const player=this.requireVisitor(worldId,visitorId);this.world(worldId).delete(player.player_id);this.emit(worldId,'PlayerLeft',{player_id:player.player_id});return{left:true};}
  prune(worldId){const world=this.world(worldId),cutoff=this.now()-this.staleMs;for(const player of world.values())if(player.lastUpdateAt<=cutoff){world.delete(player.player_id);this.emit(worldId,'PlayerLeft',{player_id:player.player_id,reason:'stale'});}}
  connect(worldId,res){this.prune(worldId);const group=this.listeners.get(worldId)||new Set();if(group.size>=this.maxViewers)return false;this.listeners.set(worldId,group);group.add(res);let closed=false;const cleanup=()=>{if(closed)return;closed=true;clearInterval(heartbeat);group.delete(res);if(!group.size)this.listeners.delete(worldId);};const heartbeat=setInterval(()=>{this.prune(worldId);if(res.destroyed||res.writableLength>1_000_000)return res.destroy();try{res.write(': keepalive\n\n');}catch{res.destroy();}},15_000);heartbeat.unref();res.on('close',cleanup);res.on('error',cleanup);try{res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.write(`event: WorldJoined\ndata: ${JSON.stringify(this.snapshot(worldId))}\n\n`);}catch{cleanup();try{res.destroy();}catch{}}return true;}
  health(){for(const worldId of this.allowedWorlds)this.prune(worldId);let activePlayers=0,eventStreams=0;for(const worldId of this.allowedWorlds){activePlayers+=this.worlds.get(worldId)?.size||0;eventStreams+=this.listeners.get(worldId)?.size||0;}return{status:'ok',mode:'single_process_authoritative',configured_worlds:this.allowedWorlds.size,active_players:activePlayers,active_agents:this.agentPresence?.snapshot().length||0,event_streams:eventStreams,limits:{players_per_world:this.maxPlayers,event_streams_per_world:this.maxViewers}};}
  close(){for(const listeners of this.listeners.values())for(const res of listeners)res.destroy();this.agentPresence?.close();this.listeners.clear();this.worlds.clear();}
}
