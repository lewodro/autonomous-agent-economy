import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {OwnershipStore} from '../service/ownership-store.js';
import {encodeBase58} from '../service/wallet-auth.js';

const avatars=new Set(['visitor_ember','visitor_atlas']);
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-owner-store-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new OwnershipStore(dir,{now:()=>1_800_000_000_000});await store.init();return {store,dir};
}
const valid={name:'Builder',avatar:'visitor_ember',strategy:'conservative',personality:'Patient, measured play.',capabilities:['games']};
const requestKey=()=>randomUUID();

test('anonymous owner can create a free agent and state survives restart',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous();
 assert.equal(owner.identity_type,'anonymous');assert.equal(owner.wallet_public_key,null);
 const agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 assert.match(agent.id,/^u-/);assert.equal(agent.treasury.network,'none');
 const reopened=new OwnershipStore(dir);await reopened.init();
 assert.equal(reopened.agentSummaryForOwner(owner.id,agent.id).name,'Builder');
 assert.equal(reopened.agentSummaryForOwner('some-other-owner',agent.id),null);
});

test('agent creation retries reuse the durable result and reject key reuse with changed config',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),key=requestKey();
 const first=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:key});
 const retry=await store.createAgent(owner.id,{...valid,name:' Builder '},avatars,{idempotencyKey:key});
 assert.equal(retry.id,first.id);assert.equal(store.agentsForOwner(owner.id).length,1);
 await assert.rejects(store.createAgent(owner.id,{...valid,name:'Different'},avatars,{idempotencyKey:key}),{status:409,code:'IDEMPOTENCY_KEY_REUSED'});
 const reopened=new OwnershipStore(dir);await reopened.init();
 const afterRestart=await reopened.createAgent(owner.id,valid,avatars,{idempotencyKey:key});
 assert.equal(afterRestart.id,first.id);assert.equal(reopened.agentsForOwner(owner.id).length,1);
});

test('simultaneous retries for one agent creation serialize to one durable agent',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous(),key=requestKey();
 const results=await Promise.all(Array.from({length:8},()=>store.createAgent(owner.id,valid,avatars,{idempotencyKey:key})));
 assert.equal(new Set(results.map(agent=>agent.id)).size,1);
 assert.equal(store.agentsForOwner(owner.id).length,1);
});

test('legacy owner snapshots without operation records remain readable and upgrade on write',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous();
 const {writeFile}=await import('node:fs/promises'),snapshot=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 delete snapshot.operations;await writeFile(path.join(dir,'state.json'),JSON.stringify(snapshot));
 const reopened=new OwnershipStore(dir);await reopened.init();
 const agent=await reopened.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 const upgraded=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 assert.equal(upgraded.operations.length,1);assert.equal(upgraded.operations[0].agent_id,agent.id);
});

test('wallet owners validate canonical public keys and are reused idempotently',async t=>{
 const {store}=await fixture(t),pair=generateKeyPairSync('ed25519');
 const key=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const first=await store.createWalletOwner(key),second=await store.createWalletOwner(key);
 assert.equal(first.id,second.id);assert.equal(first.identity_type,'solana');
 await assert.rejects(store.createWalletOwner('not-a-wallet'),{code:'INVALID_WALLET_ADDRESS'});
});

test('linking a verified wallet upgrades a guest without orphaning agents and forbids implicit account merge',async t=>{
 const {store}=await fixture(t),guest=await store.createAnonymous(),agent=await store.createAgent(guest.id,valid,avatars,{idempotencyKey:requestKey()}),pair=generateKeyPairSync('ed25519');
 const key=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const linked=await store.linkWalletOwner(guest.id,key);
 assert.equal(linked.id,guest.id);assert.equal(linked.identity_type,'solana');assert.equal(store.agentSummaryForOwner(linked.id,agent.id).id,agent.id);
 const other=await store.createAnonymous();
 await assert.rejects(store.linkWalletOwner(other.id,key),{code:'WALLET_ALREADY_OWNED'});
 assert.equal(store.owner(other.id).identity_type,'anonymous');
});

test('agent import accepts only the public schema and export excludes ownership and treasury data',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous();
 const agent=await store.createAgent(owner.id,{format:'aae-agent-v1',...valid},avatars,{importing:true,idempotencyKey:requestKey()});
 const exported=store.exportAgent(owner.id,agent.id);
 assert.deepEqual(Object.keys(exported).sort(),['avatar','capabilities','format','model','name','personality','provider','strategy'].sort());
 assert.equal(JSON.stringify(exported).includes(owner.id),false);
 await assert.rejects(store.createAgent(owner.id,{...valid,owner_id:'forged'},avatars,{idempotencyKey:requestKey()}),{code:'UNSUPPORTED_AGENT_FIELD'});
 await assert.rejects(store.createAgent(owner.id,{...valid,api_key:'secret'},avatars,{importing:true,idempotencyKey:requestKey()}),{code:'UNSUPPORTED_AGENT_FIELD'});
 await assert.rejects(store.createAgent(owner.id,{...valid,avatar:'debug_placeholder'},avatars,{idempotencyKey:requestKey()}),{code:'INVALID_AGENT_AVATAR'});
 await assert.rejects(store.createAgent(owner.id,{...valid,provider:'custom-http'},avatars,{idempotencyKey:requestKey()}),{code:'UNSUPPORTED_AGENT_PROVIDER'});
});

test('mock funding persists an auditable simulated receipt and rejects duplicate configuration fields',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 const key=requestKey(),first=await store.mockFund(owner.id,agent.id,250,{idempotencyKey:key});
 const retry=await store.mockFund(owner.id,agent.id,250,{idempotencyKey:key});
 assert.equal(retry.receipt.id,first.receipt.id);assert.equal(retry.treasury.available_base_units,'250');
 await assert.rejects(store.mockFund(owner.id,agent.id,251,{idempotencyKey:key}),{status:409,code:'IDEMPOTENCY_KEY_REUSED'});
 assert.equal(first.treasury.available_base_units,'250');assert.equal(first.receipt.status,'simulated');
 const reopened=new OwnershipStore(dir);await reopened.init();
 const restored=reopened.agentSummaryForOwner(owner.id,agent.id);
 assert.equal(restored.treasury.available_base_units,'250');assert.equal(restored.treasury.receipts.length,1);
 const afterRestart=await reopened.mockFund(owner.id,agent.id,250,{idempotencyKey:key});assert.equal(afterRestart.receipt.id,first.receipt.id);
 await assert.rejects(store.mockFund('other-owner',agent.id,250,{idempotencyKey:requestKey()}),{code:'AGENT_NOT_FOUND'});
 const persisted=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 assert.equal(JSON.stringify(persisted).includes('private_key'),false);
});

test('simultaneous mock funding retries create one credit receipt',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()}),key=requestKey();
 const results=await Promise.all(Array.from({length:8},()=>store.mockFund(owner.id,agent.id,100,{idempotencyKey:key})));
 assert.equal(new Set(results.map(result=>result.receipt.id)).size,1);
 assert.equal(store.agentSummaryForOwner(owner.id,agent.id).treasury.available_base_units,'100');
});

test('agent creation and mock funding idempotency remain durable beyond 24 hours',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-owner-idempotency-age-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let now=1_800_000_000_000;const store=new OwnershipStore(dir,{now:()=>now});await store.init();
 const owner=await store.createAnonymous(),createKey=requestKey(),fundKey=requestKey();
 const agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:createKey});
 const first=await store.mockFund(owner.id,agent.id,42,{idempotencyKey:fundKey});
 now+=25*60*60_000;
 const reopened=new OwnershipStore(dir,{now:()=>now});await reopened.init();
 const retriedAgent=await reopened.createAgent(owner.id,valid,avatars,{idempotencyKey:createKey});
 const retriedFunding=await reopened.mockFund(owner.id,agent.id,42,{idempotencyKey:fundKey});
 assert.equal(retriedAgent.id,agent.id);
 assert.equal(retriedFunding.receipt.id,first.receipt.id);
 assert.equal(retriedFunding.treasury.available_base_units,'42');
 assert.equal(reopened.agentsForOwner(owner.id).length,1);
});

test('spending defaults to read-only and autonomous budgets remain unavailable',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 assert.equal(agent.treasury.spending_policy.mode,'read_only');
 const manual=await store.setSpendingPolicy(owner.id,agent.id,{mode:'manual'});assert.equal(manual.mode,'manual');
 await assert.rejects(store.setSpendingPolicy(owner.id,agent.id,{mode:'budgeted',max_per_day:'100'}),{code:'AGENT_SPENDING_NOT_IMPLEMENTED'});
 await assert.rejects(store.setSpendingPolicy(owner.id,agent.id,{mode:'read_only',allowed_capabilities:['compute']}),{code:'READ_ONLY_CAPABILITIES'});
});

test('corrupt or internally inconsistent ownership snapshots fail closed',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 const snapshot=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 snapshot.agents[0].treasury.available_base_units='-1';
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),JSON.stringify(snapshot));
 const reopened=new OwnershipStore(dir);await assert.rejects(reopened.init(),/Invalid agent treasury record/);
});

test('operation snapshots cannot associate a retry key with another owner agent',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),other=await store.createAnonymous();
 await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 const snapshot=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));snapshot.operations[0].owner_id=other.id;
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),JSON.stringify(snapshot));
 const reopened=new OwnershipStore(dir);await assert.rejects(reopened.init(),/Invalid agent operation idempotency record/);
});

test('persisted mock balances must reconcile exactly with unique receipts',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()});
 await store.mockFund(owner.id,agent.id,25,{idempotencyKey:requestKey()});
 const snapshot=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 snapshot.agents[0].treasury.receipts[0].amount='24';
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),JSON.stringify(snapshot));
 const reopened=new OwnershipStore(dir);await assert.rejects(reopened.init(),/balance does not match its receipts/);
});

test('public agent directory uses bounded cursor pages and sanitized owner references',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous();
 const agents=[];for(const name of ['First','Second','Third'])agents.push(await store.createAgent(owner.id,{...valid,name},avatars,{idempotencyKey:requestKey()}));
 const first=store.listPublicAgents({limit:2});assert.equal(first.agents.length,2);assert.equal(first.next_cursor,agents[1].id);
 const second=store.listPublicAgents({after:first.next_cursor,limit:2});assert.deepEqual(second.agents.map(agent=>agent.id),[agents[2].id]);assert.equal(second.next_cursor,null);
 assert.equal(second.agents[0].owner_id,undefined);assert.equal(second.agents[0].treasury,undefined);
 assert.throws(()=>store.listPublicAgents({limit:101}),{code:'INVALID_PAGE_SIZE'});
 assert.throws(()=>store.listPublicAgents({after:'invalid'}),{code:'INVALID_AGENT_CURSOR'});
 assert.deepEqual(store.recentPublicAgents(2).map(agent=>agent.id),[agents[2].id,agents[1].id]);
 assert.equal(store.recentPublicAgents(2)[0].treasury,undefined);
});

test('directory-sync failure after atomic rename keeps memory aligned with the committed snapshot',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-owner-fsync-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let failSync=false;
 const store=new OwnershipStore(dir,{syncFolder:async()=>{if(failSync){failSync=false;throw Object.assign(new Error('simulated directory sync failure'),{code:'EIO'});}}});
 await store.init();failSync=true;
 await assert.rejects(store.createAnonymous(),{code:'EIO'});
 const first=store.state.owners[0].id;
 const second=await store.createAnonymous();
 const restored=new OwnershipStore(dir);await restored.init();
 assert.ok(restored.owner(first));assert.ok(restored.owner(second.id));assert.equal(restored.state.owners.length,2);
});

test('ownership registry caps durable growth without losing the last valid snapshot',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-owner-capacity-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new OwnershipStore(dir,{maxBytes:512,now:()=>1_800_000_000_000});await store.init();
 const owner=await store.createAnonymous(),before=await readFile(path.join(dir,'state.json'));
 await assert.rejects(store.createAgent(owner.id,valid,avatars,{idempotencyKey:requestKey()}),{status:503,code:'OWNERSHIP_STORE_CAPACITY'});
 assert.equal(store.agentsForOwner(owner.id).length,0);assert.deepEqual(await readFile(path.join(dir,'state.json')),before);
 const restored=new OwnershipStore(dir,{maxBytes:512});await restored.init();assert.ok(restored.owner(owner.id));
});

test('ownership registry refuses an oversized persisted snapshot before parsing it',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-owner-oversized-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),' '.repeat(513),{mode:0o600});
 const store=new OwnershipStore(dir,{maxBytes:512});await assert.rejects(store.init(),{status:503,code:'OWNERSHIP_STORE_CAPACITY'});
});
