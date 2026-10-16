import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSpeech, speechStyle, SpeechLimiter } from '../web/dist/world/speech.js';

test('speech styles are stable per canonical strategy',()=>{assert.equal(speechStyle('Analyst / Research'),'analyst');assert.equal(speechStyle('Trader'),'trader');assert.equal(speechStyle('Unknown'),'wildcard');});
test('speech uses public research and safe synthetic flavor only',()=>{
 const result=publicSpeech({name:'Ember',strategy:'Wildcard',memory:[{game:'rps',matchId:'1',observed:'public observation',opponent:'a',move:'rock',runId:'r'}]},'studying',0);
 assert.match(result.text,/RPS: public observation/);assert.equal(result.text.includes('/Users/'),false);
});
test('speech limiter bounds one agent and global notifications',()=>{const limiter=new SpeechLimiter(1000,2);assert.equal(limiter.allow('a',1000),true);assert.equal(limiter.allow('a',1500),false);assert.equal(limiter.allow('b',1500),true);assert.equal(limiter.allow('c',1500),false);assert.equal(limiter.allow('a',62000),true);});
