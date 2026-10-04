import test from 'node:test';
import assert from 'node:assert/strict';
import {expandConfig} from '../service/config.js';
const defaults={agents:[{strategy:'cooperative',provider:'mock',model:'mock/cooperative'}]};
test('profile errors identify their index and aliases never inherit object properties',()=>{
 for(const profile of [null,0,'bad',[]])assert.throws(()=>expandConfig({agents:[profile]},defaults),/agents\[0\] must be an object/);
 for(const strategy of ['toString','constructor','__proto__'])assert.equal(expandConfig({agents:[{strategy}]},defaults).agents[0].strategy,strategy);
 assert.equal(expandConfig({agents:[{strategy:'defensive'}]},defaults).agents[0].strategy,'conservative');
});
