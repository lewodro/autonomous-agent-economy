import {constants} from 'node:fs';
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {decodeSolanaAddress} from './wallet-auth.js';

const strategies=new Set(['aggressive','conservative','opportunist','cooperative']);
const capabilities=new Set(['compute','tools','games']);
const inputFields=new Set(['format','name','avatar','strategy','personality','capabilities','provider','model']);
const MAX_IDEMPOTENCY_RECORDS=20_000;
const MAX_STORE_BYTES=16*1024*1024;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const cleanOwner=owner=>({id:owner.id,created_at:owner.created_at,identity_type:owner.identity_type,wallet_public_key:owner.wallet_public_key||null});
const storeCapacityError=maxBytes=>Object.assign(new Error(`Ownership registry reached its ${maxBytes}-byte durable storage limit.`),{status:503,code:'OWNERSHIP_STORE_CAPACITY'});
async function syncDirectory(directory){const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
function validateAgentInput(value,approvedAvatars,{importing=false}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('Agent configuration must be an object'),{status:400,code:'INVALID_AGENT_CONFIG'});
 for(const key of Object.keys(value))if(!inputFields.has(key))throw Object.assign(new Error(`Unsupported agent field: ${key}`),{status:400,code:'UNSUPPORTED_AGENT_FIELD'});
 if(importing&&value.format!=='aae-agent-v1')throw Object.assign(new Error('Unsupported agent export format'),{status:400,code:'INVALID_AGENT_FORMAT'});
 if(!importing&&value.format!==undefined)throw Object.assign(new Error('Use the agent import route for exported files'),{status:400,code:'INVALID_AGENT_FORMAT'});
 const name=typeof value.name==='string'?value.name.trim():'';
 if(!name||[...name].length>28)throw Object.assign(new Error('Agent name must contain 1–28 characters'),{status:400,code:'INVALID_AGENT_NAME'});
 const avatar=value.avatar;
 if(typeof avatar!=='string'||!approvedAvatars.has(avatar))throw Object.assign(new Error('Choose an approved avatar ID'),{status:400,code:'INVALID_AGENT_AVATAR'});
 const strategy=value.strategy||'opportunist';
 if(!strategies.has(strategy))throw Object.assign(new Error('Unknown strategy'),{status:400,code:'INVALID_AGENT_STRATEGY'});
 if(value.provider!==undefined&&value.provider!=='mock')throw Object.assign(new Error('User agents currently support the deterministic mock provider only'),{status:400,code:'UNSUPPORTED_AGENT_PROVIDER'});
 const model=value.model??`mock/${strategy}`;
 if(model!==`mock/${strategy}`)throw Object.assign(new Error('Mock model must match the selected strategy'),{status:400,code:'INVALID_AGENT_MODEL'});
 const personality=value.personality??'Compete using observable state and the selected strategy.';
 if(typeof personality!=='string'||personality.trim().length>240)throw Object.assign(new Error('Personality must be 240 characters or fewer'),{status:400,code:'INVALID_AGENT_PERSONALITY'});
 const requested=value.capabilities??['games'];
 if(!Array.isArray(requested)||requested.length>3||new Set(requested).size!==requested.length||requested.some(capability=>!capabilities.has(capability)))throw Object.assign(new Error('Capabilities may contain only compute, tools, and games'),{status:400,code:'INVALID_AGENT_CAPABILITIES'});
 return {name,avatar,strategy,personality:personality.trim(),provider:'mock',model,capabilities:requested};
}
function validateState(state){
 if(state?.format!==1||!Array.isArray(state.owners)||!Array.isArray(state.agents)||!Array.isArray(state.operations)||state.owners.length>10_000||state.agents.length>100_000||state.operations.length>MAX_IDEMPOTENCY_RECORDS)throw new Error('Invalid ownership store format or capacity');
 const owners=new Set(),wallets=new Set(),anonymousKeys=new Set(),agents=new Set(),agentOwners=new Map(),receipts=new Set(),receiptOwners=new Map();
 for(const owner of state.owners){
  if(!/^[a-f0-9-]{36}$/.test(owner.id)||owners.has(owner.id)||!['anonymous','solana'].includes(owner.identity_type)||typeof owner.created_at!=='string'||!Number.isSafeInteger(owner.session_version)||owner.session_version<0)throw new Error('Invalid owner record');
  owners.add(owner.id);
  if(owner.identity_type==='solana'&&typeof owner.wallet_public_key!=='string')throw new Error('Wallet owner is missing its public key');
  if(owner.identity_type==='anonymous'&&owner.wallet_public_key!==null&&owner.wallet_public_key!==undefined)throw new Error('Anonymous owner cannot have a wallet key');
  if(owner.anonymous_key_hash!==undefined){if(owner.identity_type!=='anonymous'||typeof owner.anonymous_key_hash!=='string'||!/^[a-f0-9]{64}$/.test(owner.anonymous_key_hash)||anonymousKeys.has(owner.anonymous_key_hash))throw new Error('Invalid or duplicate anonymous creation key');anonymousKeys.add(owner.anonymous_key_hash);}
  if(owner.wallet_public_key!==null&&owner.wallet_public_key!==undefined){if(typeof owner.wallet_public_key!=='string'||wallets.has(owner.wallet_public_key))throw new Error('Invalid or duplicate owner wallet');decodeSolanaAddress(owner.wallet_public_key);wallets.add(owner.wallet_public_key);}
 }
 for(const agent of state.agents){
  if(!/^u-[a-f0-9-]{36}$/.test(agent.id)||agents.has(agent.id)||!owners.has(agent.owner_id)||!strategies.has(agent.strategy)||typeof agent.name!=='string'||!agent.name.trim()||agent.name.length>28||typeof agent.avatar!=='string'||!/^[-_a-z0-9]{1,40}$/.test(agent.avatar)||typeof agent.personality!=='string'||agent.personality.length>240||agent.provider!=='mock'||agent.model!==`mock/${agent.strategy}`||!Array.isArray(agent.capabilities)||agent.capabilities.length>3||new Set(agent.capabilities).size!==agent.capabilities.length||agent.capabilities.some(capability=>!capabilities.has(capability)))throw new Error('Invalid owned agent record');
  const treasury=agent.treasury,policy=treasury?.spending_policy;
  if(!treasury||!['none','mock'].includes(treasury.network)||!['NONE','MOCK_CREDIT'].includes(treasury.currency)||typeof treasury.available_base_units!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(treasury.available_base_units)||typeof treasury.reserved_base_units!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(treasury.reserved_base_units)||!Array.isArray(treasury.receipts)||treasury.receipts.length>100_000||!['read_only','manual'].includes(policy?.mode)||typeof policy.max_per_action!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(policy.max_per_action)||typeof policy.max_per_day!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(policy.max_per_day)||!Array.isArray(policy.allowed_capabilities)||policy.allowed_capabilities.length>3||new Set(policy.allowed_capabilities).size!==policy.allowed_capabilities.length||policy.allowed_capabilities.some(capability=>!capabilities.has(capability)))throw new Error('Invalid agent treasury record');
  if(treasury.network==='none'&&(treasury.currency!=='NONE'||treasury.available_base_units!=='0'||treasury.reserved_base_units!=='0'||treasury.receipts.length))throw new Error('Unfunded treasury has inconsistent accounting');
  if(treasury.network==='mock'&&treasury.currency!=='MOCK_CREDIT')throw new Error('Mock treasury has invalid currency');
  if(policy.mode==='read_only'&&policy.allowed_capabilities.length)throw new Error('Read-only treasury permits a capability');
  if(policy.mode==='manual'&&(BigInt(policy.max_per_action)!==0n||BigInt(policy.max_per_day)!==0n||policy.allowed_capabilities.length))throw new Error('Manual treasury has an automated spending limit');
  let receiptTotal=0n;
  for(const receipt of treasury.receipts){
   if(typeof receipt.id!=='string'||receipts.has(receipt.id)||receipt.agent_id!==agent.id||receipt.owner_id!==agent.owner_id||receipt.network!=='mock'||receipt.currency!=='MOCK_CREDIT'||receipt.status!=='simulated'||typeof receipt.amount!=='string'||!/^[1-9][0-9]*$/.test(receipt.amount)||receipt.capability!=='mock_funding'||typeof receipt.created_at!=='string'||Number.isNaN(Date.parse(receipt.created_at)))throw new Error('Invalid agent treasury receipt');
   receipts.add(receipt.id);receiptOwners.set(receipt.id,{agent_id:agent.id,owner_id:agent.owner_id});receiptTotal+=BigInt(receipt.amount);
  }
  if(treasury.network==='mock'&&receiptTotal!==BigInt(treasury.available_base_units))throw new Error('Mock treasury balance does not match its receipts');
  agents.add(agent.id);agentOwners.set(agent.id,agent.owner_id);
 }
 const operationKeys=new Set();
 for(const operation of state.operations){
  const receiptOwner=operation.receipt_id===undefined?null:receiptOwners.get(operation.receipt_id);
  if(!/^[a-f0-9]{64}$/.test(operation.key)||operationKeys.has(operation.key)||!owners.has(operation.owner_id)||!['create','import','mock_fund'].includes(operation.kind)||!/^[a-f0-9]{64}$/.test(operation.request_hash)||!agents.has(operation.agent_id)||agentOwners.get(operation.agent_id)!==operation.owner_id||typeof operation.created_at!=='string'||Number.isNaN(Date.parse(operation.created_at))||(operation.kind==='mock_fund'?(receiptOwner?.agent_id!==operation.agent_id||receiptOwner?.owner_id!==operation.owner_id):operation.receipt_id!==undefined))throw new Error('Invalid agent operation idempotency record');
  operationKeys.add(operation.key);
 }
}

/** Single-process durable owner/agent registry. It stores no keys or provider credentials. */
export class OwnershipStore{
 constructor(directory,{now=Date.now,syncFolder=syncDirectory,maxBytes=MAX_STORE_BYTES}={}){if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_STORE_BYTES)throw new Error('Ownership store size limit must be between 1 byte and 16 MiB');this.directory=directory;this.file=path.join(directory,'state.json');this.now=now;this.syncFolder=syncFolder;this.maxBytes=maxBytes;this.state={format:1,owners:[],agents:[],operations:[]};this.pending=Promise.resolve();this.ready=false;}
 async init(){
  await mkdir(this.directory,{recursive:true});
  try{
   const handle=await open(this.file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
   try{
    const metadata=await handle.stat();
    if(!metadata.isFile())throw new Error('Ownership registry must be a regular file.');
    if(metadata.size>this.maxBytes)throw storeCapacityError(this.maxBytes);
    if(process.platform!=='win32'&&metadata.mode&0o077)throw new Error('Ownership registry must have private file permissions.');
    const buffer=Buffer.alloc(this.maxBytes+1);let length=0;
    while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,length);if(result.bytesRead===0)break;length+=result.bytesRead;}
    if(length>this.maxBytes)throw storeCapacityError(this.maxBytes);
    this.state=JSON.parse(buffer.subarray(0,length).toString('utf8'));
   }finally{await handle.close();}
  }catch(error){if(error.code!=='ENOENT')throw error;await this.write(this.state);}
  if(this.state?.format===1&&this.state.operations===undefined)this.state.operations=[];
  if(this.state?.format===1&&Array.isArray(this.state.owners))for(const owner of this.state.owners)if(owner.session_version===undefined)owner.session_version=0;
  validateState(this.state);this.ready=true;
 }
 requireReady(){if(!this.ready)throw new Error('Ownership store is not initialized');}
 write(state){
  const serialized=JSON.stringify(state);if(Buffer.byteLength(serialized)>this.maxBytes)throw storeCapacityError(this.maxBytes);
  const temp=`${this.file}.${randomUUID()}.tmp`;
  return (async()=>{try{const handle=await open(temp,'wx',0o600);try{await handle.writeFile(serialized);await handle.sync();}finally{await handle.close();}await rename(temp,this.file);this.state=state;await this.syncFolder(this.directory);}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}})();
 }
 mutate(fn){
  this.requireReady();
  const operation=this.pending.then(async()=>{const next=structuredClone(this.state),result=fn(next);validateState(next);await this.write(next);this.state=next;return structuredClone(result);});
  this.pending=operation.catch(()=>{});return operation;
 }
 owner(id){this.requireReady();const value=this.state.owners.find(owner=>owner.id===id);return value?structuredClone(value):null;}
 ownerByWallet(publicKey){this.requireReady();const value=this.state.owners.find(owner=>owner.wallet_public_key===publicKey);return value?structuredClone(value):null;}
 async createAnonymous(idempotencyKey){
  if(typeof idempotencyKey!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(idempotencyKey))throw Object.assign(new Error('A UUID v4 Idempotency-Key is required'),{status:400,code:'IDEMPOTENCY_KEY_REQUIRED'});
  const keyHash=sha256(idempotencyKey);
  return this.mutate(state=>{
   const existing=state.owners.find(owner=>owner.anonymous_key_hash===keyHash);if(existing)return cleanOwner(existing);
   if(state.owners.length>=10_000)throw Object.assign(new Error('Owner capacity reached'),{status:429,code:'OWNER_CAPACITY'});
   const owner={id:randomUUID(),created_at:new Date(this.now()).toISOString(),identity_type:'anonymous',wallet_public_key:null,session_version:0,anonymous_key_hash:keyHash};state.owners.push(owner);return cleanOwner(owner);
  });
 }
 async createWalletOwner(publicKey){return this.mutate(state=>{
  try{decodeSolanaAddress(publicKey);}catch{throw Object.assign(new Error('Invalid Solana wallet address'),{status:400,code:'INVALID_WALLET_ADDRESS'});}
  const existing=state.owners.find(owner=>owner.wallet_public_key===publicKey);if(existing)return cleanOwner(existing);
  if(state.owners.length>=10_000)throw Object.assign(new Error('Owner capacity reached'),{status:429,code:'OWNER_CAPACITY'});
  const owner={id:randomUUID(),created_at:new Date(this.now()).toISOString(),identity_type:'solana',wallet_public_key:publicKey,session_version:0};state.owners.push(owner);return cleanOwner(owner);
 });}
 async linkWalletOwner(ownerId,publicKey){return this.mutate(state=>{
  try{decodeSolanaAddress(publicKey);}catch{throw Object.assign(new Error('Invalid Solana wallet address'),{status:400,code:'INVALID_WALLET_ADDRESS'});}
  const owner=state.owners.find(value=>value.id===ownerId);if(!owner)throw Object.assign(new Error('Owner profile not found'),{status:401,code:'OWNER_NOT_FOUND'});
  const linked=state.owners.find(value=>value.wallet_public_key===publicKey);
  if(linked&&linked.id!==owner.id)throw Object.assign(new Error('This wallet already belongs to another profile. Sign out and connect that profile directly; accounts are not merged automatically.'),{status:409,code:'WALLET_ALREADY_OWNED'});
  if(owner.identity_type==='solana'&&owner.wallet_public_key!==publicKey)throw Object.assign(new Error('A different wallet is already linked to this profile.'),{status:409,code:'OWNER_WALLET_ALREADY_LINKED'});
  if(owner.identity_type!=='solana'){if(owner.session_version===Number.MAX_SAFE_INTEGER)throw Object.assign(new Error('Owner session version capacity reached'),{status:409,code:'OWNER_SESSION_VERSION_CAPACITY'});owner.session_version++;}
  owner.identity_type='solana';owner.wallet_public_key=publicKey;delete owner.anonymous_key_hash;return cleanOwner(owner);
 });}
 async revokeSessions(ownerId,expectedVersion){return this.mutate(state=>{const owner=state.owners.find(value=>value.id===ownerId);if(!owner||owner.session_version!==expectedVersion)return false;if(owner.session_version===Number.MAX_SAFE_INTEGER)throw Object.assign(new Error('Owner session version capacity reached'),{status:409,code:'OWNER_SESSION_VERSION_CAPACITY'});owner.session_version++;return true;});}
 agentsForOwner(ownerId){this.requireReady();return this.state.agents.filter(agent=>agent.owner_id===ownerId).map(agent=>this.privateSummary(agent));}
 listPublicAgents({after=null,limit=50}={}){
  this.requireReady();
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Agent directory page size must be from 1 to 100'),{status:400,code:'INVALID_PAGE_SIZE'});
  let start=0;
  if(after!==null){
   if(typeof after!=='string'||!/^u-[a-f0-9-]{36}$/.test(after))throw Object.assign(new Error('Invalid agent directory cursor'),{status:400,code:'INVALID_AGENT_CURSOR'});
   const index=this.state.agents.findIndex(agent=>agent.id===after);if(index<0)throw Object.assign(new Error('Agent directory cursor was not found'),{status:400,code:'INVALID_AGENT_CURSOR'});start=index+1;
  }
  const owners=new Map(this.state.owners.map(owner=>[owner.id,owner]));
  const page=this.state.agents.slice(start,start+limit+1),hasMore=page.length>limit,agents=page.slice(0,limit).map(agent=>this.publicSummary(agent,owners));
  return {agents,next_cursor:hasMore?agents.at(-1).id:null};
 }
 recentPublicAgents(limit=100){
  this.requireReady();if(!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Recent agent page size must be from 1 to 100'),{status:400,code:'INVALID_PAGE_SIZE'});
  const owners=new Map(this.state.owners.map(owner=>[owner.id,owner]));
  return this.state.agents.slice(-limit).reverse().map(agent=>this.publicSummary(agent,owners));
 }
 publicSummary(agent,owners=new Map(this.state.owners.map(owner=>[owner.id,owner]))){
  const wallet=owners.get(agent.owner_id)?.wallet_public_key||null;
  return {id:agent.id,name:agent.name,avatar:agent.avatar,strategy:agent.strategy,personality:agent.personality,provider:agent.provider,model:agent.model,ownership_status:'user',owner_wallet:wallet?`${wallet.slice(0,4)}…${wallet.slice(-4)}`:null,current_activity:'idle',matches:0,wins:0,research:[]};
 }
 agentExists(ownerId,id){this.requireReady();return this.state.agents.some(value=>value.id===id&&value.owner_id===ownerId);}
 agentSummaryForOwner(ownerId,id){this.requireReady();const agent=this.state.agents.find(value=>value.id===id&&value.owner_id===ownerId);return agent?this.privateSummary(agent):null;}
 privateSummary(agent){const treasury=agent.treasury;return {...structuredClone({...agent,treasury:undefined}),treasury:{...structuredClone({...treasury,receipts:undefined}),receipt_count:treasury.receipts.length,receipts:structuredClone(treasury.receipts.slice(-3))}};}
 transactionsForOwner(ownerId,id,{before=null,limit=50}={}){
  this.requireReady();if(!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(new Error('Transaction page size must be from 1 to 100'),{status:400,code:'INVALID_PAGE_SIZE'});
  const agent=this.state.agents.find(value=>value.id===id&&value.owner_id===ownerId);if(!agent)return null;
  let end=agent.treasury.receipts.length;
  if(before!==null){if(typeof before!=='string'||before.length>64)throw Object.assign(new Error('Invalid transaction cursor'),{status:400,code:'INVALID_TRANSACTION_CURSOR'});end=agent.treasury.receipts.findIndex(receipt=>receipt.id===before);if(end<0)throw Object.assign(new Error('Transaction cursor was not found'),{status:400,code:'INVALID_TRANSACTION_CURSOR'});}
  const start=Math.max(0,end-limit),receipts=agent.treasury.receipts.slice(start,end).reverse().map(receipt=>structuredClone(receipt));
  return {transactions:receipts,next_cursor:start>0?receipts.at(-1).id:null};
 }
 publicAgent(id){
  this.requireReady();const agent=this.state.agents.find(value=>value.id===id);if(!agent)return null;
  const wallet=this.state.owners.find(value=>value.id===agent.owner_id)?.wallet_public_key||null;
  return {id:agent.id,name:agent.name,avatar:agent.avatar,strategy:agent.strategy,personality:agent.personality,provider:agent.provider,model:agent.model,ownership_status:'user',owner_wallet:wallet?`${wallet.slice(0,4)}…${wallet.slice(-4)}`:null,current_activity:'idle',matches:0,wins:0,research:[]};
 }
 async createAgent(ownerId,input,approvedAvatars,{importing=false,idempotencyKey}={}){
  const config=validateAgentInput(input,approvedAvatars,{importing});
  if(typeof idempotencyKey!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(idempotencyKey))throw Object.assign(new Error('A UUID v4 Idempotency-Key is required'),{status:400,code:'IDEMPOTENCY_KEY_REQUIRED'});
  const kind=importing?'import':'create',operationKey=sha256(`${ownerId}\0${kind}\0${idempotencyKey}`),requestHash=sha256(JSON.stringify({kind,config}));
  return this.mutate(state=>{
   const now=this.now();
   if(!state.owners.some(owner=>owner.id===ownerId))throw Object.assign(new Error('Owner profile not found'),{status:401,code:'OWNER_NOT_FOUND'});
   const previous=state.operations.find(operation=>operation.key===operationKey);
   if(previous){if(previous.request_hash!==requestHash)throw Object.assign(new Error('Idempotency key was already used with another agent configuration'),{status:409,code:'IDEMPOTENCY_KEY_REUSED'});const priorAgent=state.agents.find(agent=>agent.id===previous.agent_id&&agent.owner_id===ownerId);if(!priorAgent)throw new Error('Agent creation idempotency record is inconsistent');return priorAgent;}
   if(state.agents.filter(agent=>agent.owner_id===ownerId).length>=100)throw Object.assign(new Error('Agent limit reached for this owner'),{status:429,code:'AGENT_LIMIT'});
   if(state.agents.length>=100_000)throw Object.assign(new Error('Agent registry capacity reached'),{status:503,code:'AGENT_STORE_CAPACITY'});
   if(state.operations.length>=MAX_IDEMPOTENCY_RECORDS)throw Object.assign(new Error('Agent creation retry capacity reached; try again later'),{status:503,code:'IDEMPOTENCY_STORE_CAPACITY'});
   const id=`u-${randomUUID()}`;
   const createdAt=new Date(now).toISOString(),agent={id,owner_id:ownerId,...config,created_at:createdAt,ownership_status:'user',treasury:{network:'none',currency:'NONE',available_base_units:'0',reserved_base_units:'0',spending_policy:{mode:'read_only',max_per_action:'0',max_per_day:'0',allowed_capabilities:[]},receipts:[]}};
   state.agents.push(agent);state.operations.push({key:operationKey,owner_id:ownerId,kind,request_hash:requestHash,agent_id:id,created_at:createdAt});return agent;
  });
 }
 async mockFund(ownerId,id,units,{idempotencyKey}={}){
  if(!Number.isSafeInteger(units)||units<1||units>1_000_000)throw Object.assign(new Error('Mock funding must be 1–1,000,000 test credits'),{status:400,code:'INVALID_MOCK_AMOUNT'});
  if(typeof idempotencyKey!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(idempotencyKey))throw Object.assign(new Error('A UUID v4 Idempotency-Key is required'),{status:400,code:'IDEMPOTENCY_KEY_REQUIRED'});
  const kind='mock_fund',operationKey=sha256(`${ownerId}\0${kind}\0${idempotencyKey}`),requestHash=sha256(JSON.stringify({kind,agent_id:id,units}));
  return this.mutate(state=>{
   const now=this.now();
   const agent=state.agents.find(value=>value.id===id&&value.owner_id===ownerId);if(!agent)throw Object.assign(new Error('Agent not found'),{status:404,code:'AGENT_NOT_FOUND'});
   const previous=state.operations.find(operation=>operation.key===operationKey);
   if(previous){if(previous.request_hash!==requestHash)throw Object.assign(new Error('Idempotency key was already used for another funding request'),{status:409,code:'IDEMPOTENCY_KEY_REUSED'});const receipt=agent.treasury.receipts.find(value=>value.id===previous.receipt_id);if(!receipt)throw new Error('Mock funding idempotency record is inconsistent');return {treasury:agent.treasury,receipt};}
   if(state.operations.length>=MAX_IDEMPOTENCY_RECORDS)throw Object.assign(new Error('Funding retry capacity reached; try again later'),{status:503,code:'IDEMPOTENCY_STORE_CAPACITY'});
   if(agent.treasury.receipts.length>=100_000)throw Object.assign(new Error('Agent receipt capacity reached'),{status:503,code:'AGENT_RECEIPT_CAPACITY'});
   const treasury=agent.treasury,balance=BigInt(treasury.available_base_units)+BigInt(units);if(balance>BigInt(Number.MAX_SAFE_INTEGER))throw Object.assign(new Error('Mock balance limit reached'),{status:409,code:'BALANCE_LIMIT'});
   treasury.network='mock';treasury.currency='MOCK_CREDIT';treasury.available_base_units=balance.toString();
   const createdAt=new Date(now).toISOString(),receipt={id:`mock-${randomUUID()}`,agent_id:id,owner_id:ownerId,capability:'mock_funding',amount:String(units),currency:'MOCK_CREDIT',network:'mock',transaction_reference:null,status:'simulated',created_at:createdAt};
   treasury.receipts.push(receipt);state.operations.push({key:operationKey,owner_id:ownerId,kind,request_hash:requestHash,agent_id:id,receipt_id:receipt.id,created_at:createdAt});return {treasury,receipt};
  });
 }
 async setSpendingPolicy(ownerId,id,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['mode','allowed_capabilities','max_per_action','max_per_day'].includes(key)))throw Object.assign(new Error('Invalid spending policy'),{status:400,code:'INVALID_SPENDING_POLICY'});
  const mode=input.mode;
  if(!['read_only','manual'].includes(mode))throw Object.assign(new Error('Budgeted/autonomous spending is not implemented; use read_only or manual'),{status:409,code:'AGENT_SPENDING_NOT_IMPLEMENTED'});
  const allowed=input.allowed_capabilities??[];
  if(!Array.isArray(allowed)||allowed.length>3||new Set(allowed).size!==allowed.length||allowed.some(capability=>!capabilities.has(capability)))throw Object.assign(new Error('Unknown spending capability'),{status:400,code:'INVALID_SPENDING_CAPABILITY'});
  if(mode==='read_only'&&allowed.length)throw Object.assign(new Error('Read-only policy cannot allow spending capabilities'),{status:400,code:'READ_ONLY_CAPABILITIES'});
  const maxPerAction=input.max_per_action??'0',maxPerDay=input.max_per_day??'0';
  if(![maxPerAction,maxPerDay].every(value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)))throw Object.assign(new Error('Spending limits must be nonnegative integer base-unit strings'),{status:400,code:'INVALID_SPENDING_LIMIT'});
  if(mode==='manual'&&(BigInt(maxPerAction)!==0n||BigInt(maxPerDay)!==0n||allowed.length))throw Object.assign(new Error('Manual policy requires owner approval for each future action and does not enable automated spending'),{status:400,code:'MANUAL_APPROVAL_REQUIRED'});
  return this.mutate(state=>{const agent=state.agents.find(value=>value.id===id&&value.owner_id===ownerId);if(!agent)throw Object.assign(new Error('Agent not found'),{status:404,code:'AGENT_NOT_FOUND'});agent.treasury.spending_policy={mode,max_per_action:maxPerAction,max_per_day:maxPerDay,allowed_capabilities:allowed};return agent.treasury.spending_policy;});
 }
 exportAgent(ownerId,id){this.requireReady();const agent=this.state.agents.find(value=>value.id===id&&value.owner_id===ownerId);if(!agent)return null;return {format:'aae-agent-v1',name:agent.name,avatar:agent.avatar,strategy:agent.strategy,personality:agent.personality,provider:agent.provider,model:agent.model,capabilities:[...agent.capabilities]};}
}
