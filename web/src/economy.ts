/** Public Rust economy projection; amounts stay decimal strings, never floating-point SOL. */
export type EconomyState='unfunded'|'funding'|'funded'|'locked'|'running'|'settlement_pending'|'settled'|'refund_pending'|'refunded'|'failed';
export interface MatchEconomy {
 match_id:string;simulation_start_id:string;payment_mode:'mock'|'local'|'devnet';entry_amount:string;
 required_agents:string[];funded_agents:string[];pot_amount:string;state:EconomyState;
 settlement_status:'not_started'|'pending'|'completed'|'refunded';
}
export type EconomyKind=
 | {type:'FundingOpened'|'FundingCompleted'|'FundsLocked'|'EconomyRunning'}
 | {type:'EntryRequested';agent_id:string;amount:string}
 | {type:'EntryReceived';agent_id:string;amount:string;receipt_id:string}
 | {type:'EntryRejected';agent_id:string;error:{code:string;detail?:string}}
 | {type:'PotUpdated';amount:string}
 | {type:'SettlementStarted';winner:string}
 | {type:'SettlementCompleted';winner:string;amount:string;receipt_id:string}
 | {type:'RefundStarted';reason:string}
 | {type:'RefundCompleted';amount:string}
 | {type:'EconomyFailed';error:{code:string;detail?:string}};
export type EconomyEvent=EconomyKind&{schema_version:1;seq:number;match_id:string;projection:MatchEconomy};
export interface EconomyView {match:MatchEconomy;sequence:number;payments:Record<string,'pending'|'received'|'rejected'>}
const states=new Set(['unfunded','funding','funded','locked','running','settlement_pending','settled','refund_pending','refunded','failed']);
const kinds=new Set(['FundingOpened','EntryRequested','EntryReceived','EntryRejected','PotUpdated','FundingCompleted','FundsLocked','EconomyRunning','SettlementStarted','SettlementCompleted','RefundStarted','RefundCompleted','EconomyFailed']);
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const amount=(x:unknown):x is string=>typeof x==='string'&&/^(0|[1-9]\d{0,19})$/.test(x)&&BigInt(x)<=18446744073709551615n;
/** Reject malformed transport data before it reaches a renderer. No rules or balance calculations here. */
export function parseEconomyEvent(value:unknown):EconomyEvent {
 if(!value||typeof value!=='object')throw Error('Invalid economy event');
 const e=value as Record<string,unknown>,p=e.projection as Partial<MatchEconomy>|undefined;
 if(e.schema_version!==1||!Number.isSafeInteger(e.seq)||Number(e.seq)<1||!id(e.match_id)||!kinds.has(String(e.type))||!p||p.match_id!==e.match_id||typeof p.simulation_start_id!=='string'||!['mock','local','devnet'].includes(String(p.payment_mode))||!states.has(String(p.state))||!['not_started','pending','completed','refunded'].includes(String(p.settlement_status))||!amount(p.pot_amount)||!amount(p.entry_amount)||!Array.isArray(p.required_agents)||p.required_agents.length<2||p.required_agents.length>20||!p.required_agents.every(id)||new Set(p.required_agents).size!==p.required_agents.length||!Array.isArray(p.funded_agents)||new Set(p.funded_agents).size!==p.funded_agents.length||!p.funded_agents.every(a=>p.required_agents!.includes(a)))throw Error('Invalid economy projection');
 if('agent_id' in e&&(!id(e.agent_id)||!p.required_agents.includes(e.agent_id)))throw Error('Unknown payment agent');
 if('winner' in e&&(!id(e.winner)||!p.required_agents.includes(e.winner)))throw Error('Unknown settlement winner');
 if(['EntryRequested','EntryReceived','EntryRejected'].includes(String(e.type))&&!id(e.agent_id))throw Error('Missing payment agent');
 if(['SettlementStarted','SettlementCompleted'].includes(String(e.type))&&!id(e.winner))throw Error('Missing winner');
 if(['EntryRequested','EntryReceived','PotUpdated','SettlementCompleted','RefundCompleted'].includes(String(e.type))&&!amount(e.amount))throw Error('Invalid amount');
 if(['EntryReceived','SettlementCompleted'].includes(String(e.type))&&!id(e.receipt_id))throw Error('Invalid receipt');
 if(['EntryRejected','EconomyFailed'].includes(String(e.type))&&(!e.error||typeof e.error!=='object'||typeof (e.error as {code?:unknown}).code!=='string'))throw Error('Invalid error');
 if(e.type==='RefundStarted'&&typeof e.reason!=='string')throw Error('Invalid refund reason');
 return structuredClone(value) as EconomyEvent;
}
/** Ordered stream projection. Duplicates are harmless; gaps require fetching a full snapshot. */
export function reduceEconomy(previous:EconomyView|null,raw:unknown):EconomyView {
 const e=parseEconomyEvent(raw);
 if(previous&&previous.match.match_id!==e.match_id)throw Error('Different economy instance; reset first');
 if(previous&&e.seq<=previous.sequence)return previous;
 if(e.seq!==(previous?.sequence??0)+1)throw Error('Economy event gap; reload snapshot');
 const payments={...previous?.payments};
 if(e.type==='EntryRequested')payments[e.agent_id]='pending';
 if(e.type==='EntryReceived')payments[e.agent_id]='received';
 if(e.type==='EntryRejected')payments[e.agent_id]='rejected';
 return {match:e.projection,sequence:e.seq,payments};
}
