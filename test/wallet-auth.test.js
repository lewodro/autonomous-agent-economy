import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,generateKeyPairSync,sign} from 'node:crypto';
import {WalletChallengeService,encodeBase58,decodeSolanaAddress,verifyWalletMessage} from '../service/wallet-auth.js';
import {ownerCookie,ownerCookieClear,ownerIdFromRequest,ownerSessionFromRequest} from '../service/owner-auth.js';

function wallet(){const pair=generateKeyPairSync('ed25519'),publicKey=encodeBase58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));return {pair,publicKey};}
test('Solana wallet challenges verify an Ed25519 signature and are single-use',()=>{
 let now=1_800_000_000_000;const challenges=new WalletChallengeService({now:()=>now}),{pair,publicKey}=wallet();
 const challenge=challenges.issue(publicKey,'https://arena.example');
 const signature=sign(null,Buffer.from(challenge.message),pair.privateKey).toString('base64url');
 assert.equal(challenges.verify(challenge.challenge_id,publicKey,signature,'https://arena.example').publicKey,publicKey);
 assert.throws(()=>challenges.verify(challenge.challenge_id,publicKey,signature,'https://arena.example'),{code:'CHALLENGE_EXPIRED'});
});
test('wallet challenges bind origin and wallet, expire, and consume invalid attempts',()=>{
 let now=1_800_000_000_000;const challenges=new WalletChallengeService({now:()=>now,ttlMs:1000}),a=wallet(),b=wallet();
 const challenge=challenges.issue(a.publicKey,'http://127.0.0.1:3000');
 const badSignature=sign(null,Buffer.from(challenge.message),b.pair.privateKey).toString('base64url');
 assert.throws(()=>challenges.verify(challenge.challenge_id,a.publicKey,badSignature,'http://127.0.0.1:3000'),{code:'INVALID_SIGNATURE'});
 assert.throws(()=>challenges.verify(challenge.challenge_id,a.publicKey,badSignature,'http://127.0.0.1:3000'),{code:'CHALLENGE_EXPIRED'});
 const other=challenges.issue(a.publicKey,'https://arena.example');
 const signature=sign(null,Buffer.from(other.message),a.pair.privateKey).toString('base64url');
 assert.throws(()=>challenges.verify(other.challenge_id,a.publicKey,signature,'https://alternate.example'),{code:'CHALLENGE_ORIGIN_MISMATCH'});
 assert.throws(()=>challenges.verify(other.challenge_id,b.publicKey,'invalid','https://arena.example'),{code:'CHALLENGE_EXPIRED'});
 const mismatch=challenges.issue(a.publicKey,'https://arena.example');
 assert.throws(()=>challenges.verify(mismatch.challenge_id,b.publicKey,'invalid','https://arena.example'),{code:'WALLET_MISMATCH'});
 now+=1001;assert.throws(()=>challenges.verify(mismatch.challenge_id,a.publicKey,'invalid','https://arena.example'),{code:'CHALLENGE_EXPIRED'});
});
test('wallet addresses and signatures are canonical and bounded',()=>{
 const {pair,publicKey}=wallet(),message='test message',signature=sign(null,Buffer.from(message),pair.privateKey).toString('base64url');
 assert.equal(decodeSolanaAddress(publicKey).length,32);assert.equal(verifyWalletMessage(publicKey,message,signature),true);
 assert.equal(verifyWalletMessage(publicKey,message+'x',signature),false);
 assert.throws(()=>decodeSolanaAddress('not-a-wallet'));
 assert.equal(verifyWalletMessage(publicKey,message,signature+'!'),false);
});
test('owner cookie is scoped, HttpOnly, tamper-resistant and expires',()=>{
 const owner='a1f0c2d4-1111-4222-8333-123456789abc',env={HOST_SESSION_SECRET:'s'.repeat(32)},now=1_800_000_000_000;
 const cookie=ownerCookie(owner,env,now);assert.match(cookie,/Path=\/api; HttpOnly; SameSite=Strict/);
 const req={headers:{cookie:cookie.split(';')[0]}};
 assert.equal(ownerIdFromRequest(req,env,now),owner);
 assert.equal(ownerIdFromRequest({headers:{cookie:req.headers.cookie.replace(owner,'b1f0c2d4-1111-4222-8333-123456789abc')}},env,now),null);
 assert.equal(ownerIdFromRequest(req,env,now+31*24*60*60_000),null);
 assert.match(ownerCookieClear(env),/Max-Age=0/);
});
test('owner cookie carries a signed session version and accepts legacy version zero cookies',()=>{
 const owner='a1f0c2d4-1111-4222-8333-123456789abc',env={HOST_SESSION_SECRET:'s'.repeat(32)},now=1_800_000_000_000;
 const current=ownerCookie(owner,env,now,7),request={headers:{cookie:current.split(';')[0]}};
 assert.deepEqual(ownerSessionFromRequest(request,env,now),{ownerId:owner,sessionVersion:7});
 assert.equal(ownerSessionFromRequest({headers:{cookie:current.replace('.7.','.8.').split(';')[0]}},env,now),null);
 const payload=`${owner}.${Math.floor(now/1000)+30*24*60*60}`;
 const signature=createHmac('sha256',env.HOST_SESSION_SECRET).update(`aae-owner-v1:${payload}`).digest('base64url');
 assert.deepEqual(ownerSessionFromRequest({headers:{cookie:`aae_owner=${payload}.${signature}`}},env,now),{ownerId:owner,sessionVersion:0});
});
