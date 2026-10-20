import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSpeech, speechStyle, SpeechLimiter } from '../web/dist/world/speech.js';

test('speech styles are stable per canonical strategy',()=>{assert.equal(speechStyle('Analyst / Research'),'analyst');assert.equal(speechStyle('Trader'),'trader');assert.equal(speechStyle('Unknown'),'wildcard');});
test('speech uses public research and safe synthetic flavor only',()=>{
 const result=publicSpeech({name:'Ember',strategy:'Wildcard',memory:[{game:'rps',matchId:'1',observed:'public observation',opponent:'a',move:'rock',runId:'r'}]},'studying',0);
 assert.match(result.text,/RPS: public observation/);assert.equal(result.text.includes('/Users/'),false);
});
test('speech prefers retained Survival research and personality pools remain distinct',()=>{
 const researched=publicSpeech({name:'Founder',strategy:'Founder',memory:[],survival:{latest_research:'I keep getting cornered. need a different route.'}},'studying',1);
 assert.equal(researched.text,'I keep getting cornered. need a different route.');assert.equal(researched.synthetic,false);
 const analyst=publicSpeech({name:'Analyst',strategy:'Analyst',memory:[]},'wander',2);
 const gambler=publicSpeech({name:'Gambler',strategy:'Gambler',memory:[]},'wander',2);
 const wildcard=publicSpeech({name:'Wildcard',strategy:'Wildcard',memory:[]},'wander',2);
 assert.notEqual(analyst.text,gambler.text);assert.match(wildcard.text,/cornered_again|trace|memory|TARGET_CONFIDENCE/);assert.equal(wildcard.synthetic,true);
});
test('speech limiter bounds one agent and global notifications',()=>{const limiter=new SpeechLimiter(1000,2);assert.equal(limiter.allow('a',1000),true);assert.equal(limiter.allow('a',1500),false);assert.equal(limiter.allow('b',1500),true);assert.equal(limiter.allow('c',1500),false);assert.equal(limiter.allow('a',62000),true);});
