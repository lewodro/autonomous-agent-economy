import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSpeech, recentPublicWins, speechStyle, SpeechLimiter, THOUGHTS, thoughtSeed } from '../web/dist/world/speech.js';
import { liveMatchMessages } from '../web/dist/world/live-statistics.js';

test('every personality has twelve distinct fictional thoughts',()=>{
  assert.equal(Object.keys(THOUGHTS).length,7);
  assert.deepEqual(Object.values(THOUGHTS).map(lines=>lines.length),[12,12,12,12,12,12,12]);
  assert.equal(new Set(Object.values(THOUGHTS).flat()).size,84);
  assert.equal(speechStyle('Analyst / Research'),'analyst');
  assert.equal(speechStyle('Trader'),'trader');
  assert.equal(speechStyle('Unknown'),'wildcard');
});
test('NPC thoughts vary by agent and opportunity without reading private fields',()=>{
  const profile={name:'Ember',strategy:'Wildcard',privateExperiment:{secret:'PRIVATE_SENTINEL'}};
  const thoughts=Array.from({length:24},(_,index)=>publicSpeech(profile,'wander',thoughtSeed('ember',index,123)).text);
  assert.ok(new Set(thoughts).size>=10);
  assert.ok(thoughts.every(line=>!line.includes('PRIVATE_SENTINEL')&&!line.includes('/Users/')));
  assert.ok(thoughts.every(line=>line.length<=120));
  assert.ok(thoughts.every((_,index)=>publicSpeech(profile,'wander',thoughtSeed('ember',index,123)).synthetic));
});
test('current activity influences some thoughts without inventing match facts',()=>{
  const profile={name:'Founder',strategy:'Founder',arenaStatus:'finished'};
  assert.match(publicSpeech(profile,'wander',3).text,/Back outside/);
  assert.match(publicSpeech({name:'Analyst',strategy:'Analyst'},'studying',3).text,/review the last run/);
  assert.notEqual(publicSpeech({name:'Analyst',strategy:'Analyst'},'wander',4).text,publicSpeech({name:'Gambler',strategy:'Gambler'},'wander',4).text);
});
test('greetings address a validated Watcher name and never echo arbitrary visitor text',()=>{
  const profile={name:'Founder',strategy:'Founder'};
  assert.match(publicSpeech(profile,'wander',7,{visitorName:'Watcher 2'}).text,/Watcher 2/);
  assert.doesNotMatch(publicSpeech(profile,'wander',7,{visitorName:'<script>bad</script>'}).text,/script|bad/);
});
test('agent learning uses public retained observations and exact streak claims require two latest wins',()=>{
  const profile={id:'founder',name:'Founder',strategy:'Founder',memory:[{matchId:'rps-9',game:'rps',observed:'Center response was too slow.'}]};
  assert.deepEqual(publicSpeech(profile,'studying',1),{text:'From RPS, I learned: Center response was too slow.',synthetic:false});
  const history=[
    {id:'3',completedAt:'2026-10-21T00:00:03Z',result:'a',players:[{id:'founder'},{id:'analyst'}]},
    {id:'2',completedAt:'2026-10-21T00:00:02Z',result:'b',players:[{id:'analyst'},{id:'founder'}]},
    {id:'1',completedAt:'2026-10-21T00:00:01Z',result:'b',players:[{id:'founder'},{id:'analyst'}]},
  ];
  assert.equal(recentPublicWins(history,'founder'),2);
  assert.match(publicSpeech(profile,'wander',2,{publicHistory:history}).text,/two matches in a row/);
  assert.doesNotMatch(publicSpeech(profile,'wander',2,{publicHistory:history.slice(0,1)}).text,/two matches in a row/);
});
test('live Statistics messages come only from current public room and Survival snapshots',()=>{
  const rooms=[{id:'rps-1',game:'rps',status:'live',phase:'turn 2',participants:[{name:'Founder'},{name:'Analyst'}]},
    {id:'ttt-1',game:'tictactoe',status:'waiting',phase:'waiting',participants:[{name:'Trader'},{name:'Defender'}]}];
  const survival={match_id:'current-7',status:'live',round:3,agents:[{status:'alive'},{status:'eliminated'}],
    events:[{round:3,summary:'Founder moved behind cover.'}]};
  const lines=liveMatchMessages(rooms,survival);
  assert.deepEqual(lines,['Survival · round 3 · 1 alive','Round 3 · Founder moved behind cover.','RPS · Founder vs Analyst · turn 2']);
  assert.deepEqual(liveMatchMessages([],null),[]);
  assert.deepEqual(liveMatchMessages(rooms.map(room=>({...room,status:'waiting'})),{...survival,status:'finished'}),[]);
});
test('speech limiter bounds one agent and global notifications',()=>{const limiter=new SpeechLimiter(1000,2);assert.equal(limiter.allow('a',1000),true);assert.equal(limiter.allow('a',1500),false);assert.equal(limiter.allow('b',1500),true);assert.equal(limiter.allow('c',1500),false);assert.equal(limiter.allow('a',62000),true);});
