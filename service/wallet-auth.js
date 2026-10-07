import {createHash,createPublicKey,randomBytes,randomUUID,verify as verifyEd25519Signature} from 'node:crypto';

const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58=new Map([...ALPHABET].map((char,index)=>[char,BigInt(index)]));
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');
export const WALLET_CHALLENGE_TTL_MS=5*60_000;

export function decodeSolanaAddress(value){
 if(typeof value!=='string'||value.length<32||value.length>44||![...value].every(char=>BASE58.has(char)))throw new Error('Invalid Solana wallet address');
 let integer=0n;for(const char of value)integer=integer*58n+BASE58.get(char);
 const bytes=[];while(integer>0n){bytes.push(Number(integer&255n));integer>>=8n;}
 bytes.reverse();const leading=value.match(/^1*/)[0].length;
 const decoded=Buffer.concat([Buffer.alloc(leading),Buffer.from(bytes)]);
 if(decoded.length!==32||encodeBase58(decoded)!==value)throw new Error('Invalid Solana wallet address');
 return decoded;
}
export function encodeBase58(bytes){
 let integer=0n;for(const byte of bytes)integer=integer*256n+BigInt(byte);
 let encoded='';while(integer>0n){const remainder=Number(integer%58n);encoded=ALPHABET[remainder]+encoded;integer/=58n;}
 let leading=0;while(leading<bytes.length&&bytes[leading]===0)leading++;
 return '1'.repeat(leading)+(encoded|| (leading===bytes.length?'':''));
}
export function verifyWalletMessage(publicKey,message,signature){
 const key=decodeSolanaAddress(publicKey);
 if(typeof message!=='string'||message.length>1024||typeof signature!=='string'||signature.length>128) return false;
 let signed;try{signed=Buffer.from(signature,'base64url');}catch{return false;}
 if(signed.length!==64||signed.toString('base64url')!==signature)return false;
 const spki=createPublicKey({key:Buffer.concat([SPKI_PREFIX,key]),format:'der',type:'spki'});
 return verifyEd25519Signature(null,Buffer.from(message,'utf8'),spki,signed);
}

export class WalletChallengeService{
 constructor({now=Date.now,ttlMs=WALLET_CHALLENGE_TTL_MS,maxPending=5000}={}){this.now=now;this.ttlMs=ttlMs;this.maxPending=maxPending;this.pending=new Map();}
 issue(publicKey,origin,ownerContext=null){
  decodeSolanaAddress(publicKey);
  if(typeof origin!=='string'||origin.length>256||!/^https?:\/\/[a-z0-9.:[\]-]+(?::\d+)?$/i.test(origin))throw new Error('Invalid wallet challenge origin');
  if(ownerContext!==null&&(!ownerContext||typeof ownerContext.ownerId!=='string'||!/^[a-f0-9-]{36}$/.test(ownerContext.ownerId)||!Number.isSafeInteger(ownerContext.sessionVersion)||ownerContext.sessionVersion<0))throw new Error('Invalid wallet challenge owner context');
  const now=this.now();for(const [id,item] of this.pending)if(item.expiresAt<=now)this.pending.delete(id);
  if(this.pending.size>=this.maxPending)throw Object.assign(new Error('Wallet sign-in is temporarily busy'),{status:429,code:'AUTH_CAPACITY'});
  const id=randomUUID(),issued=new Date(now),expiresAt=now+this.ttlMs,nonce=randomBytes(16).toString('hex');
  const intent=ownerContext?`Sign in and link this wallet to profile ${ownerContext.ownerId}`:'Sign in with Solana';
  const message=`Autonomous Agent Economy\n${intent}\nOrigin: ${origin}\nWallet: ${publicKey}\nNonce: ${nonce}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
  this.pending.set(id,{publicKey,origin,message,expiresAt,ownerContext});
  return {challenge_id:id,public_key:publicKey,message,expires_at:new Date(expiresAt).toISOString()};
 }
 verify(challengeId,publicKey,signature,requestOrigin,ownerContext=null){
  const challenge=this.pending.get(challengeId);
  if(!challenge||challenge.expiresAt<=this.now()){this.pending.delete(challengeId);throw Object.assign(new Error('Wallet challenge is missing or expired'),{status:401,code:'CHALLENGE_EXPIRED'});}
  this.pending.delete(challengeId);
  if(typeof requestOrigin!=='string'||requestOrigin!==challenge.origin)throw Object.assign(new Error('Wallet challenge must be verified from the origin that requested it'),{status:401,code:'CHALLENGE_ORIGIN_MISMATCH'});
  if(challenge.ownerContext?.ownerId!==ownerContext?.ownerId||challenge.ownerContext?.sessionVersion!==ownerContext?.sessionVersion)throw Object.assign(new Error('Wallet challenge must be verified in the profile session that requested it'),{status:401,code:'CHALLENGE_OWNER_MISMATCH'});
  if(publicKey!==challenge.publicKey)throw Object.assign(new Error('Wallet does not match the challenge'),{status:401,code:'WALLET_MISMATCH'});
  try{if(!verifyWalletMessage(publicKey,challenge.message,signature))throw new Error('Signature did not verify');}
  catch(error){if(error?.code==='WALLET_MISMATCH')throw error;throw Object.assign(new Error('Wallet signature is invalid'),{status:401,code:'INVALID_SIGNATURE'});}
  return {publicKey:challenge.publicKey,origin:challenge.origin,verifiedAt:new Date(this.now()).toISOString()};
 }
}

export const walletAddressDigest=address=>createHash('sha256').update(decodeSolanaAddress(address)).digest('hex');
