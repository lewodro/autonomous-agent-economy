import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ROLES = ['guard', 'prisoner', 'informant', 'smuggler', 'mechanic', 'medic'];
const PUBLIC_ROLES = new Set(['guard', 'prisoner']);
const ITEMS = ['food', 'scrap', 'wire', 'medkit', 'contraband', 'credits'];
const WIDTH = 20, HEIGHT = 14;
const SPAWNS = [{x:2,y:2},{x:5,y:2},{x:8,y:2},{x:12,y:2},{x:16,y:2},{x:3,y:10},{x:9,y:10},{x:15,y:10}];
const NAMES = ['Founder','Analyst','Trader','Defender','Strategist','Gambler','Explorer','Wildcard'];
const PERSONALITIES = ['systems','observant','social','cautious','planning','risk','curious','chaotic'];

function fail(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function clone(value) { return structuredClone(value); }
function emptyState(roundSeconds) { return {version:1, id:'public-compound', phase:'lobby', round:0, revision:0, startedAt:null, endsAt:null, roundSeconds, participants:[], events:[], results:[], updatedAt:Date.now()}; }
function validName(value) { return typeof value === 'string' && /^[a-zA-Z0-9 _-]{2,24}$/.test(value); }
function publicRole(role) { return PUBLIC_ROLES.has(role) ? role : 'prisoner'; }

export const COMPOUND_MAP = Object.freeze({width:WIDTH,height:HEIGHT,rooms:[
  {id:'cell-block',label:'Cell Block',x:1,y:1,w:7,h:5,restricted:false},
  {id:'cafeteria',label:'Cafeteria',x:9,y:1,w:5,h:4,restricted:false},
  {id:'security',label:'Security',x:16,y:1,w:3,h:4,restricted:true},
  {id:'yard',label:'Yard',x:1,y:8,w:7,h:4,restricted:false},
  {id:'workshop',label:'Workshop',x:9,y:6,w:5,h:5,restricted:false},
  {id:'infirmary',label:'Infirmary',x:16,y:6,w:3,h:3,restricted:false},
  {id:'storage',label:'Storage',x:16,y:10,w:3,h:2,restricted:true},
  {id:'utility-exit',label:'Utility Exit',x:9,y:12,w:3,h:1,restricted:true},
  {id:'visitation',label:'Visitation',x:1,y:13,w:6,h:1,restricted:false},
]});

function roomAt(position) { return COMPOUND_MAP.rooms.find(room => position.x >= room.x && position.x < room.x + room.w && position.y >= room.y && position.y < room.y + room.h); }
function roleFor(index, count) {
  if (index < Math.min(2, Math.max(1, Math.floor(count / 4)))) return 'guard';
  const specials = ['informant','smuggler','mechanic','medic'];
  return specials[(index - 2) % specials.length] || 'prisoner';
}

export class CompoundGame {
  constructor(directory, { profiles = () => [], roundSeconds = Number(process.env.COMPOUND_ROUND_SECONDS || 120), now = () => Date.now() } = {}) {
    this.directory = directory; this.file = path.join(directory, 'compound.json'); this.roundSeconds = Math.max(15, Math.min(1800, Number(roundSeconds) || 120));
    this.now = now; this.state = emptyState(this.roundSeconds); this.tail = Promise.resolve(); this.persistTail = Promise.resolve(); this.timer = null; this.profiles = profiles;
  }
  async restore() {
    await mkdir(this.directory, {recursive:true});
    try { const saved = JSON.parse(await readFile(this.file, 'utf8')); if (saved?.version === 1 && ['lobby','active','finished'].includes(saved.phase) && Array.isArray(saved.participants)) this.state = saved; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (this.state.phase === 'active' && this.state.endsAt <= this.now()) this.finish('timer');
  }
  async save() { const task = this.persistTail.then(async () => { const tmp = `${this.file}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(this.state), {mode:0o600}); await rename(tmp, this.file); }); this.persistTail = task.catch(() => {}); return task; }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick(); }, 1000); this.timer.unref?.(); } }
  async close() { if (this.timer) clearInterval(this.timer); this.timer = null; await this.save(); }
  participant(owner) { return this.state.participants.find(value => value.owner === owner); }
  safeParticipant(value, owner) {
    const room = roomAt(value.position);
    const result = {id:value.id,name:value.name,type:value.type,position:value.position,public_role:publicRole(value.role),room:room?.id || 'yard',heat:value.heat,activity:value.activity,status:value.status,inventory_count:value.inventory.length};
    if (value.owner === owner) Object.assign(result, {role:value.role,inventory:value.inventory,objective:value.objective,memories:value.memories});
    return result;
  }
  snapshot(owner = null) {
    const state = this.state;
    return {id:state.id,phase:state.phase,round:state.round,revision:state.revision,started_at:state.startedAt,ends_at:state.endsAt,map:COMPOUND_MAP,participants:state.participants.map(value => this.safeParticipant(value, owner)),events:state.events.slice(-30),results:state.results.slice(-10),you:owner ? this.participant(owner)?.id || null : null};
  }
  join(owner, input = {}) {
    if (!owner) throw fail('COMPOUND_OWNER_REQUIRED', 'A visitor session is required', 401);
    const existing = this.participant(owner); if (existing) return this.snapshot(owner);
    if (this.state.phase === 'active') throw fail('COMPOUND_ROUND_ACTIVE', 'Join the next round; the current round is already running', 409);
    if (this.state.phase === 'finished') { this.state.participants = this.state.participants.filter(value => value.type === 'human'); this.state.phase = 'lobby'; this.state.startedAt = null; this.state.endsAt = null; }
    if (!validName(input.name || 'Visitor')) throw fail('INVALID_COMPOUND_NAME', 'Name must be 2-24 letters, numbers, spaces, _ or -');
    if (this.state.participants.length >= 8) throw fail('COMPOUND_FULL', 'The compound lobby is full', 409);
    this.state.participants.push({id:`human-${randomUUID()}`,owner,name:input.name || 'Visitor',type:'human',role:'prisoner',position:clone(SPAWNS[this.state.participants.length] || SPAWNS[0]),heat:0,inventory:['food'],objective:'Survive the routine and find a way out.',activity:'Joining the compound',status:'ready',memories:[]});
    this.record(`${input.name || 'Visitor'} joined the compound.`); this.bump(); return this.snapshot(owner);
  }
  fillAgents() {
    const profiles = this.profiles() || [];
    let index = 0;
    while (this.state.participants.length < 8) {
      const profile = profiles[index % Math.max(1, profiles.length)] || {id:`agent-${index}`,name:NAMES[index % NAMES.length],strategy:PERSONALITIES[index % PERSONALITIES.length]};
      const spawn = SPAWNS[this.state.participants.length] || SPAWNS[0];
      this.state.participants.push({id:`agent-${profile.id || index}`,owner:null,name:profile.name || NAMES[index % NAMES.length],type:'agent',role:'prisoner',position:clone(spawn),heat:0,inventory:index % 3 === 0 ? ['scrap'] : ['food'],objective:'Learn the compound and pursue a safe exit.',activity:'Waiting for role assignment',status:'ready',memories:[],personality:profile.strategy || PERSONALITIES[index % PERSONALITIES.length]}); index++;
    }
  }
  startRound(owner, {allowNoOwner = false} = {}) {
    if (this.state.phase === 'finished') { this.state.participants = this.state.participants.filter(value => value.type === 'human'); this.state.phase = 'lobby'; this.state.startedAt = null; this.state.endsAt = null; }
    const member = this.participant(owner); if (!member && !allowNoOwner) throw fail('COMPOUND_NOT_JOINED', 'Join the compound lobby first', 403);
    if (this.state.phase === 'active') return this.snapshot(owner);
    this.fillAgents(); this.state.participants.forEach((value,index) => { value.role = roleFor(index, this.state.participants.length); value.status='active'; value.activity=value.role === 'guard' ? 'Patrolling' : 'Following the routine'; value.objective=value.role==='guard'?'Keep the compound secure until the timer ends.':value.role==='smuggler'?'Move contraband to the utility exit.':value.role==='informant'?'Identify a suspicious escape plan for the guards.':'Find cooperation, tools, and a safe route out.'; });
    const now = this.now(); this.state.phase='active'; this.state.round++; this.state.startedAt=new Date(now).toISOString(); this.state.endsAt=now+this.roundSeconds*1000; this.state.events=[]; this.record(`Round ${this.state.round} started with ${this.state.participants.length} participants.`); this.bump(); return this.snapshot(owner);
  }
  startAgentRound() { return this.startRound(null, {allowNoOwner:true}); }
  move(owner, input = {}) {
    const player = this.participant(owner); if (!player) throw fail('COMPOUND_NOT_JOINED','Join the compound first',403); if (this.state.phase !== 'active') throw fail('COMPOUND_NOT_ACTIVE','The compound round is not active',409);
    const x=Number(input.x),y=Number(input.y); if (!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=WIDTH||y>=HEIGHT) throw fail('INVALID_COMPOUND_POSITION','Position is outside the compound');
    const room=roomAt({x,y}); if (room?.restricted && player.role !== 'guard' && player.role !== 'mechanic') { player.heat=Math.min(100,player.heat+4); player.activity='Restricted area'; }
    player.position={x,y}; player.activity=room?.label || 'Moving through the compound'; this.bump(); return this.snapshot(owner);
  }
  action(owner, input = {}) {
    const player=this.participant(owner); if(!player)throw fail('COMPOUND_NOT_JOINED','Join the compound first',403); if(this.state.phase!=='active')throw fail('COMPOUND_NOT_ACTIVE','The compound round is not active',409);
    const action=String(input.action||'');
    if(action==='work'){player.activity=`Working as ${player.role}`;player.inventory.push('credits');if(player.inventory.length>6)player.inventory.shift();this.record(`${player.name} completed a ${player.role} job.`);}
    else if(action==='talk'){player.activity='Talking';this.record(`${player.name} started a conversation near ${roomAt(player.position)?.label||'the yard'}.`);}
    else if(action==='trade'){const other=this.state.participants.find(value=>value.id===input.target_id);if(!other||Math.hypot(other.position.x-player.position.x,other.position.y-player.position.y)>2)throw fail('COMPOUND_TOO_FAR','Trade requires a nearby participant');if(!player.inventory.length)throw fail('COMPOUND_NO_ITEM','You have nothing to trade');const item=player.inventory.shift();other.inventory.push(item);player.activity='Trading';this.record(`${player.name} traded an item to ${other.name}.`);}
    else if(action==='pickup'){const item=ITEMS.includes(input.item)?input.item:'scrap';if(player.inventory.length>=6)throw fail('COMPOUND_INVENTORY_FULL','Inventory is full');player.inventory.push(item);player.activity='Searching nearby supplies';this.record(`${player.name} found ${item}.`);}
    else if(action==='drop'){const index=player.inventory.indexOf(input.item);if(index<0)throw fail('COMPOUND_ITEM_MISSING','That item is not in your inventory');player.inventory.splice(index,1);player.activity='Hiding an item';this.record(`${player.name} dropped an item.`);}
    else if(action==='report'){const target=this.state.participants.find(value=>value.id===input.target_id);if(!target)throw fail('COMPOUND_TARGET_MISSING','That participant is not present');if(player.role!=='guard'&&player.role!=='informant')throw fail('COMPOUND_ROLE_FORBIDDEN','Only guards and informants can file a report');target.heat=Math.min(100,target.heat+15);this.record(`${player.name} filed a report.`);}
    else if(action==='escape'){const room=roomAt(player.position);if(room?.id!=='utility-exit')throw fail('COMPOUND_ESCAPE_LOCATION','Reach the utility exit first');const hasTool=player.inventory.includes('scrap')||player.inventory.includes('wire');if(!hasTool)throw fail('COMPOUND_ESCAPE_NEEDS_TOOL','A tool is required for this exit');player.status='escaped';player.activity='Escaped through the utility route';this.record(`${player.name} escaped through the utility route.`);}
    else if(action==='attack'){const target=this.state.participants.find(value=>value.id===input.target_id);if(!target||Math.hypot(target.position.x-player.position.x,target.position.y-player.position.y)>1)throw fail('COMPOUND_TOO_FAR','Attack requires a nearby participant');target.heat=Math.min(100,target.heat+25);target.status='knocked_out';target.position={x:17,y:7};target.activity='Recovering in the infirmary';this.record(`${player.name} knocked out ${target.name}.`);}
    else throw fail('COMPOUND_ACTION_INVALID','Unsupported compound action');
    this.bump(); return this.snapshot(owner);
  }
  leave(owner) { const index=this.state.participants.findIndex(value=>value.owner===owner);if(index<0)return this.snapshot(owner);this.state.participants.splice(index,1);this.record('A visitor left the compound lobby.');if(this.state.phase==='lobby')this.bump();return this.snapshot(owner); }
  record(message) { this.state.events.push({at:new Date(this.now()).toISOString(),message});if(this.state.events.length>80)this.state.events.shift(); }
  bump(){this.state.revision++;this.state.updatedAt=this.now();void this.save();}
  finish(reason){if(this.state.phase!=='active')return;const escaped=this.state.participants.filter(value=>value.status==='escaped');this.record(`Round ${this.state.round} ended (${reason}). ${escaped.length} escaped.`);this.state.results.push({round:this.state.round,endedAt:new Date(this.now()).toISOString(),reason,escaped:escaped.map(value=>value.name),participants:this.state.participants.map(value=>({name:value.name,type:value.type,public_role:publicRole(value.role),status:value.status}))});if(this.state.results.length>20)this.state.results.shift();this.state.phase='finished';this.state.participants.forEach(value=>{if(value.status==='active'||value.status==='knocked_out')value.status='finished';});this.bump();}
  async tick(){if(this.state.phase!=='active')return;if(this.now()>=this.state.endsAt){this.finish('timer');return;}for(const agent of this.state.participants.filter(value=>value.type==='agent'&&value.status==='active')){const direction=(this.state.round+this.state.revision+agent.id.length)%4;const delta=[[1,0],[-1,0],[0,1],[0,-1]][direction];const next={x:Math.max(0,Math.min(WIDTH-1,agent.position.x+delta[0])),y:Math.max(0,Math.min(HEIGHT-1,agent.position.y+delta[1]))};agent.position=next;agent.activity=agent.role==='guard'?'Patrolling':agent.role==='smuggler'?'Moving contraband':'Working';if(agent.role==='smuggler'&&agent.position.x===9&&agent.position.y===12&&agent.inventory.includes('scrap')){agent.status='escaped';this.record(`${agent.name} escaped through the utility route.`);}}this.bump();}
  health(){return {status:'ok',phase:this.state.phase,round:this.state.round,participants:this.state.participants.length,capacity:8};}
}

export { ROLES };
