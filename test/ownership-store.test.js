import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {OwnershipStore} from '../service/ownership-store.js';
import {encodeBase58} from '../service/wallet-auth.js';

const avatars=new Set(['visitor_ember','visitor_atlas']);
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-owner-store-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new OwnershipStore(dir,{now:()=>1_800_000_000_000});await store.init();return {store,dir};
}
const valid={name:'Builder',avatar:'visitor_ember',strategy:'conservative',personality:'Patient, measured play.',capabilities:['games']};

test('anonymous owner can create a free agent and state survives restart',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous();
 assert.equal(owner.identity_type,'anonymous');assert.equal(owner.wallet_public_key,null);
 const agent=await store.createAgent(owner.id,valid,avatars);
 assert.match(agent.id,/^u-/);assert.equal(agent.treasury.network,'none');
 const reopened=new OwnershipStore(dir);await reopened.init();
 assert.equal(reopened.agentForOwner(owner.id,agent.id).name,'Builder');
 assert.equal(reopened.agentForOwner('some-other-owner',agent.id),null);
});

test('wallet owners validate canonical public keys and are reused idempotently',async t=>{
 const {store}=await fixture(t),pair=generateKeyPairSync('ed25519');
 const key=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const first=await store.createWalletOwner(key),second=await store.createWalletOwner(key);
 assert.equal(first.id,second.id);assert.equal(first.identity_type,'solana');
 await assert.rejects(store.createWalletOwner('not-a-wallet'),{code:'INVALID_WALLET_ADDRESS'});
});

test('linking a verified wallet upgrades a guest without orphaning agents and forbids implicit account merge',async t=>{
 const {store}=await fixture(t),guest=await store.createAnonymous(),agent=await store.createAgent(guest.id,valid,avatars),pair=generateKeyPairSync('ed25519');
 const key=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const linked=await store.linkWalletOwner(guest.id,key);
 assert.equal(linked.id,guest.id);assert.equal(linked.identity_type,'solana');assert.equal(store.agentForOwner(linked.id,agent.id).id,agent.id);
 const other=await store.createAnonymous();
 await assert.rejects(store.linkWalletOwner(other.id,key),{code:'WALLET_ALREADY_OWNED'});
 assert.equal(store.owner(other.id).identity_type,'anonymous');
});

test('agent import accepts only the public schema and export excludes ownership and treasury data',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous();
 const agent=await store.createAgent(owner.id,{format:'aae-agent-v1',...valid},avatars,{importing:true});
 const exported=store.exportAgent(owner.id,agent.id);
 assert.deepEqual(Object.keys(exported).sort(),['avatar','capabilities','format','model','name','personality','provider','strategy'].sort());
 assert.equal(JSON.stringify(exported).includes(owner.id),false);
 await assert.rejects(store.createAgent(owner.id,{...valid,owner_id:'forged'},avatars),{code:'UNSUPPORTED_AGENT_FIELD'});
 await assert.rejects(store.createAgent(owner.id,{...valid,api_key:'secret'},avatars,{importing:true}),{code:'UNSUPPORTED_AGENT_FIELD'});
 await assert.rejects(store.createAgent(owner.id,{...valid,avatar:'debug_placeholder'},avatars),{code:'INVALID_AGENT_AVATAR'});
 await assert.rejects(store.createAgent(owner.id,{...valid,provider:'custom-http'},avatars),{code:'UNSUPPORTED_AGENT_PROVIDER'});
});

test('mock funding persists an auditable simulated receipt and rejects duplicate configuration fields',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars);
 const first=await store.mockFund(owner.id,agent.id,250);
 assert.equal(first.treasury.available_base_units,'250');assert.equal(first.receipt.status,'simulated');
 const reopened=new OwnershipStore(dir);await reopened.init();
 const restored=reopened.agentForOwner(owner.id,agent.id);
 assert.equal(restored.treasury.available_base_units,'250');assert.equal(restored.treasury.receipts.length,1);
 await assert.rejects(store.mockFund('other-owner',agent.id,250),{code:'AGENT_NOT_FOUND'});
 const persisted=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 assert.equal(JSON.stringify(persisted).includes('private_key'),false);
});

test('spending defaults to read-only and autonomous budgets remain unavailable',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars);
 assert.equal(agent.treasury.spending_policy.mode,'read_only');
 const manual=await store.setSpendingPolicy(owner.id,agent.id,{mode:'manual'});assert.equal(manual.mode,'manual');
 await assert.rejects(store.setSpendingPolicy(owner.id,agent.id,{mode:'budgeted',max_per_day:'100'}),{code:'AGENT_SPENDING_NOT_IMPLEMENTED'});
 await assert.rejects(store.setSpendingPolicy(owner.id,agent.id,{mode:'read_only',allowed_capabilities:['compute']}),{code:'READ_ONLY_CAPABILITIES'});
});

test('corrupt or internally inconsistent ownership snapshots fail closed',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars);
 const snapshot=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 snapshot.agents[0].treasury.available_base_units='-1';
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),JSON.stringify(snapshot));
 const reopened=new OwnershipStore(dir);await assert.rejects(reopened.init(),/Invalid agent treasury record/);
});

test('persisted mock balances must reconcile exactly with unique receipts',async t=>{
 const {store,dir}=await fixture(t),owner=await store.createAnonymous(),agent=await store.createAgent(owner.id,valid,avatars);
 await store.mockFund(owner.id,agent.id,25);
 const snapshot=JSON.parse(await readFile(path.join(dir,'state.json'),'utf8'));
 snapshot.agents[0].treasury.receipts[0].amount='24';
 const {writeFile}=await import('node:fs/promises');await writeFile(path.join(dir,'state.json'),JSON.stringify(snapshot));
 const reopened=new OwnershipStore(dir);await assert.rejects(reopened.init(),/balance does not match its receipts/);
});

test('public agent directory uses bounded cursor pages and sanitized owner references',async t=>{
 const {store}=await fixture(t),owner=await store.createAnonymous();
 const agents=[];for(const name of ['First','Second','Third'])agents.push(await store.createAgent(owner.id,{...valid,name},avatars));
 const first=store.listPublicAgents({limit:2});assert.equal(first.agents.length,2);assert.equal(first.next_cursor,agents[1].id);
 const second=store.listPublicAgents({after:first.next_cursor,limit:2});assert.deepEqual(second.agents.map(agent=>agent.id),[agents[2].id]);assert.equal(second.next_cursor,null);
 assert.equal(second.agents[0].owner_id,undefined);assert.equal(second.agents[0].treasury,undefined);
 assert.throws(()=>store.listPublicAgents({limit:101}),{code:'INVALID_PAGE_SIZE'});
 assert.throws(()=>store.listPublicAgents({after:'invalid'}),{code:'INVALID_AGENT_CURSOR'});
});
