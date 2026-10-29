import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {generateKeyPairSync,sign} from 'node:crypto';
import {WorldEconomy,RESOURCE_NODES} from '../service/world-economy.js';
import {SolanaPayoutExecutorClient,WorldPayoutWorker} from '../service/solana-payouts.js';

const wallet='11111111111111111111111111111111',signature='1'.repeat(64);
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);let encoded='';while(value){encoded=alphabet[Number(value%58n)]+encoded;value/=58n;}for(const byte of bytes){if(byte)break;encoded='1'+encoded;}return encoded||'1';}
async function verifyProfile(ledger){const {publicKey,privateKey}=generateKeyPairSync('ed25519'),address=base58(publicKey.export({format:'der',type:'spki'}).subarray(-32)),challenge=await ledger.createWalletChallenge('owner-a',{nickname:'Miro',wallet_address:address});await ledger.verifyWalletChallenge('owner-a',{challenge_id:challenge.challenge_id,signature:base58(sign(null,Buffer.from(challenge.message),privateKey))});}

test('executor submits an idempotent bounded intent and verifies finalized chain status',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return url==='https://signer.example/v1/payouts'?new Response(JSON.stringify({intent_id:'reward-1',transaction_signature:signature}),{status:200}):new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:{value:[{slot:42,err:null,confirmationStatus:'finalized'}]}}),{status:200});};
  const client=new SolanaPayoutExecutorClient({executorUrl:'https://signer.example/v1/payouts',executorToken:'x'.repeat(32),rpcUrl:'https://rpc.example',fetchImpl});
  const submitted=await client.submit({reward_id:'reward-1',idempotency_key:'node:1',recipient:wallet,treasury:wallet,amount_lamports:25});
  assert.equal(submitted.signature,signature);assert.equal(calls[0].options.headers['Idempotency-Key'],'reward-1');assert.doesNotMatch(calls[0].options.body,/executorToken|private|secret/i);
  assert.deepEqual(await client.status(signature),{state:'confirmed',slot:42});
});

test('payout worker submits once and reconciles confirmation on a later tick',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'payout-worker-')),ledger=new WorldEconomy(dir,{treasuryAddress:wallet,payoutsEnabled:true,lamportsPerCredit:25});
  let status='pending',submits=0;
  const executor={submit:async()=>{submits++;return{signature};},status:async()=>status==='confirmed'?{state:'confirmed',slot:77}:{state:'pending'}};
  const worker=new WorldPayoutWorker(ledger,executor,{intervalMs:60_000});
  try{
    await ledger.restore();await verifyProfile(ledger);await ledger.gather('owner-a',{node_id:RESOURCE_NODES[0].id},RESOURCE_NODES[0].position);
    await worker.tick();assert.equal(submits,1);assert.equal(ledger.snapshot('owner-a').receipts.at(-1).status,'submitted');
    await worker.tick();assert.equal(submits,1);assert.equal(ledger.snapshot('owner-a').receipts.at(-1).status,'submitted');
    status='confirmed';await worker.tick();assert.equal(ledger.snapshot('owner-a').receipts.at(-1).status,'confirmed');assert.equal(worker.health().confirmed,1);
  }finally{await worker.close();await ledger.close();await rm(dir,{recursive:true,force:true});}
});

test('executor configuration rejects insecure URLs and short bearer secrets',()=>{
  assert.throws(()=>new SolanaPayoutExecutorClient({executorUrl:'http://signer.example',executorToken:'x'.repeat(32),rpcUrl:'https://rpc.example'}),/HTTPS/);
  assert.throws(()=>new SolanaPayoutExecutorClient({executorUrl:'https://signer.example',executorToken:'short',rpcUrl:'https://rpc.example'}),/32 characters/);
});
