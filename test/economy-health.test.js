import test from 'node:test';
import assert from 'node:assert/strict';
import {FundedRuntime} from '../service/funded-runtime.js';
test('economy health aggregates safe observed counters without claiming fresh probes',()=>{
 const runtime=new FundedRuntime(null,null,null,null);
 assert.equal(runtime.health().rpc_status,'not_observed');
 runtime.remember({session:'a',economy:{economy:{payment_mode:'local'},health:{rpc_ready:false,storage_ready:true,pending_intents:2,pending_receipts:1,pending_refunds:1}}});
 const health=runtime.health();assert.equal(health.mainnet_enabled,false);assert.equal(health.rpc_status,'unavailable');assert.equal(health.pending_intents,2);assert.equal(health.pending_refunds,1);
 assert.deepEqual(health.modes,['local']);assert.equal('operations' in health,false);
});
