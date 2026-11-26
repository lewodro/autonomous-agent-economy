import {randomUUID} from 'node:crypto';
import {playCell} from '../src/tictactoe.js';
import {MOVES,resolve} from '../src/rps.js';
import {CHALLENGE_COOLDOWN_MS,CHALLENGE_TTL_MS,QUICK_CHAT_PHRASES} from './quick-chat.js';
import {publicSwordDuelConfig,SWORD_DUEL,SWORD_DUEL_ARENA} from '../src/sword-duel.js';

const CHALLENGE_ID=/^chal-[a-f0-9-]{36}$/;
const DUEL_ID=/^duel-[a-f0-9-]{36}$/;
const GAMES=new Set(['tictactoe','rps','swordduel']);
function fail(code,message,status=400){return Object.assign(new Error(message),{code,status});}

/**
 * Ephemeral proximity challenges. A challenge is a short-lived invite created
 * only after an authenticated quick-chat request; accepting it creates exactly
 * one shared duel. The service owns seating and turn order, while every rule
 * decision is delegated to the existing Tic-Tac-Toe and RPS modules.
 *
 * Nothing here is persisted: challenges expire, duels expire, and a finished
 * duel is only retained long enough for both browsers to read the result.
 */
export class WorldChallengeService {
  constructor({presence,now=()=>Date.now(),challengeTtlMs=CHALLENGE_TTL_MS,challengeCooldownMs=CHALLENGE_COOLDOWN_MS,duelTtlMs=15*60_000,finishedTtlMs=5*60_000,acceptedTtlMs=2*60_000}={}){
    if(!presence)throw new Error('World challenges require a presence service');
    for(const [name,value] of [['challengeTtlMs',challengeTtlMs],['challengeCooldownMs',challengeCooldownMs],['duelTtlMs',duelTtlMs],['finishedTtlMs',finishedTtlMs],['acceptedTtlMs',acceptedTtlMs]]){
      if(!Number.isFinite(value)||value<1)throw new Error(`Quick chat challenges require a positive ${name}`);
    }
    this.presence=presence;this.now=now;this.challengeTtlMs=challengeTtlMs;this.challengeCooldownMs=challengeCooldownMs;this.duelTtlMs=duelTtlMs;this.finishedTtlMs=finishedTtlMs;this.acceptedTtlMs=acceptedTtlMs;
    this.challenges=new Map();this.accepted=new Map();this.duels=new Map();
    this.challengeByPlayer=new Map();this.duelByPlayer=new Map();this.lastChallengeAt=new Map();
  }
  /** Drops expired invites, playing duels and stale duplicate-accept records. */
  prune(){
    const now=this.now();
    for(const challenge of [...this.challenges.values()])if(now>=challenge.expiresAt)this.expireChallenge(challenge);
    for(const [id,duel] of [...this.duels.entries()]){
      if(duel.status==='playing'&&now>=duel.expiresAt){duel.status='expired';duel.finishedAt=now;this.freeDuel(duel);}
      else if(duel.status!=='playing'&&duel.finishedAt&&now-duel.finishedAt>=this.finishedTtlMs)this.duels.delete(id);
    }
    for(const [id,entry] of [...this.accepted.entries()])if(now-entry.at>=this.acceptedTtlMs)this.accepted.delete(id);
  }
  publicChallenge(challenge){
    return {challenge_id:challenge.id,game:challenge.game,from_player_id:challenge.from.playerId,from_name:challenge.from.name,to_player_id:challenge.to.playerId,expires_at:new Date(challenge.expiresAt).toISOString()};
  }
  /** Creates at most one pending invite for the nearest human; null for bubble-only phrases. */
  create(worldId,visitorId,phraseId,targetPlayerId){
    const phrase=QUICK_CHAT_PHRASES[phraseId];
    if(!phrase?.challenge)return null;
    if(!GAMES.has(phrase.challenge))return null;
    this.prune();
    const player=this.presence.requireVisitor(worldId,visitorId);
    const target=targetPlayerId?this.presence.player(worldId,targetPlayerId):this.presence.nearestHuman(worldId,player.player_id)?.player;
    if(!target||target.player_id===player.player_id||Math.hypot(target.position.x-player.position.x,target.position.y-player.position.y)>this.presence.quickChatRadius){
      throw fail('NO_NEARBY_HUMAN','Move closer to another visitor to start a challenge',409);
    }
    const now=this.now(),last=this.lastChallengeAt.get(player.player_id);
    if(last!==undefined&&now-last<this.challengeCooldownMs)throw fail('CHALLENGE_RATE_LIMITED','Challenge invites are limited',429);
    for(const participant of [player,target]){
      if(this.challengeByPlayer.has(participant.player_id))throw fail('CHALLENGE_BUSY','One of you already has a pending challenge',409);
      if(this.duelByPlayer.has(participant.player_id))throw fail('CHALLENGE_BUSY','One of you is already in a match',409);
    }
    const challenge={id:`chal-${randomUUID()}`,worldId,game:phrase.challenge,from:{visitorId,playerId:player.player_id,name:player.display_name},to:{visitorId:target.visitorId,playerId:target.player_id,name:target.display_name},createdAt:now,expiresAt:now+this.challengeTtlMs};
    this.challenges.set(challenge.id,challenge);
    this.challengeByPlayer.set(challenge.from.playerId,challenge.id);
    this.challengeByPlayer.set(challenge.to.playerId,challenge.id);
    this.lastChallengeAt.set(challenge.from.playerId,now);
    const publicChallenge=this.publicChallenge(challenge);
    this.presence.broadcast(worldId,'PlayerChallenged',{challenge:publicChallenge});
    return publicChallenge;
  }
  removeChallenge(challenge){
    this.challenges.delete(challenge.id);
    for(const playerId of [challenge.from.playerId,challenge.to.playerId])if(this.challengeByPlayer.get(playerId)===challenge.id)this.challengeByPlayer.delete(playerId);
  }
  expireChallenge(challenge){
    this.removeChallenge(challenge);
    this.presence.broadcast(challenge.worldId,'ChallengeExpired',{challenge_id:challenge.id});
  }
  /** Only the addressed visitor may accept; retries return the same duel. */
  accept(worldId,visitorId,challengeId){
    if(!CHALLENGE_ID.test(challengeId||''))throw fail('CHALLENGE_NOT_FOUND','That challenge is no longer available',404);
    this.prune();
    const replay=this.accepted.get(challengeId);
    if(replay){
      if(replay.visitorId!==visitorId)throw fail('CHALLENGE_NOT_YOURS','This challenge belongs to another visitor',403);
      const existing=this.duels.get(replay.duelId);
      if(!existing)throw fail('CHALLENGE_EXPIRED','That challenge has expired',410);
      return {duel_id:existing.id,game:existing.game,challenge_id:challengeId};
    }
    const challenge=this.challenges.get(challengeId);
    if(!challenge||challenge.worldId!==worldId)throw fail('CHALLENGE_NOT_FOUND','That challenge is no longer available',404);
    if(challenge.to.visitorId!==visitorId)throw fail('CHALLENGE_NOT_YOURS','This challenge belongs to another visitor',403);
    const now=this.now();
    if(now>=challenge.expiresAt){this.expireChallenge(challenge);throw fail('CHALLENGE_EXPIRED','That challenge has expired',410);}
    let from,to;
    try{from=this.presence.requireVisitor(worldId,challenge.from.visitorId);}catch{this.removeChallenge(challenge);throw fail('CHALLENGER_LEFT','The challenger left the world',409);}
    try{to=this.presence.requireVisitor(worldId,challenge.to.visitorId);}catch{this.removeChallenge(challenge);throw fail('TARGET_UNAVAILABLE','The challenged visitor left the world',409);}
    if(from.player_id!==challenge.from.playerId||to.player_id!==challenge.to.playerId){this.removeChallenge(challenge);throw fail('CHALLENGE_EXPIRED','That challenge is no longer available',410);}
    if(Math.hypot(from.position.x-to.position.x,from.position.y-to.position.y)>this.presence.quickChatRadius){this.removeChallenge(challenge);throw fail('NOT_NEARBY','Move closer together to start the match',409);}
    for(const participant of [from,to]){
      if(this.duelByPlayer.has(participant.player_id)){this.removeChallenge(challenge);throw fail('CHALLENGE_BUSY','One of you is already in a match',409);}
    }
    const duel=this.createDuel(challenge,from,to);
    this.removeChallenge(challenge);
    this.accepted.set(challengeId,{visitorId,duelId:duel.id,at:now});
    this.presence.broadcast(worldId,'ChallengeAccepted',{challenge_id:challengeId,duel_id:duel.id,game:duel.game,from_player_id:challenge.from.playerId,to_player_id:challenge.to.playerId});
    return {duel_id:duel.id,game:duel.game,challenge_id:challengeId};
  }
  decline(worldId,visitorId,challengeId){
    if(!CHALLENGE_ID.test(challengeId||''))throw fail('CHALLENGE_NOT_FOUND','That challenge is no longer available',404);
    this.prune();
    const challenge=this.challenges.get(challengeId);
    if(!challenge||challenge.worldId!==worldId)throw fail('CHALLENGE_NOT_FOUND','That challenge is no longer available',404);
    if(challenge.to.visitorId!==visitorId)throw fail('CHALLENGE_NOT_YOURS','This challenge belongs to another visitor',403);
    this.removeChallenge(challenge);
    this.presence.broadcast(worldId,'ChallengeDeclined',{challenge_id:challenge.id,by_player_id:challenge.to.playerId});
    return {declined:true};
  }
  cancel(worldId,visitorId,challengeId){
    if(!CHALLENGE_ID.test(challengeId||''))throw fail('CHALLENGE_NOT_FOUND','That challenge is no longer available',404);
    this.prune();
    const challenge=this.challenges.get(challengeId);
    if(!challenge||challenge.worldId!==worldId)throw fail('CHALLENGE_NOT_FOUND','That challenge is no longer available',404);
    if(challenge.from.visitorId!==visitorId)throw fail('CHALLENGE_NOT_YOURS','Only the challenger can cancel this invite',403);
    this.removeChallenge(challenge);
    this.presence.broadcast(worldId,'ChallengeCancelled',{challenge_id:challenge.id,by_player_id:challenge.from.playerId});
    return {cancelled:true};
  }
  /** A visitor leaving the world clears invites, but never the duel they may be walking into. */
  playerLeft(worldId,visitorId){
    const leavingId=this.presence.presenceId(worldId,visitorId);
    for(const challenge of [...this.challenges.values()]){
      if(challenge.worldId!==worldId)continue;
      if(challenge.from.visitorId===visitorId||challenge.to.visitorId===visitorId){
        this.removeChallenge(challenge);
        this.presence.broadcast(worldId,'ChallengeCancelled',{challenge_id:challenge.id,by_player_id:leavingId});
      }
    }
  }
  createDuel(challenge,from,to){
    const now=this.now();
    const fighter=(presence,x,facing)=>({x,y:SWORD_DUEL_ARENA.height/2,facing,hp:SWORD_DUEL.maxHp,maxHp:SWORD_DUEL.maxHp,
      lastAttack:0,lastDodge:0,dodgeUntil:0,stunUntil:0,hitUntil:0,exterior:{...presence.position}});
    const arena=challenge.game==='swordduel'?{
      fighters:{[from.player_id]:fighter(from,220,'right'),[to.player_id]:fighter(to,740,'left')},
      events:[],attacks:new Map(),dodges:new Map(),lastTick:now,
    }:null;
    const duel={id:`duel-${randomUUID()}`,worldId:challenge.worldId,game:challenge.game,status:'playing',revision:0,
      createdAt:now,expiresAt:now+(arena?Math.min(this.duelTtlMs,SWORD_DUEL.matchTtlMs):this.duelTtlMs),
      finishedAt:null,result:null,winner:null,arena,
      players:[{visitorId:from.visitorId,playerId:from.player_id,name:from.display_name,avatar:from.avatar||'visitor_starter'},{visitorId:to.visitorId,playerId:to.player_id,name:to.display_name,avatar:to.avatar||'visitor_starter'}],
      ...(challenge.game==='tictactoe'?{board:Array(9).fill(null),moves:[]}:challenge.game==='rps'?{picks:{}}:{})};
    this.duels.set(duel.id,duel);
    for(const player of duel.players)this.duelByPlayer.set(player.playerId,duel.id);
    return duel;
  }
  freeDuel(duel){
    for(const player of duel.players)if(this.duelByPlayer.get(player.playerId)===duel.id)this.duelByPlayer.delete(player.playerId);
  }
  finishDuel(duel,result){
    duel.status='finished';duel.result=result;duel.winner=result==='draw'?null:duel.players[result==='a'?0:1].playerId;duel.finishedAt=this.now();duel.revision+=1;
    this.freeDuel(duel);
  }
  view(worldId,visitorId,duelId){
    this.prune();
    const duel=this.duels.get(duelId);
    if(!duel||duel.worldId!==worldId)throw fail('DUEL_NOT_FOUND','That match is no longer available',404);
    if(!duel.players.some(player=>player.visitorId===visitorId))throw fail('DUEL_NOT_YOURS','This match belongs to another pair',403);
    return this.publicDuel(duel,visitorId);
  }
  /**
   * Public Arena board. Summaries carry display names and avatars only; visitor
   * sessions never leave the server. RPS rows expose lock state, never picks.
   */
  publicList(worldId){
    this.prune();
    const summarize=duel=>{
      const view={duel_id:duel.id,game:duel.game,status:duel.status,revision:duel.revision,
        created_at:new Date(duel.createdAt).toISOString(),expires_at:new Date(duel.expiresAt).toISOString(),
        finished_at:duel.finishedAt?new Date(duel.finishedAt).toISOString():null,
        players:duel.players.map((player,index)=>({player_id:player.playerId,name:player.name,marker:index===0?'a':'b',avatar:player.avatar||'visitor_starter'})),
        result:duel.result,winner_player_id:duel.winner};
      if(duel.game==='tictactoe'){
        view.board=duel.board;
        view.turn_player_id=duel.status==='playing'?duel.players[duel.moves.length%2].playerId:null;
      }else if(duel.game==='swordduel'){
        view.health=duel.players.map(player=>duel.arena.fighters[player.playerId].hp);
        view.standardized=true;
      }else{
        view.locked=duel.players.map(player=>Boolean(duel.picks[player.visitorId]));
      }
      return view;
    };
    const matches=[...this.duels.values()].filter(duel=>duel.worldId===worldId)
      .sort((a,b)=>Number(b.status==='playing')-Number(a.status==='playing')||b.createdAt-a.createdAt);
    return {
      live:matches.filter(duel=>duel.status==='playing').slice(0,8).map(summarize),
      recent:matches.filter(duel=>duel.status!=='playing').slice(0,8).map(summarize),
    };
  }
  /**
   * Read-only observation of one public duel. No cookie, no seat, no command.
   * RPS selections stay hidden until both players locked and the duel settled.
   */
  spectate(worldId,duelId){
    this.prune();
    const duel=this.duels.get(duelId);
    if(!duel||duel.worldId!==worldId)throw fail('DUEL_NOT_FOUND','That match is no longer available',404);
    const view={duel_id:duel.id,game:duel.game,status:duel.status,revision:duel.revision,spectating:true,
      created_at:new Date(duel.createdAt).toISOString(),expires_at:new Date(duel.expiresAt).toISOString(),
      finished_at:duel.finishedAt?new Date(duel.finishedAt).toISOString():null,
      players:duel.players.map((player,index)=>({player_id:player.playerId,name:player.name,marker:index===0?'a':'b',avatar:player.avatar||'visitor_starter'})),
      result:duel.result,winner_player_id:duel.winner};
    if(duel.game==='tictactoe'){
      view.board=duel.board;
      view.moves=duel.moves.map(move=>({player_id:move.playerId,cell:move.cell}));
      view.turn_player_id=duel.status==='playing'?duel.players[duel.moves.length%2].playerId:null;
    }else if(duel.game==='swordduel'){
      Object.assign(view,this.swordDuelView(duel));
    }else{
      view.locked=duel.players.map(player=>Boolean(duel.picks[player.visitorId]));
      // The reveal is part of the settled public record, never the live one.
      if(duel.status==='playing')view.players.forEach((player,index)=>{player.picked=Boolean(duel.picks[duel.players[index].visitorId]);});
      else view.picks=duel.players.map(player=>({player_id:player.playerId,move:duel.picks[player.visitorId]??null}));
    }
    return view;
  }
  command(worldId,visitorId,duelId,action,data={}){
    this.prune();
    const duel=this.duels.get(duelId);
    if(!duel||duel.worldId!==worldId)throw fail('DUEL_NOT_FOUND','That match is no longer available',404);
    const player=duel.players.find(value=>value.visitorId===visitorId);
    if(!player)throw fail('DUEL_NOT_YOURS','This match belongs to another pair',403);
    if(duel.status!=='playing')throw fail('DUEL_FINISHED','This match has already finished',409);
    if(duel.game==='swordduel'){
      if(action==='move')this.swordMove(duel,player,data);
      else if(action==='attack')this.swordAttack(duel,player,data);
      else if(action==='dodge')this.swordDodge(duel,player,data);
      else throw fail('DUEL_ACTION_INVALID','Unsupported sword duel action',404);
    }else if(action==='move')this.move(duel,player,data);
    else if(action==='pick')this.pick(duel,player,data);
    else throw fail('DUEL_ACTION_INVALID','Unsupported match action',404);
    return this.publicDuel(duel,visitorId);
  }
  /** Timers advance from the server clock, never from a client frame count. */
  swordAdvance(duel){
    const now=this.now(),dt=Math.min(0.5,Math.max(0,(now-duel.arena.lastTick)/1000));
    duel.arena.lastTick=now;
    return {now,dt};
  }
  swordEvent(duel,event){
    duel.arena.events.push({...event,id:`hit_${duel.arena.events.length}_${event.at}`});
    if(duel.arena.events.length>16)duel.arena.events.shift();
  }
  swordMove(duel,player,data){
    if(duel.game!=='swordduel')throw fail('WRONG_GAME','This match is not a Sword Duel',409);
    const {now,dt}=this.swordAdvance(duel),fighter=duel.arena.fighters[player.playerId];
    const x=Number(data?.x),y=Number(data?.y);
    if(!Number.isFinite(x)||!Number.isFinite(y))throw fail('INVALID_MOVE','A duel move needs finite coordinates',400);
    const step=Math.hypot(x-fighter.x,y-fighter.y);
    const allowed=SWORD_DUEL.speed*dt*(fighter.stunUntil>now?0.35:1)+26;
    if(step>allowed)throw fail('DUEL_MOVE_TOO_FAR','That movement is not possible',409);
    fighter.x=Math.min(SWORD_DUEL_ARENA.maxX,Math.max(SWORD_DUEL_ARENA.minX,x));
    fighter.y=Math.min(SWORD_DUEL_ARENA.maxY,Math.max(SWORD_DUEL_ARENA.minY,y));
    if(['up','down','left','right'].includes(data?.facing))fighter.facing=data.facing;
    duel.revision+=1;
  }
  swordAttack(duel,player,data){
    if(duel.game!=='swordduel')throw fail('WRONG_GAME','This match is not a Sword Duel',409);
    if(typeof data?.request_id!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(data.request_id))throw fail('INVALID_REQUEST_ID','Sword attacks need a valid request ID',400);
    const key=`${player.playerId}:${data.request_id}`;
    if(duel.arena.attacks.has(key))return;
    const {now}=this.swordAdvance(duel),fighter=duel.arena.fighters[player.playerId];
    const other=duel.players.find(value=>value.playerId!==player.playerId),target=duel.arena.fighters[other.playerId];
    if(fighter.stunUntil>now)return;
    if(now-fighter.lastAttack<SWORD_DUEL.attackCooldownMs)throw fail('DUEL_COOLDOWN','Your sword is still recovering',409);
    duel.arena.attacks.set(key,now);
    if(duel.arena.attacks.size>64)duel.arena.attacks.delete(duel.arena.attacks.keys().next().value);
    fighter.lastAttack=now;
    const dx=target.x-fighter.x,dy=target.y-fighter.y,distance=Math.hypot(dx,dy)||1;
    const facing={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[fighter.facing]||[0,1];
    const dot=(dx*facing[0]+dy*facing[1])/distance;
    let event;
    if(target.dodgeUntil>now)event={type:'dodge',by:player.playerId,target:other.playerId,at:now};
    else if(distance>SWORD_DUEL.range)event={type:'miss',by:player.playerId,target:other.playerId,reason:'range',at:now};
    else if(dot<0.15)event={type:'miss',by:player.playerId,target:other.playerId,reason:'facing',at:now};
    else{
      target.hp=Math.max(0,target.hp-SWORD_DUEL.damage);
      target.hitUntil=now+SWORD_DUEL.hitFeedbackMs;
      target.stunUntil=now+SWORD_DUEL.stunMs;
      target.x=Math.min(SWORD_DUEL_ARENA.maxX,Math.max(SWORD_DUEL_ARENA.minX,target.x+(dx/distance)*SWORD_DUEL.knockback));
      target.y=Math.min(SWORD_DUEL_ARENA.maxY,Math.max(SWORD_DUEL_ARENA.minY,target.y+(dy/distance)*SWORD_DUEL.knockback));
      event={type:'hit',by:player.playerId,target:other.playerId,damage:SWORD_DUEL.damage,hp:target.hp,at:now};
      if(target.hp===0){this.swordEvent(duel,event);this.finishDuel(duel,duel.players[0].playerId===player.playerId?'a':'b');return;}
    }
    this.swordEvent(duel,event);
    duel.revision+=1;
  }
  swordDodge(duel,player,data){
    if(duel.game!=='swordduel')throw fail('WRONG_GAME','This match is not a Sword Duel',409);
    if(typeof data?.request_id!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(data.request_id))throw fail('INVALID_REQUEST_ID','Dodges need a valid request ID',400);
    const key=`${player.playerId}:${data.request_id}`;
    if(duel.arena.dodges.has(key))return;
    const {now}=this.swordAdvance(duel),fighter=duel.arena.fighters[player.playerId];
    if(now-fighter.lastDodge<SWORD_DUEL.dodgeCooldownMs)throw fail('DUEL_DODGE_COOLDOWN','Dodge is still recovering',409);
    if(fighter.stunUntil>now)return;
    duel.arena.dodges.set(key,now);
    if(duel.arena.dodges.size>64)duel.arena.dodges.delete(duel.arena.dodges.keys().next().value);
    fighter.lastDodge=now;fighter.dodgeUntil=now+SWORD_DUEL.dodgeDurationMs;
    this.swordEvent(duel,{type:'dodge_start',by:player.playerId,at:now});
    duel.revision+=1;
  }
  swordDuelView(duel){
    const now=this.now();
    const fighterView=player=>{
      const fighter=duel.arena.fighters[player.playerId];
      return {player_id:player.playerId,x:Math.round(fighter.x),y:Math.round(fighter.y),facing:fighter.facing,
        hp:fighter.hp,max_hp:fighter.maxHp,dodging:fighter.dodgeUntil>now,stunned:fighter.stunUntil>now,hit:fighter.hitUntil>now,
        cooldown_ms:Math.max(0,fighter.lastAttack+SWORD_DUEL.attackCooldownMs-now),
        dodge_cooldown_ms:Math.max(0,fighter.lastDodge+SWORD_DUEL.dodgeCooldownMs-now),
        exterior:{...fighter.exterior}};
    };
    return {combat:publicSwordDuelConfig(),fighters:duel.players.map(fighterView),events:duel.arena.events.slice(-8).map(event=>({...event}))};
  }
  move(duel,player,data){
    if(duel.game!=='tictactoe')throw fail('WRONG_GAME','This match is not Tic-Tac-Toe',409);
    if(!Number.isInteger(data?.revision)||data.revision!==duel.revision)throw fail('DUEL_REVISION','The board changed. Look again and retry.',409);
    const marker=duel.players[0].playerId===player.playerId?'a':'b';
    const cell=data?.cell;
    if(!Number.isInteger(cell)||cell<0||cell>8)throw fail('INVALID_MOVE','Choose an empty board cell',400);
    let result;
    try{({board:duel.board,result}=playCell(duel.board,marker,cell));}
    catch(error){throw fail('INVALID_MOVE',error instanceof Error?error.message:'That move is not legal',400);}
    duel.moves.push({playerId:player.playerId,cell});
    duel.revision+=1;
    if(result!==null)this.finishDuel(duel,result);
  }
  pick(duel,player,data){
    if(duel.game!=='rps')throw fail('WRONG_GAME','This match is not Rock Paper Scissors',409);
    if(duel.picks[player.visitorId])throw fail('PICK_LOCKED','You already chose a move',409);
    if(!MOVES.includes(data?.move))throw fail('INVALID_MOVE','Choose rock, paper or scissors',400);
    duel.picks[player.visitorId]=data.move;
    duel.revision+=1;
    const [first,second]=duel.players.map(value=>duel.picks[value.visitorId]);
    if(first&&second)this.finishDuel(duel,resolve(first,second));
  }
  publicDuel(duel,visitorId){
    const index=duel.players[0].visitorId===visitorId?0:1,other=1-index;
    const you=duel.players[index],opponent=duel.players[other];
    const marker=position=>position===0?'a':'b';
    const view={duel_id:duel.id,game:duel.game,status:duel.status,revision:duel.revision,created_at:new Date(duel.createdAt).toISOString(),expires_at:new Date(duel.expiresAt).toISOString(),
      you:{player_id:you.playerId,name:you.name,marker:marker(index),avatar:you.avatar||'visitor_starter'},opponent:{player_id:opponent.playerId,name:opponent.name,marker:marker(other),avatar:opponent.avatar||'visitor_starter'},
      result:duel.result,winner_player_id:duel.winner};
    if(duel.game==='tictactoe'){
      view.board=duel.board;
      view.moves=duel.moves.map(move=>({player_id:move.playerId,cell:move.cell}));
      view.turn_player_id=duel.status==='playing'?duel.players[duel.moves.length%2].playerId:null;
    }else if(duel.game==='swordduel'){
      Object.assign(view,this.swordDuelView(duel));
    }else{
      view.you.picked=Boolean(duel.picks[you.visitorId]);
      view.opponent.picked=Boolean(duel.picks[opponent.visitorId]);
      if(duel.status!=='playing'){
        view.you.pick=duel.picks[you.visitorId]??null;
        view.opponent.pick=duel.picks[opponent.visitorId]??null;
      }
    }
    return view;
  }
}
