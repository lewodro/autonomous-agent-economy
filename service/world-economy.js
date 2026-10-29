import {createHash,createPublicKey,randomUUID,verify as verifySignature} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';

const VERSION=2;
const NICKNAME=/^[A-Za-z][A-Za-z0-9 _-]{1,23}$/;
const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const PAYOUT_STATUSES=new Set(['payable','submitting','submitted','confirmed','retryable','held','failed']);
export const RESOURCE_NODES=Object.freeze([
  {id:'ore-west-1',kind:'ore',position:{x:-680,y:1320},reward:3},
  {id:'ore-north-1',kind:'ore',position:{x:1350,y:-250},reward:3},
  {id:'ore-east-1',kind:'ore',position:{x:2380,y:920},reward:3},
  {id:'herb-garden-1',kind:'herb',position:{x:1710,y:1010},reward:2},
  {id:'herb-north-1',kind:'herb',position:{x:300,y:-240},reward:2},
  {id:'herb-south-1',kind:'herb',position:{x:1660,y:1540},reward:2},
]);

function fail(code,message,status=400){return Object.assign(new Error(message),{code,status});}
function publicUserId(owner){return `world_${createHash('sha256').update(owner).digest('hex').slice(0,20)}`;}
function decodeBase58(value){
  if(typeof value!=='string'||!value.length)return null;
  let decoded=0n;
  for(const char of value){const digit=ALPHABET.indexOf(char);if(digit<0)return null;decoded=decoded*58n+BigInt(digit);}
  const bytes=[];while(decoded>0n){bytes.push(Number(decoded&255n));decoded>>=8n;}bytes.reverse();
  let leading=0;for(const char of value){if(char!=='1')break;leading++;}
  return Buffer.concat([Buffer.alloc(leading),Buffer.from(bytes)]);
}
export function validSolanaAddress(value){return typeof value==='string'&&value.length>=32&&value.length<=44&&decodeBase58(value)?.length===32;}
export function validSolanaSignature(value){return typeof value==='string'&&value.length>=64&&value.length<=100&&decodeBase58(value)?.length===64;}
function cleanErrorCode(value){return String(value||'PAYOUT_RETRY').replace(/[^A-Z0-9_-]/gi,'_').slice(0,64);}
function utcDay(timestamp){return new Date(timestamp).toISOString().slice(0,10);}

/** Persistent reward ledger. Signing is delegated to a separately deployed payout executor. */
export class WorldEconomy {
  constructor(directory,{now=()=>Date.now(),respawnMs=45_000,treasuryAddress=null,payoutsEnabled=false,lamportsPerCredit=0,maxPayoutLamports=1_000_000,dailyPayoutCapLamports=10_000_000,maxPayoutAttempts=5}={}){
    if(!Number.isInteger(respawnMs)||respawnMs<5_000||respawnMs>3_600_000)throw new Error('Invalid resource respawn duration');
    if(treasuryAddress&&!validSolanaAddress(treasuryAddress))throw new Error('WORLD_TREASURY_ADDRESS must be a valid public Solana address');
    for(const [name,value] of Object.entries({maxPayoutLamports,dailyPayoutCapLamports,maxPayoutAttempts}))if(!Number.isSafeInteger(value)||value<1)throw new Error(`${name} must be a positive safe integer`);
    if(payoutsEnabled&&(!treasuryAddress||!Number.isSafeInteger(lamportsPerCredit)||lamportsPerCredit<1))throw new Error('Real payout receipts require a public treasury and positive lamports-per-credit');
    this.directory=directory;this.file=path.join(directory,'world-economy.json');this.now=now;this.respawnMs=respawnMs;
    this.treasuryAddress=treasuryAddress;this.payoutsEnabled=payoutsEnabled;this.lamportsPerCredit=lamportsPerCredit;
    this.maxPayoutLamports=maxPayoutLamports;this.dailyPayoutCapLamports=dailyPayoutCapLamports;this.maxPayoutAttempts=maxPayoutAttempts;
    this.state={version:VERSION,profiles:{},nodes:Object.fromEntries(RESOURCE_NODES.map(node=>[node.id,{generation:0,availableAt:0}])),receipts:[]};this.writeQueue=Promise.resolve();
  }
  async restore(){
    await mkdir(this.directory,{recursive:true});let saved;
    try{saved=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(saved){
      if(![1,VERSION].includes(saved.version)||!saved.profiles||!saved.nodes||!Array.isArray(saved.receipts)||saved.receipts.length>20_000)throw new Error('Invalid world economy checkpoint');
      this.state=saved;this.state.version=VERSION;
      for(const receipt of this.state.receipts){
        if(receipt.amount_lamports&&!PAYOUT_STATUSES.has(receipt.status))throw new Error('Invalid payout receipt status');
        receipt.payout_attempts??=0;
      }
      for(const node of RESOURCE_NODES)this.state.nodes[node.id]||={generation:0,availableAt:0};
      await this.persist();
    }
    return this.snapshot();
  }
  persist(){const snapshot=structuredClone(this.state);this.writeQueue=this.writeQueue.then(async()=>{const temp=`${this.file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(snapshot),{mode:0o600});await rename(temp,this.file);});return this.writeQueue;}
  profile(owner){const stored=this.state.profiles[owner]||{user_id:publicUserId(owner),nickname:'',wallet_address:null,wallet_link_status:'unlinked',credits:0};const {wallet_challenge,...safe}=stored;return{...safe,auth_mode:'signed_visitor',treasury_address:this.treasuryAddress,payouts_enabled:this.payoutsEnabled};}
  async linkProfile(owner,input={}){const nickname=String(input.nickname||'').trim(),wallet=input.wallet_address==null||input.wallet_address===''?null:String(input.wallet_address).trim();if(!NICKNAME.test(nickname))throw fail('INVALID_NICKNAME','Nickname must be 2-24 letters, numbers, spaces, _ or -');if(wallet&&!validSolanaAddress(wallet))throw fail('INVALID_WALLET','Enter a valid public Solana wallet address');const current=this.profile(owner),sameVerified=wallet&&wallet===current.wallet_address&&current.wallet_link_status==='verified';this.state.profiles[owner]={user_id:current.user_id,nickname,wallet_address:wallet,wallet_link_status:sameVerified?'verified':wallet?'self_declared':'unlinked',credits:current.credits,...(sameVerified?{wallet_verified_at:current.wallet_verified_at,wallet_verification_id:current.wallet_verification_id}:{})};await this.persist();return this.profile(owner);}
  async createWalletChallenge(owner,input={}){
    const profile=await this.linkProfile(owner,input),now=this.now(),challengeId=randomUUID(),expiresAt=new Date(now+10*60_000).toISOString();
    if(!profile.wallet_address)throw fail('WALLET_REQUIRED','Enter a public Solana wallet address');
    const message=`Last Seat wallet link\nUser: ${profile.user_id}\nWallet: ${profile.wallet_address}\nChallenge: ${challengeId}\nExpires: ${expiresAt}`;
    this.state.profiles[owner].wallet_challenge={challenge_id:challengeId,message,expires_at:expiresAt,wallet_address:profile.wallet_address};await this.persist();
    return{challenge_id:challengeId,message,expires_at:expiresAt,wallet_address:profile.wallet_address};
  }
  async verifyWalletChallenge(owner,input={}){
    const stored=this.state.profiles[owner],challenge=stored?.wallet_challenge;
    if(!challenge||challenge.challenge_id!==input.challenge_id)throw fail('WALLET_CHALLENGE_INVALID','Request a new wallet-link challenge',409);
    if(Date.parse(challenge.expires_at)<=this.now())throw fail('WALLET_CHALLENGE_EXPIRED','Wallet-link challenge expired',409);
    const signature=decodeBase58(input.signature),publicBytes=decodeBase58(challenge.wallet_address);
    if(signature?.length!==64||publicBytes?.length!==32)throw fail('WALLET_PROOF_INVALID','Wallet signature is invalid',403);
    const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes]),format:'der',type:'spki'});
    if(!verifySignature(null,Buffer.from(challenge.message),key,signature))throw fail('WALLET_PROOF_INVALID','Wallet signature is invalid',403);
    stored.wallet_link_status='verified';stored.wallet_verified_at=new Date(this.now()).toISOString();stored.wallet_verification_id=challenge.challenge_id;delete stored.wallet_challenge;await this.persist();return this.profile(owner);
  }
  nodes(){const now=this.now();return RESOURCE_NODES.map(node=>({...node,available:(this.state.nodes[node.id]?.availableAt||0)<=now,available_at:new Date(this.state.nodes[node.id]?.availableAt||0).toISOString()}));}
  publicReceipt(receipt){const {owner,claim_token,lease_expires_at,last_error_code,...publicValue}=receipt;return publicValue;}
  snapshot(owner=null){return{mode:'test_credits',nodes:this.nodes(),profile:owner?this.profile(owner):null,treasury:{public_address:this.treasuryAddress,payouts_enabled:this.payoutsEnabled,signing:'external_executor',max_payout_lamports:this.maxPayoutLamports,daily_cap_lamports:this.dailyPayoutCapLamports},receipts:owner?this.state.receipts.filter(receipt=>receipt.owner===owner).slice(-20).map(receipt=>this.publicReceipt(receipt)):[]};}
  async gather(owner,{node_id}={},position){const node=RESOURCE_NODES.find(value=>value.id===node_id);if(!node)throw fail('RESOURCE_NOT_FOUND','Unknown resource node',404);if(!position||Math.hypot(position.x-node.position.x,position.y-node.position.y)>72)throw fail('RESOURCE_OUT_OF_RANGE','Move closer to gather this resource',409);const runtime=this.state.nodes[node.id],now=this.now();if(runtime.availableAt>now)throw fail('RESOURCE_RESPAWNING','This resource is still respawning',409);const generation=runtime.generation+1,idempotency_key=`${node.id}:${generation}`;if(this.state.receipts.some(value=>value.idempotency_key===idempotency_key))throw fail('REWARD_DUPLICATE','This harvest was already rewarded',409);const profile=this.profile(owner);profile.credits+=node.reward;this.state.profiles[owner]={...this.state.profiles[owner],user_id:profile.user_id,nickname:profile.nickname,wallet_address:profile.wallet_address,wallet_link_status:profile.wallet_link_status,credits:profile.credits};runtime.generation=generation;runtime.availableAt=now+this.respawnMs;const payable=this.payoutsEnabled&&profile.wallet_link_status==='verified';const receipt={reward_id:randomUUID(),owner,user_id:profile.user_id,source_action:`gather:${node.kind}`,node_id:node.id,generation,amount_credits:node.reward,timestamp:new Date(now).toISOString(),status:payable?'payable':'test_credited',idempotency_key,payout_attempts:0,...(payable?{wallet_address:profile.wallet_address,treasury_address:this.treasuryAddress,amount_lamports:node.reward*this.lamportsPerCredit,transaction_signature:null}:{})};this.state.receipts.push(receipt);this.state.receipts=this.state.receipts.slice(-20_000);await this.persist();return{node:{...node,available:false,available_at:new Date(runtime.availableAt).toISOString()},profile:this.profile(owner),receipt:this.publicReceipt(receipt)};}
  async claimPayable({leaseMs=30_000}={}){
    const now=this.now(),nowIso=new Date(now).toISOString(),day=utcDay(nowIso);
    for(const receipt of this.state.receipts)if(receipt.status==='submitting'&&Date.parse(receipt.lease_expires_at||'')<=now){receipt.status='payable';delete receipt.claim_token;delete receipt.lease_expires_at;delete receipt.payout_day;}
    const committed=this.state.receipts.filter(receipt=>['submitting','submitted','confirmed'].includes(receipt.status)&&receipt.payout_day===day).reduce((sum,receipt)=>sum+(receipt.amount_lamports||0),0);
    const receipt=this.state.receipts.find(value=>['payable','retryable'].includes(value.status)&&(!value.retry_at||Date.parse(value.retry_at)<=now));
    if(!receipt){await this.persist();return null;}
    if(receipt.amount_lamports>this.maxPayoutLamports||committed+receipt.amount_lamports>this.dailyPayoutCapLamports){receipt.status='held';receipt.hold_reason=receipt.amount_lamports>this.maxPayoutLamports?'per_payout_cap':'daily_cap';await this.persist();return null;}
    receipt.status='submitting';receipt.claim_token=randomUUID();receipt.lease_expires_at=new Date(now+leaseMs).toISOString();receipt.payout_day=day;receipt.payout_attempts=(receipt.payout_attempts||0)+1;delete receipt.retry_at;await this.persist();
    return{reward_id:receipt.reward_id,idempotency_key:receipt.idempotency_key,user_id:receipt.user_id,recipient:receipt.wallet_address,treasury:receipt.treasury_address,amount_lamports:receipt.amount_lamports,claim_token:receipt.claim_token};
  }
  findClaim(rewardId,claimToken){const receipt=this.state.receipts.find(value=>value.reward_id===rewardId);if(!receipt||receipt.status!=='submitting'||receipt.claim_token!==claimToken)throw fail('PAYOUT_CLAIM_STALE','Payout claim is stale',409);return receipt;}
  async markSubmitted(rewardId,claimToken,signature){if(!validSolanaSignature(signature))throw fail('INVALID_TRANSACTION_SIGNATURE','Executor returned an invalid Solana signature',502);const receipt=this.findClaim(rewardId,claimToken);receipt.status='submitted';receipt.transaction_signature=signature;receipt.submitted_at=new Date(this.now()).toISOString();delete receipt.claim_token;delete receipt.lease_expires_at;await this.persist();return this.publicReceipt(receipt);}
  async retryPayout(rewardId,claimToken,errorCode,{delayMs=30_000}={}){const receipt=this.findClaim(rewardId,claimToken);receipt.last_error_code=cleanErrorCode(errorCode);receipt.status=receipt.payout_attempts>=this.maxPayoutAttempts?'failed':'retryable';if(receipt.status==='retryable')receipt.retry_at=new Date(this.now()+delayMs).toISOString();delete receipt.claim_token;delete receipt.lease_expires_at;delete receipt.payout_day;await this.persist();return this.publicReceipt(receipt);}
  submittedPayouts(){return this.state.receipts.filter(receipt=>receipt.status==='submitted').map(receipt=>({reward_id:receipt.reward_id,transaction_signature:receipt.transaction_signature}));}
  async markConfirmed(rewardId,signature,slot){const receipt=this.state.receipts.find(value=>value.reward_id===rewardId);if(!receipt||receipt.status!=='submitted'||receipt.transaction_signature!==signature)throw fail('PAYOUT_SUBMISSION_STALE','Payout submission is stale',409);receipt.status='confirmed';receipt.confirmed_at=new Date(this.now()).toISOString();receipt.confirmed_slot=slot;await this.persist();return this.publicReceipt(receipt);}
  async markChainFailure(rewardId,signature,errorCode){const receipt=this.state.receipts.find(value=>value.reward_id===rewardId);if(!receipt||receipt.status!=='submitted'||receipt.transaction_signature!==signature)throw fail('PAYOUT_SUBMISSION_STALE','Payout submission is stale',409);receipt.status='failed';receipt.last_error_code=cleanErrorCode(errorCode);receipt.failed_at=new Date(this.now()).toISOString();delete receipt.payout_day;await this.persist();return this.publicReceipt(receipt);}
  health(){const counts={};for(const receipt of this.state.receipts)counts[receipt.status]=(counts[receipt.status]||0)+1;return{status:'ok',nodes:RESOURCE_NODES.length,receipts:this.state.receipts.length,payouts_enabled:this.payoutsEnabled,treasury_configured:Boolean(this.treasuryAddress),payout_statuses:counts};}
  async close(){await this.writeQueue;}
}
