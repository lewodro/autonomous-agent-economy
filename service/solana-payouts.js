import {validSolanaAddress,validSolanaSignature} from './world-economy.js';

function safeCode(error){return String(error?.code||error?.name||'PAYOUT_EXECUTOR_ERROR').replace(/[^A-Z0-9_-]/gi,'_').slice(0,64);}
function validHttpsUrl(value,name){
  let parsed;try{parsed=new URL(value);}catch{throw new Error(`${name} must be a valid URL`);}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw new Error(`${name} must be an HTTPS URL without embedded credentials or fragments`);
  return parsed.href;
}

/** Calls a separately deployed signer and independently verifies settlement through Solana RPC. */
export class SolanaPayoutExecutorClient {
  constructor({executorUrl,executorToken,rpcUrl,cluster,genesisHash,fetchImpl=fetch,timeoutMs=8_000}){
    this.executorUrl=validHttpsUrl(executorUrl,'WORLD_PAYOUT_EXECUTOR_URL');
    this.rpcUrl=validHttpsUrl(rpcUrl,'WORLD_SOLANA_RPC_URL');
    if(typeof executorToken!=='string'||executorToken.length<32)throw new Error('WORLD_PAYOUT_EXECUTOR_TOKEN must contain at least 32 characters');
    if(!['devnet','mainnet-beta'].includes(cluster))throw new Error('WORLD_SOL_PAYOUT_CLUSTER must be devnet or mainnet-beta');
    if(typeof genesisHash!=='string'||genesisHash.length<20||genesisHash.length>64)throw new Error('WORLD_SOLANA_GENESIS_HASH is required');
    if(!Number.isInteger(timeoutMs)||timeoutMs<1_000||timeoutMs>30_000)throw new Error('Invalid payout executor timeout');
    this.executorToken=executorToken;this.cluster=cluster;this.genesisHash=genesisHash;this.fetch=fetchImpl;this.timeoutMs=timeoutMs;this.rpcId=0;this.networkCheck=null;
  }
  async request(url,options){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{return await this.fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timer);}
  }
  async rpc(method,params=[]){
    const id=++this.rpcId,response=await this.request(this.rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});
    if(!response.ok)throw Object.assign(new Error('Solana RPC request failed'),{code:`RPC_HTTP_${response.status}`});
    const payload=await response.json();
    if(payload.id!==id||payload.error)throw Object.assign(new Error('Solana RPC returned an invalid response'),{code:'INVALID_RPC_RESPONSE'});
    return payload.result;
  }
  async ensureNetwork(){
    this.networkCheck??=this.rpc('getGenesisHash').then(result=>{if(result!==this.genesisHash)throw Object.assign(new Error('Solana RPC genesis does not match configured cluster'),{code:'SOLANA_GENESIS_MISMATCH'});return true;}).catch(error=>{this.networkCheck=null;throw error;});
    return this.networkCheck;
  }
  async submit(intent){
    if(!validSolanaAddress(intent.recipient)||!validSolanaAddress(intent.treasury)||!Number.isSafeInteger(intent.amount_lamports)||intent.amount_lamports<1)throw Object.assign(new Error('Invalid payout intent'),{code:'INVALID_PAYOUT_INTENT'});
    await this.ensureNetwork();
    const response=await this.request(this.executorUrl,{method:'POST',headers:{Authorization:`Bearer ${this.executorToken}`,'Content-Type':'application/json','Idempotency-Key':intent.reward_id},body:JSON.stringify({version:1,intent_id:intent.reward_id,idempotency_key:intent.idempotency_key,recipient:intent.recipient,treasury:intent.treasury,amount_lamports:intent.amount_lamports,cluster:this.cluster,genesis_hash:this.genesisHash,memo:`lastseat:${intent.reward_id}`})});
    if(!response.ok)throw Object.assign(new Error('Payout executor rejected the intent'),{code:`EXECUTOR_HTTP_${response.status}`});
    const result=await response.json();
    if(result.intent_id!==intent.reward_id||!validSolanaSignature(result.transaction_signature))throw Object.assign(new Error('Payout executor returned invalid evidence'),{code:'INVALID_EXECUTOR_RESPONSE'});
    return{signature:result.transaction_signature};
  }
  async status(signature){
    if(!validSolanaSignature(signature))throw Object.assign(new Error('Invalid Solana transaction signature'),{code:'INVALID_TRANSACTION_SIGNATURE'});
    await this.ensureNetwork();const result=await this.rpc('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);
    if(!Array.isArray(result?.value))throw Object.assign(new Error('Solana RPC returned an invalid status response'),{code:'INVALID_RPC_RESPONSE'});
    const status=result.value[0];
    if(!status)return{state:'pending'};
    if(status.err!==null)return{state:'failed',error:'CHAIN_TRANSACTION_FAILED',slot:status.slot};
    return status.confirmationStatus==='finalized'?{state:'confirmed',slot:status.slot}:{state:'pending',slot:status.slot};
  }
}

/** Bounded settlement loop. It never has access to treasury key material. */
export class WorldPayoutWorker {
  constructor(ledger,executor,{intervalMs=10_000,retryDelayMs=30_000}={}){
    if(!Number.isInteger(intervalMs)||intervalMs<1_000)throw new Error('Payout interval must be at least one second');
    this.ledger=ledger;this.executor=executor;this.intervalMs=intervalMs;this.retryDelayMs=retryDelayMs;this.timer=null;this.running=null;this.stats={submitted:0,confirmed:0,failed:0,last_error:null,last_tick_at:null};
  }
  start(){if(this.timer)return;void this.tick();this.timer=setInterval(()=>void this.tick(),this.intervalMs);this.timer.unref?.();}
  async tick(){
    if(this.running)return this.running;
    this.running=this.run().finally(()=>{this.running=null;});
    return this.running;
  }
  async run(){
    this.stats.last_tick_at=new Date().toISOString();
    try{
      for(const payout of this.ledger.submittedPayouts().slice(0,20)){
        const status=await this.executor.status(payout.transaction_signature);
        if(status.state==='confirmed'){await this.ledger.markConfirmed(payout.reward_id,payout.transaction_signature,status.slot);this.stats.confirmed++;}
        else if(status.state==='failed'){await this.ledger.markChainFailure(payout.reward_id,payout.transaction_signature,status.error);this.stats.failed++;}
      }
      const intent=await this.ledger.claimPayable();
      if(intent){
        try{const {signature}=await this.executor.submit(intent);await this.ledger.markSubmitted(intent.reward_id,intent.claim_token,signature);this.stats.submitted++;}
        catch(error){await this.ledger.retryPayout(intent.reward_id,intent.claim_token,safeCode(error),{delayMs:this.retryDelayMs});throw error;}
      }
      this.stats.last_error=null;
    }catch(error){this.stats.last_error=safeCode(error);}
  }
  health(){return{enabled:true,running:Boolean(this.timer),...this.stats};}
  async close(){if(this.timer){clearInterval(this.timer);this.timer=null;}await this.running;}
}
