import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {WorldEconomy,RESOURCE_NODES} from '../service/world-economy.js';
import {collides,isNaturalGround} from '../web/dist/world/map.js';

const wallet='11111111111111111111111111111111';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);let encoded='';while(value){encoded=alphabet[Number(value%58n)]+encoded;value/=58n;}for(const byte of bytes){if(byte)break;encoded='1'+encoded;}return encoded||'1';}
async function verifiedProfile(economy,owner='owner-a'){
  const {publicKey,privateKey}=generateKeyPairSync('ed25519'),raw=publicKey.export({format:'der',type:'spki'}).subarray(-32),walletAddress=base58(raw);
  const challenge=await economy.createWalletChallenge(owner,{nickname:'Miro',wallet_address:walletAddress});
  const signature=base58(sign(null,Buffer.from(challenge.message),privateKey));
  return{profile:await economy.verifyWalletChallenge(owner,{challenge_id:challenge.challenge_id,signature}),walletAddress};
}
test('resource nodes occupy reachable natural terrain',()=>{for(const node of RESOURCE_NODES){assert.equal(isNaturalGround(node.position,16),true,node.id);assert.equal(collides(node.position),false,node.id);}});
test('world resources gather once per generation, respawn, and persist receipts',async()=>{let now=1_000;const dir=await mkdtemp(path.join(os.tmpdir(),'world-economy-')),economy=new WorldEconomy(dir,{now:()=>now,respawnMs:5_000});try{await economy.restore();const node=RESOURCE_NODES[0];const first=await economy.gather('owner-a',{node_id:node.id},node.position);assert.equal(first.profile.credits,node.reward);assert.equal(first.receipt.status,'test_credited');await assert.rejects(()=>economy.gather('owner-a',{node_id:node.id},node.position),{code:'RESOURCE_RESPAWNING'});now+=5_001;const second=await economy.gather('owner-a',{node_id:node.id},node.position);assert.equal(second.profile.credits,node.reward*2);const restored=new WorldEconomy(dir,{now:()=>now,respawnMs:5_000});await restored.restore();assert.equal(restored.snapshot('owner-a').receipts.length,2);}finally{await economy.close();await rm(dir,{recursive:true,force:true});}});

test('wallet linking requires a signed ownership proof before creating payable receipts',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'world-payable-')),economy=new WorldEconomy(dir,{treasuryAddress:wallet,payoutsEnabled:true,lamportsPerCredit:25});try{await economy.restore();const declared=await economy.linkProfile('owner-a',{nickname:'Miro',wallet_address:wallet});assert.equal(declared.wallet_link_status,'self_declared');assert.equal('private_key' in declared,false);const {profile,walletAddress}=await verifiedProfile(economy);assert.equal(profile.wallet_link_status,'verified');assert.equal(profile.wallet_address,walletAddress);const node=RESOURCE_NODES[1],result=await economy.gather('owner-a',{node_id:node.id},node.position);assert.equal(result.receipt.status,'payable');assert.equal(result.receipt.amount_lamports,node.reward*25);assert.equal(result.receipt.treasury_address,wallet);assert.equal(result.receipt.transaction_signature,null);}finally{await economy.close();await rm(dir,{recursive:true,force:true});}});

test('wallet input rejects secrets and malformed public addresses',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'world-profile-')),economy=new WorldEconomy(dir);try{await economy.restore();await assert.rejects(()=>economy.linkProfile('owner-a',{nickname:'Miro',wallet_address:'seed phrase words'}),{code:'INVALID_WALLET'});assert.equal(economy.profile('owner-a').wallet_address,null);}finally{await rm(dir,{recursive:true,force:true});}});

test('payable receipts move through an idempotent claim, submission, and confirmation lifecycle',async()=>{
  let now=10_000;
  const dir=await mkdtemp(path.join(os.tmpdir(),'world-settlement-'));
  const economy=new WorldEconomy(dir,{now:()=>now,treasuryAddress:wallet,payoutsEnabled:true,lamportsPerCredit:25,maxPayoutLamports:100,dailyPayoutCapLamports:200});
  try{
    await economy.restore();await verifiedProfile(economy);
    const gathered=await economy.gather('owner-a',{node_id:RESOURCE_NODES[0].id},RESOURCE_NODES[0].position);
    const claim=await economy.claimPayable();
    assert.equal(claim.reward_id,gathered.receipt.reward_id);assert.equal(claim.amount_lamports,75);
    assert.equal(await economy.claimPayable(),null,'a claimed receipt cannot be claimed twice');
    const signature='1'.repeat(64);
    await economy.markSubmitted(claim.reward_id,claim.claim_token,signature);
    assert.deepEqual(economy.submittedPayouts(),[{reward_id:claim.reward_id,transaction_signature:signature}]);
    await economy.markConfirmed(claim.reward_id,signature,1234);
    const receipt=economy.snapshot('owner-a').receipts.at(-1);
    assert.equal(receipt.status,'confirmed');assert.equal(receipt.confirmed_slot,1234);assert.equal('claim_token' in receipt,false);
    await assert.rejects(()=>economy.markConfirmed(claim.reward_id,signature,1234),{code:'PAYOUT_SUBMISSION_STALE'});
  }finally{await economy.close();await rm(dir,{recursive:true,force:true});}
});

test('payout claims recover expired leases, retry with a stable intent, and enforce caps',async()=>{
  let now=20_000;
  const dir=await mkdtemp(path.join(os.tmpdir(),'world-payout-retry-'));
  const economy=new WorldEconomy(dir,{now:()=>now,treasuryAddress:wallet,payoutsEnabled:true,lamportsPerCredit:25,maxPayoutLamports:100,dailyPayoutCapLamports:100,maxPayoutAttempts:2});
  try{
    await economy.restore();await verifiedProfile(economy);
    await economy.gather('owner-a',{node_id:RESOURCE_NODES[1].id},RESOURCE_NODES[1].position);
    const first=await economy.claimPayable({leaseMs:5_000});now+=5_001;
    const recovered=await economy.claimPayable({leaseMs:5_000});
    assert.equal(recovered.reward_id,first.reward_id);assert.equal(recovered.idempotency_key,first.idempotency_key);
    const failed=await economy.retryPayout(recovered.reward_id,recovered.claim_token,'executor timeout');
    assert.equal(failed.status,'failed','the configured attempt ceiling prevents an unbounded retry loop');
  }finally{await economy.close();await rm(dir,{recursive:true,force:true});}
});
