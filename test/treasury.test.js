import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorldStore } from '../service/world-store.js';
import { TreasuryLedger } from '../service/treasury.js';

async function setup(options={}){const directory=await mkdtemp(path.join(os.tmpdir(),'treasury-'));const store=new WorldStore({directory,fileName:'treasury.json'});await store.open();const ledger=new TreasuryLedger(store,options);await ledger.restore();return{ledger,directory,close:async()=>{await ledger.close();await rm(directory,{recursive:true,force:true});}};}

test('unconfigured public treasury reports honest empty state without secrets',async()=>{const {ledger,close}=await setup();try{const view=ledger.publicSnapshot();assert.equal(view.status,'not_funded');assert.equal(view.public_address,null);assert.equal(view.reserves,null);assert.equal(view.payouts_enabled,false);assert.equal(view.internal_credits_redeemable,false);assert.equal(JSON.stringify(view).includes('private'),false);}finally{await close();}});

test('treasury totals derive only from append-only real-asset events',async()=>{const {ledger,close}=await setup({address:'11111111111111111111111111111111',network:'devnet'});try{
  await ledger.append({type:'funding',amount:1000,status:'confirmed',reference_id:'fund-1'});
  await ledger.append({type:'reward_allocation',amount:600,status:'approved',reference_id:'allocation-1'});
  await ledger.append({type:'payout_requested',amount:100,status:'queued',reference_id:'payout-1'});
  await ledger.append({type:'payout_approved',amount:100,status:'approved',reference_id:'payout-1'});
  const replay=await ledger.append({type:'payout_requested',amount:100,status:'queued',reference_id:'payout-1'});
  assert.equal(replay.reference_id,'payout-1');assert.equal(ledger.state.events.length,4);
  const view=ledger.publicSnapshot();assert.equal(view.reserves,1000);assert.equal(view.reward_allocation,600);assert.equal(view.outstanding_payouts,100);assert.equal(view.available_reward_budget,500);assert.equal(view.paid_lifetime,0);
}finally{await close();}});

test('treasury rejects malformed events and unsupported accounting input',async()=>{const {ledger,close}=await setup();try{await assert.rejects(()=>ledger.append({type:'credits_earned',amount:1,reference_id:'bad'}),/Unsupported/);await assert.rejects(()=>ledger.append({type:'funding',amount:-1,reference_id:'bad-2'}),/non-negative/);}finally{await close();}});
