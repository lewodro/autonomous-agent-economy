import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';

const VERSION=1;
const NICKNAME=/^[A-Za-z][A-Za-z0-9 _-]{1,23}$/;
const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const RESOURCE_NODES=Object.freeze([
  {id:'herb-north-1',kind:'herb',zone:'north_grove',rarity:'common',position:{x:300,y:-240},spawn_pool:[{x:300,y:-240},{x:460,y:-330}],reward:1,respawn_ms:35_000},
  {id:'herb-garden-1',kind:'herb',zone:'botanical',rarity:'common',position:{x:1600,y:980},spawn_pool:[{x:1600,y:980},{x:1710,y:1010},{x:2080,y:1030}],reward:1,respawn_ms:40_000},
  {id:'herb-south-1',kind:'herb',zone:'south_meadow',rarity:'common',position:{x:1550,y:1580},spawn_pool:[{x:1550,y:1580},{x:1660,y:1540}],reward:1,respawn_ms:45_000},
  {id:'herb-forest-1',kind:'herb',zone:'outer_forest',rarity:'common',position:{x:2080,y:700},spawn_pool:[{x:2080,y:700},{x:2180,y:880},{x:2420,y:1020}],reward:1,respawn_ms:45_000},
  {id:'ore-west-1',kind:'ore',zone:'west_rocks',rarity:'uncommon',position:{x:-700,y:1200},spawn_pool:[{x:-700,y:1200},{x:-620,y:1320},{x:-520,y:1420}],reward:2,respawn_ms:90_000},
  {id:'herb-deep-1',kind:'herb',zone:'deep_forest',rarity:'uncommon',position:{x:2250,y:620},spawn_pool:[{x:2250,y:620},{x:2380,y:700},{x:2480,y:920}],reward:2,respawn_ms:100_000},
  {id:'ore-north-1',kind:'ore',zone:'north_ridge',rarity:'rare',position:{x:1280,y:-280},spawn_pool:[{x:1280,y:-280},{x:1350,y:-250}],reward:4,respawn_ms:180_000},
  {id:'ore-east-1',kind:'ore',zone:'east_industrial',rarity:'rare',position:{x:2280,y:1320},spawn_pool:[{x:2280,y:1320},{x:2480,y:1500}],reward:4,respawn_ms:210_000},
  {id:'ore-perimeter-1',kind:'ore',zone:'remote_perimeter',rarity:'very_rare',position:{x:-760,y:-420},spawn_pool:[{x:-760,y:-420},{x:2440,y:-360}],reward:7,respawn_ms:360_000},
]);

function nodePosition(node,generation,available=true){const offset=available?generation:Math.max(0,generation-1);return node.spawn_pool[offset%node.spawn_pool.length];}

function fail(code,message,status=400){return Object.assign(new Error(message),{code,status});}
function publicUserId(owner){return `world_${createHash('sha256').update(owner).digest('hex').slice(0,20)}`;}
export function validSolanaAddress(value){
  if(typeof value!=='string'||value.length<32||value.length>44)return false;
  let decoded=0n;for(const char of value){const digit=ALPHABET.indexOf(char);if(digit<0)return false;decoded=decoded*58n+BigInt(digit);}
  let bytes=0;while(decoded>0n){bytes++;decoded>>=8n;}let leading=0;for(const char of value){if(char!=='1')break;leading++;}
  return bytes+leading===32;
}

/** Persistent test-credit ledger. It never signs transactions or stores wallet secrets. */
export class WorldEconomy {
  constructor(directory,{now=()=>Date.now(),respawnMs=null,treasuryAddress=null,payoutsEnabled=false,lamportsPerCredit=0}={}){
    if(respawnMs!==null&&(!Number.isInteger(respawnMs)||respawnMs<5_000||respawnMs>3_600_000))throw new Error('Invalid resource respawn duration');
    if(treasuryAddress&&!validSolanaAddress(treasuryAddress))throw new Error('WORLD_TREASURY_ADDRESS must be a valid public Solana address');
    if(payoutsEnabled&&(!treasuryAddress||!Number.isSafeInteger(lamportsPerCredit)||lamportsPerCredit<1))throw new Error('Real payout receipts require a public treasury and positive lamports-per-credit');
    this.directory=directory;this.file=path.join(directory,'world-economy.json');this.now=now;this.respawnMs=respawnMs;
    this.treasuryAddress=treasuryAddress;this.payoutsEnabled=payoutsEnabled;this.lamportsPerCredit=lamportsPerCredit;
    this.state={version:VERSION,profiles:{},nodes:Object.fromEntries(RESOURCE_NODES.map(node=>[node.id,{generation:0,availableAt:0}])),receipts:[]};this.writeQueue=Promise.resolve();
  }
  async restore(){await mkdir(this.directory,{recursive:true});let saved;try{saved=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(saved){if(saved.version!==VERSION||!saved.profiles||!saved.nodes||!Array.isArray(saved.receipts)||saved.receipts.length>20_000)throw new Error('Invalid world economy checkpoint');this.state=saved;for(const node of RESOURCE_NODES)this.state.nodes[node.id]||={generation:0,availableAt:0};}return this.snapshot();}
  persist(){const snapshot=structuredClone(this.state);this.writeQueue=this.writeQueue.then(async()=>{const temp=`${this.file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(snapshot),{mode:0o600});await rename(temp,this.file);});return this.writeQueue;}
  profile(owner){const stored=this.state.profiles[owner]||{user_id:publicUserId(owner),nickname:'',wallet_address:null,wallet_link_status:'unlinked',credits:0};return{...stored,auth_mode:'signed_visitor',treasury_address:this.treasuryAddress,payouts_enabled:this.payoutsEnabled};}
  async linkProfile(owner,input={}){const nickname=String(input.nickname||'').trim(),wallet=input.wallet_address==null||input.wallet_address===''?null:String(input.wallet_address).trim();if(!NICKNAME.test(nickname))throw fail('INVALID_NICKNAME','Nickname must be 2-24 letters, numbers, spaces, _ or -');if(wallet&&!validSolanaAddress(wallet))throw fail('INVALID_WALLET','Enter a valid public Solana wallet address');const current=this.profile(owner);this.state.profiles[owner]={user_id:current.user_id,nickname,wallet_address:wallet,wallet_link_status:wallet?'self_declared':'unlinked',credits:current.credits};await this.persist();return this.profile(owner);}
  nodes(){const now=this.now();return RESOURCE_NODES.map(node=>{const runtime=this.state.nodes[node.id]||{generation:0,availableAt:0},available=runtime.availableAt<=now,{spawn_pool,...publicNode}=node;return{...publicNode,position:nodePosition(node,runtime.generation,available),available,available_at:new Date(runtime.availableAt).toISOString()};});}
  snapshot(owner=null){return{mode:'test_credits',nodes:this.nodes(),profile:owner?this.profile(owner):null,treasury:{public_address:this.treasuryAddress,payouts_enabled:this.payoutsEnabled,signing:'external_only'},receipts:owner?this.state.receipts.filter(receipt=>receipt.owner===owner).slice(-20).map(({owner,...receipt})=>receipt):[]};}
  async gather(owner,{node_id}={},position){const node=RESOURCE_NODES.find(value=>value.id===node_id);if(!node)throw fail('RESOURCE_NOT_FOUND','Unknown resource node',404);const runtime=this.state.nodes[node.id],now=this.now();if(runtime.availableAt>now)throw fail('RESOURCE_RESPAWNING','This resource is still respawning',409);const activePosition=nodePosition(node,runtime.generation);if(!position||Math.hypot(position.x-activePosition.x,position.y-activePosition.y)>72)throw fail('RESOURCE_OUT_OF_RANGE','Move closer to gather this resource',409);const generation=runtime.generation+1,idempotency_key=`${node.id}:${generation}`;if(this.state.receipts.some(value=>value.idempotency_key===idempotency_key))throw fail('REWARD_DUPLICATE','This harvest was already rewarded',409);const profile=this.profile(owner);profile.credits+=node.reward;this.state.profiles[owner]={user_id:profile.user_id,nickname:profile.nickname,wallet_address:profile.wallet_address,wallet_link_status:profile.wallet_link_status,credits:profile.credits};runtime.generation=generation;runtime.availableAt=now+(this.respawnMs??node.respawn_ms);const payable=this.payoutsEnabled&&Boolean(profile.wallet_address);const receipt={reward_id:randomUUID(),owner,user_id:profile.user_id,source_action:`gather:${node.kind}`,node_id:node.id,generation,amount_credits:node.reward,timestamp:new Date(now).toISOString(),status:payable?'payable':'test_credited',idempotency_key,...(payable?{wallet_address:profile.wallet_address,treasury_address:this.treasuryAddress,amount_lamports:node.reward*this.lamportsPerCredit,transaction_signature:null}:{})};this.state.receipts.push(receipt);this.state.receipts=this.state.receipts.slice(-20_000);await this.persist();const {owner:discard,...publicReceipt}=receipt,{spawn_pool,...publicNode}=node;return{node:{...publicNode,position:activePosition,available:false,available_at:new Date(runtime.availableAt).toISOString()},profile:this.profile(owner),receipt:publicReceipt};}
  health(){return{status:'ok',nodes:RESOURCE_NODES.length,receipts:this.state.receipts.length,payouts_enabled:this.payoutsEnabled,treasury_configured:Boolean(this.treasuryAddress)};}
  async close(){await this.writeQueue;}
}
