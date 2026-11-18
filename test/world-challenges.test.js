import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldPresenceService} from '../service/world-presence.js';
import {WorldChallengeService} from '../service/world-challenges.js';

const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const carol='33333333-3333-4333-8333-333333333333';

function build({now=()=>1_000}={}) {
  const presence=new WorldPresenceService({identitySecret:'test-world-presence-secret-value-32',now:()=>now()});
  const events=[];
  const emit=presence.emit.bind(presence);
  presence.emit=(worldId,type,payload)=>{events.push({worldId,type,...payload});emit(worldId,type,payload);};
  const challenges=new WorldChallengeService({presence,now,challengeTtlMs:15_000,challengeCooldownMs:4_000,duelTtlMs:60_000,finishedTtlMs:30_000,acceptedTtlMs:10_000});
  return {presence,challenges,events};
}
function seat(presence,visitor,x=100){return presence.join('main',visitor,{position:{x,y:100}}).player;}
const challengeEvents=events=>events.filter(event=>event.type.startsWith('Challenge')||event.type==='PlayerChallenged');
function acceptedDuel(challenges,events,from,to,phrase='ttt'){
  const challenge=challenges.create('main',from,phrase);
  const accepted=challenges.accept('main',to,challenge.challenge_id);
  assert.ok(challengeEvents(events).some(event=>event.type==='ChallengeAccepted'));
  return accepted;
}

test('challenge creation targets the nearest other human and exposes no visitor IDs',()=>{
  const {presence,challenges,events}=build();
  const owner=seat(presence,alice,100);seat(presence,bob,150);seat(presence,carol,400);
  const challenge=challenges.create('main',alice,'ttt');
  assert.equal(challenge.game,'tictactoe');
  assert.equal(challenge.to_player_id,presence.presenceId('main',bob),'the nearest human receives the invite');
  assert.equal(challenge.from_player_id,owner.player_id);
  assert.equal(challenge.from_name,owner.display_name);
  assert.equal(Date.parse(challenge.expires_at),1_000+15_000);
  assert.equal('visitorId' in challenge,false);
  assert.equal('to_visitor_id' in challenge,false);
  const event=events.find(value=>value.type==='PlayerChallenged');
  assert.deepEqual(event.challenge,challenge);
  assert.equal(challenges.create('main',alice,'follow'),null,'ordinary phrases never create a challenge');
  assert.equal(challenges.create('main',alice,'nice'),null);
});

test('challenges require another human in range and one active invite per player',()=>{
  const {presence,challenges}=build();
  seat(presence,alice,100);
  assert.throws(()=>challenges.create('main',alice,'rps'),{code:'NO_NEARBY_HUMAN'});
  seat(presence,bob,100+presence.quickChatRadius+1);
  assert.throws(()=>challenges.create('main',alice,'rps'),{code:'NO_NEARBY_HUMAN'});
  presence.player('main',presence.presenceId('main',bob)).position={x:120,y:100};
  assert.equal(challenges.create('main',alice,'rps').game,'rps');
  assert.throws(()=>challenges.create('main',alice,'ttt'),{code:'CHALLENGE_RATE_LIMITED'},'repeat invites are rate limited');
  assert.throws(()=>challenges.create('main',bob,'ttt'),{code:'CHALLENGE_BUSY'},'the target cannot invite someone else while addressed');
});

test('accept creates exactly one duel and a duplicate accept replays it',()=>{
  const {presence,challenges,events}=build();
  seat(presence,alice,100);seat(presence,bob,150);seat(presence,carol,1000);
  const challenge=challenges.create('main',alice,'ttt');
  const accepted=challenges.accept('main',bob,challenge.challenge_id);
  assert.match(accepted.duel_id,/^duel-[a-f0-9-]{36}$/);
  assert.equal(challenges.challenges.size,0,'the invite is gone after acceptance');
  assert.deepEqual(challenges.accept('main',bob,challenge.challenge_id),accepted,'a duplicate accept returns the same duel');
  assert.throws(()=>challenges.accept('main',alice,challenge.challenge_id),{code:'CHALLENGE_NOT_YOURS'});
  assert.throws(()=>challenges.accept('main',carol,challenge.challenge_id),{code:'CHALLENGE_NOT_YOURS'});
  const view=challenges.view('main',alice,accepted.duel_id);
  assert.equal(view.game,'tictactoe');
  assert.equal(view.you.marker,'a');
  assert.equal(view.opponent.marker,'b');
  assert.throws(()=>challenges.view('main',carol,accepted.duel_id),{code:'DUEL_NOT_YOURS'});
  assert.equal(challengeEvents(events).filter(event=>event.type==='ChallengeAccepted').length,1);
});

test('tic-tac-toe moves are turn-ordered and settle through the existing rules',()=>{
  const {presence,challenges,events}=build();
  const owner=seat(presence,alice,100);seat(presence,bob,150);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob);
  const aliceId=owner.player_id,bobId=presence.presenceId('main',bob);
  assert.throws(()=>challenges.command('main',bob,duel_id,'move',{cell:0,revision:0}),{code:'INVALID_MOVE'},'the challenger moves first');
  let view=challenges.command('main',alice,duel_id,'move',{cell:0,revision:0});
  assert.equal(view.revision,1);
  assert.equal(view.turn_player_id,bobId);
  assert.throws(()=>challenges.command('main',alice,duel_id,'move',{cell:1,revision:1}),{code:'INVALID_MOVE'},'out-of-turn or occupied cells are rejected');
  view=challenges.command('main',bob,duel_id,'move',{cell:3,revision:1});
  view=challenges.command('main',alice,duel_id,'move',{cell:1,revision:view.revision});
  view=challenges.command('main',bob,duel_id,'move',{cell:4,revision:view.revision});
  view=challenges.command('main',alice,duel_id,'move',{cell:2,revision:view.revision});
  assert.equal(view.status,'finished');
  assert.equal(view.result,'a');
  assert.equal(view.winner_player_id,aliceId);
  assert.deepEqual(view.board,['a','a','a','b','b',null,null,null,null]);
  assert.throws(()=>challenges.command('main',bob,duel_id,'move',{cell:5,revision:view.revision}),{code:'DUEL_FINISHED'});
  assert.throws(()=>challenges.command('main',alice,duel_id,'pick',{move:'rock'}),{code:'DUEL_FINISHED'});
});

test('stale board revisions are rejected without changing the board',()=>{
  const {presence,challenges,events}=build();
  seat(presence,alice,100);seat(presence,bob,150);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob);
  assert.throws(()=>challenges.command('main',alice,duel_id,'move',{cell:0,revision:1}),{code:'DUEL_REVISION'});
  const first=challenges.command('main',alice,duel_id,'move',{cell:0,revision:0});
  assert.throws(()=>challenges.command('main',alice,duel_id,'move',{cell:0,revision:0}),{code:'DUEL_REVISION'});
  assert.deepEqual(challenges.view('main',alice,duel_id).board,first.board);
});

test('RPS hides picks until both players choose and resolves with the shared rule module',()=>{
  const {presence,challenges,events}=build();
  seat(presence,alice,100);seat(presence,bob,150);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob,'rps');
  let view=challenges.command('main',alice,duel_id,'pick',{move:'rock'});
  assert.equal(view.status,'playing');
  assert.equal(view.you.picked,true);
  assert.equal(view.opponent.picked,false);
  assert.equal('pick' in view.opponent,false,'the opponent move stays secret while playing');
  assert.throws(()=>challenges.command('main',alice,duel_id,'pick',{move:'paper'}),{code:'PICK_LOCKED'});
  assert.throws(()=>challenges.command('main',alice,duel_id,'move',{cell:0,revision:0}),{code:'WRONG_GAME'});
  view=challenges.command('main',bob,duel_id,'pick',{move:'scissors'});
  assert.equal(view.status,'finished');
  assert.equal(view.result,'a');
  assert.equal(view.you.pick,'scissors');
  assert.equal(view.opponent.pick,'rock');
  const aliceView=challenges.view('main',alice,duel_id);
  assert.equal(aliceView.you.pick,'rock');
  assert.equal(aliceView.opponent.pick,'scissors');
});

test('wrong visitor, expiry, distance and a departed challenger fail closed',()=>{
  const now=()=>clock;
  let clock=1_000;
  const {presence,challenges,events}=build({now});
  seat(presence,alice,100);seat(presence,bob,150);seat(presence,carol,900);
  const wrong=challenges.create('main',alice,'ttt');
  assert.throws(()=>challenges.accept('main',carol,wrong.challenge_id),{code:'CHALLENGE_NOT_YOURS'});
  challenges.decline('main',bob,wrong.challenge_id);
  assert.ok(challengeEvents(events).some(event=>event.type==='ChallengeDeclined'));
  clock+=4_500;

  const distant=challenges.create('main',alice,'ttt');
  presence.player('main',presence.presenceId('main',bob)).position={x:1_000,y:1_000};
  assert.throws(()=>challenges.accept('main',bob,distant.challenge_id),{code:'NOT_NEARBY'});
  presence.player('main',presence.presenceId('main',bob)).position={x:150,y:100};
  clock+=4_500;

  const expired=challenges.create('main',alice,'ttt');
  clock+=15_001;
  assert.throws(()=>challenges.accept('main',bob,expired.challenge_id),{code:'CHALLENGE_NOT_FOUND'});
  assert.ok(challengeEvents(events).some(event=>event.type==='ChallengeExpired'));

  clock+=4_500;
  const left=challenges.create('main',alice,'ttt');
  presence.leave('main',alice);
  assert.throws(()=>challenges.accept('main',bob,left.challenge_id),{code:'CHALLENGER_LEFT'});
});

test('challenge ownership, cancellation and cooldown are bounded',()=>{
  const now=()=>clock;
  let clock=1_000;
  const {presence,challenges,events}=build({now});
  seat(presence,alice,100);seat(presence,bob,150);
  const first=challenges.create('main',alice,'ttt');
  assert.throws(()=>challenges.decline('main',alice,first.challenge_id),{code:'CHALLENGE_NOT_YOURS'});
  assert.throws(()=>challenges.cancel('main',bob,first.challenge_id),{code:'CHALLENGE_NOT_YOURS'});
  const cancelled=challenges.cancel('main',alice,first.challenge_id);
  assert.deepEqual(cancelled,{cancelled:true});
  assert.ok(challengeEvents(events).some(event=>event.type==='ChallengeCancelled'));
  assert.throws(()=>challenges.create('main',alice,'ttt'),{code:'CHALLENGE_RATE_LIMITED'});
  clock+=4_001;
  const second=challenges.create('main',alice,'ttt');
  const declined=challenges.decline('main',bob,second.challenge_id);
  assert.deepEqual(declined,{declined:true});
  assert.throws(()=>challenges.decline('main',bob,second.challenge_id),{code:'CHALLENGE_NOT_FOUND'});
});

test('duels expire, finished duels are retained briefly, and non-participants are rejected',()=>{
  const now=()=>clock;
  let clock=1_000;
  const {presence,challenges,events}=build({now});
  seat(presence,alice,100);seat(presence,bob,150);seat(presence,carol,900);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob,'rps');
  assert.throws(()=>challenges.command('main',carol,duel_id,'pick',{move:'rock'}),{code:'DUEL_NOT_YOURS'});
  clock+=60_001;
  assert.equal(challenges.view('main',alice,duel_id).status,'expired');
  assert.throws(()=>challenges.command('main',alice,duel_id,'pick',{move:'rock'}),{code:'DUEL_FINISHED'});
  clock+=30_001;
  assert.throws(()=>challenges.view('main',alice,duel_id),{code:'DUEL_NOT_FOUND'});
});

test('a challenge rejected for abuse creates no duel and notifies the stream',()=>{
  const {presence,challenges,events}=build();
  seat(presence,alice,100);seat(presence,bob,150);
  const challenge=challenges.create('main',alice,'ttt');
  challenges.decline('main',bob,challenge.challenge_id);
  assert.equal(challenges.duels.size,0);
  assert.equal(challenges.challengeByPlayer.size,0);
  const types=challengeEvents(events).map(event=>event.type);
  assert.ok(types.includes('PlayerChallenged'));
  assert.ok(types.includes('ChallengeDeclined'));
  assert.equal(types.includes('ChallengeAccepted'),false);
});

test('the public board lists live duels without visitor sessions or hidden RPS picks',()=>{
  const {presence,challenges,events}=build();
  seat(presence,alice,100);seat(presence,bob,150);seat(presence,carol,900);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob,'rps');
  const board=challenges.publicList('main');
  assert.equal(board.live.length,1);
  assert.equal(board.recent.length,0);
  const [row]=board.live;
  assert.equal(row.duel_id,duel_id);
  assert.equal(row.game,'rps');
  assert.equal(row.status,'playing');
  assert.deepEqual(row.players.map(player=>player.name.length>0), [true,true]);
  assert.equal(row.players.some(player=>'visitorId' in player),false);
  assert.deepEqual(row.locked,[false,false]);
  assert.equal(JSON.stringify(row).includes('rock'),false,'the live board never carries selections');
  assert.equal(JSON.stringify(row).includes('11111111-1111-4111-8111-111111111111'),false,'visitor cookies never leak');
  challenges.command('main',alice,duel_id,'pick',{move:'rock'});
  const locked=challenges.publicList('main').live[0];
  assert.deepEqual(locked.locked,[true,false]);
  assert.equal(JSON.stringify(locked).includes('rock'),false,'a locked selection stays secret on the public board');
});

test('spectating is read-only and hides the RPS reveal until the duel settles',()=>{
  const {presence,challenges,events}=build();
  const owner=seat(presence,alice,100);seat(presence,bob,150);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob,'rps');
  const aliceId=owner.player_id,bobId=presence.presenceId('main',bob);
  challenges.command('main',alice,duel_id,'pick',{move:'rock'});
  const watching=challenges.spectate('main',duel_id);
  assert.equal(watching.spectating,true);
  assert.equal(watching.status,'playing');
  assert.deepEqual(watching.locked,[true,false]);
  assert.equal('picks' in watching,false,'live spectators never receive either choice');
  assert.equal(JSON.stringify(watching).includes('rock'),false);
  assert.equal(watching.players.some(player=>'visitorId' in player),false);
  challenges.command('main',bob,duel_id,'pick',{move:'scissors'});
  const settled=challenges.spectate('main',duel_id);
  assert.equal(settled.status,'finished');
  assert.deepEqual(settled.picks.map(pick=>pick.move).sort(),['rock','scissors'],'the settled reveal is public');
  assert.equal(settled.result,'a');
  assert.equal(settled.winner_player_id,aliceId);
});

test('spectating a TTT duel shows the same board to everyone and rejects unknown matches',()=>{
  const {presence,challenges,events}=build();
  const owner=seat(presence,alice,100);seat(presence,bob,150);
  const {duel_id}=acceptedDuel(challenges,events,alice,bob);
  challenges.command('main',alice,duel_id,'move',{cell:4,revision:0});
  const watching=challenges.spectate('main',duel_id);
  assert.deepEqual(watching.board,[null,null,null,null,'a',null,null,null,null]);
  assert.equal(watching.turn_player_id,presence.presenceId('main',bob));
  assert.equal(challenges.view('main',alice,duel_id).board.join(','),watching.board.join(','),'participants and spectators share one board');
  assert.throws(()=>challenges.spectate('main','duel-99999999-9999-4999-8999-999999999999'),{code:'DUEL_NOT_FOUND'});
  assert.deepEqual(challenges.publicList('other'),{live:[],recent:[]},'other worlds see no duels');
});
