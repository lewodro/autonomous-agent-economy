import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';

const VERSION=1;
const NICKNAME=/^[A-Za-z][A-Za-z0-9 _-]{1,23}$/;
const ALPHABET='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Only two remote spots are live at once; the rest unlock slowly. */
const INITIAL_AVAILABLE=2;
const INITIAL_STAGGER_MS=4*60_000;
export const RESOURCE_NODES=Object.freeze([
  {id:'herb-north-1',kind:'herb',zone:'north_grove',rarity:'common',position:{x:300,y:-240},spawn_pool:[{x:300,y:-240},{x:180,y:-280}],reward:1,respawn_ms:18*60_000},
  {id:'ore-west-1',kind:'ore',zone:'west_rocks',rarity:'uncommon',position:{x:-800,y:850},spawn_pool:[{x:-800,y:850},{x:-820,y:770}],reward:2,respawn_ms:30*60_000},
  {id:'herb-garden-1',kind:'herb',zone:'botanical',rarity:'common',position:{x:1400,y:900},spawn_pool:[{x:1400,y:900},{x:1300,y:840}],reward:1,respawn_ms:20*60_000},
  {id:'herb-northeast-1',kind:'herb',zone:'north_ridge',rarity:'common',position:{x:1550,y:-450},spawn_pool:[{x:1550,y:-450},{x:1430,y:-430}],reward:1,respawn_ms:22*60_000},
  {id:'herb-forest-1',kind:'herb',zone:'deep_forest',rarity:'common',position:{x:1800,y:1600},spawn_pool:[{x:1800,y:1600},{x:1680,y:1560}],reward:1,respawn_ms:24*60_000},
  {id:'herb-southwest-1',kind:'herb',zone:'south_meadow',rarity:'common',position:{x:250,y:1600},spawn_pool:[{x:250,y:1600},{x:130,y:1560}],reward:1,respawn_ms:26*60_000},
  {id:'ore-east-1',kind:'ore',zone:'east_industrial',rarity:'uncommon',position:{x:2600,y:300},spawn_pool:[{x:2600,y:300},{x:2480,y:260}],reward:2,respawn_ms:34*60_000},
  {id:'ore-south-1',kind:'ore',zone:'south_perimeter',rarity:'rare',position:{x:2600,y:1600},spawn_pool:[{x:2600,y:1600},{x:2480,y:1560}],reward:4,respawn_ms:45*60_000},
  {id:'ore-perimeter-1',kind:'ore',zone:'remote_perimeter',rarity:'very_rare',position:{x:-800,y:-450},spawn_pool:[{x:-800,y:-450},{x:-800,y:-370}],reward:7,respawn_ms:60*60_000},
]);

function initialNodeState(index,now){return{generation:0,availableAt:index<INITIAL_AVAILABLE?0:now+(index-(INITIAL_AVAILABLE-1))*INITIAL_STAGGER_MS};}

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
    this.state={version:VERSION,profiles:{},nodes:Object.fromEntries(RESOURCE_NODES.map((node,index)=>[node.id,initialNodeState(index,this.now())])),receipts:[]};this.writeQueue=Promise.resolve();
  }
  async restore(){await mkdir(this.directory,{recursive:true});let saved;try{saved=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(saved){if(saved.version!==VERSION||!saved.profiles||!saved.nodes||!Array.isArray(saved.receipts)||saved.receipts.length>20_000)throw new Error('Invalid world economy checkpoint');this.state=saved;for(const [index,node] of RESOURCE_NODES.entries())this.state.nodes[node.id]||=initialNodeState(index,this.now());}return this.snapshot();}
  persist(){const snapshot=structuredClone(this.state);this.writeQueue=this.writeQueue.then(async()=>{const temp=`${this.file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(snapshot),{mode:0o600});await rename(temp,this.file);});return this.writeQueue;}
  profile(owner){const stored=this.state.profiles[owner]||{user_id:publicUserId(owner),nickname:'',wallet_address:null,wallet_link_status:'unlinked',credits:0};return{...stored,auth_mode:'signed_visitor',treasury_address:this.treasuryAddress,payouts_enabled:this.payoutsEnabled};}
  async linkProfile(owner,input={}){const nickname=String(input.nickname||'').trim(),wallet=input.wallet_address==null||input.wallet_address===''?null:String(input.wallet_address).trim();if(!NICKNAME.test(nickname))throw fail('INVALID_NICKNAME','Nickname must be 2-24 letters, numbers, spaces, _ or -');if(wallet&&!validSolanaAddress(wallet))throw fail('INVALID_WALLET','Enter a valid public Solana wallet address');const current=this.profile(owner);this.state.profiles[owner]={user_id:current.user_id,nickname,wallet_address:wallet,wallet_link_status:wallet?'self_declared':'unlinked',credits:current.credits};await this.persist();return this.profile(owner);}
  nodes(){const now=this.now();return RESOURCE_NODES.map(node=>{const runtime=this.state.nodes[node.id]||{generation:0,availableAt:0},available=runtime.availableAt<=now,{spawn_pool,...publicNode}=node;return{...publicNode,position:nodePosition(node,runtime.generation,available),available,available_at:new Date(runtime.availableAt).toISOString()};});}
  snapshot(owner=null){return{mode:'test_credits',nodes:this.nodes(),profile:owner?this.profile(owner):null,treasury:{public_address:this.treasuryAddress,payouts_enabled:this.payoutsEnabled,signing:'external_only'},receipts:owner?this.state.receipts.filter(receipt=>receipt.owner===owner).slice(-20).map(({owner,...receipt})=>receipt):[]};}
  async gather(owner,{node_id}={},position){const node=RESOURCE_NODES.find(value=>value.id===node_id);if(!node)throw fail('RESOURCE_NOT_FOUND','Unknown resource node',404);const runtime=this.state.nodes[node.id],now=this.now();if(runtime.availableAt>now)throw fail('RESOURCE_RESPAWNING','This resource is still respawning',409);const activePosition=nodePosition(node,runtime.generation);if(!position||Math.hypot(position.x-activePosition.x,position.y-activePosition.y)>72)throw fail('RESOURCE_OUT_OF_RANGE','Move closer to gather this resource',409);const generation=runtime.generation+1,idempotency_key=`${node.id}:${generation}`;if(this.state.receipts.some(value=>value.idempotency_key===idempotency_key))throw fail('REWARD_DUPLICATE','This harvest was already rewarded',409);const profile=this.profile(owner);profile.credits+=node.reward;this.state.profiles[owner]={user_id:profile.user_id,nickname:profile.nickname,wallet_address:profile.wallet_address,wallet_link_status:profile.wallet_link_status,credits:profile.credits};runtime.generation=generation;runtime.availableAt=now+(this.respawnMs??node.respawn_ms);const payable=this.payoutsEnabled&&Boolean(profile.wallet_address);const receipt={reward_id:randomUUID(),owner,user_id:profile.user_id,source_action:`gather:${node.kind}`,node_id:node.id,generation,amount_credits:node.reward,timestamp:new Date(now).toISOString(),status:payable?'payable':'test_credited',idempotency_key,...(payable?{wallet_address:profile.wallet_address,treasury_address:this.treasuryAddress,amount_lamports:node.reward*this.lamportsPerCredit,transaction_signature:null}:{})};this.state.receipts.push(receipt);this.state.receipts=this.state.receipts.slice(-20_000);await this.persist();const {owner:discard,...publicReceipt}=receipt,{spawn_pool,...publicNode}=node;return{node:{...publicNode,position:activePosition,available:false,available_at:new Date(runtime.availableAt).toISOString()},profile:this.profile(owner),receipt:publicReceipt};}
  health(){return{status:'ok',nodes:RESOURCE_NODES.length,receipts:this.state.receipts.length,payouts_enabled:this.payoutsEnabled,treasury_configured:Boolean(this.treasuryAddress)};}
  async close(){await this.writeQueue;}
}
