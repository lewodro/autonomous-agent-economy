const ID=/^[A-Za-z0-9_-]{1,96}$/;
const MAX_ITEMS=32;
const trim=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const bounded=(items,max=MAX_ITEMS)=>Array.isArray(items)?items.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)).slice(-max).map(value=>structuredClone(value)):[];
function agentId(value){if(typeof value!=='string'||!ID.test(value))throw new Error('Agent mind id is invalid');return value;}
export function createAgentMind({agentId:id,personality='balanced',strategy='balanced',goals=[],shortTerm=[],longTerm=[],opponentNotes=[],controller={type:'builtin'},visibility='private'}={}){
 return {version:1,agent_id:agentId(id),identity:{personality:trim(personality,64),strategy:trim(strategy,64)},goals:bounded(goals,8).map(goal=>({type:trim(goal.type,32),summary:trim(goal.summary,240)})),memory:{short_term:bounded(shortTerm,8),long_term:bounded(longTerm),opponent_notes:bounded(opponentNotes)},controller:{type:['builtin','model','mcp'].includes(controller?.type)?controller.type:'builtin'},visibility:visibility==='public'?'public':'private'};
}
export function migrateAgentMind(agent){
 const existing=agent?.mind;if(existing&&existing.version===1&&existing.agent_id===agent.id)return createAgentMind({agentId:agent.id,personality:agent.personality||existing.identity?.personality,strategy:agent.strategy,goals:existing.goals,shortTerm:existing.memory?.short_term,longTerm:existing.memory?.long_term,opponentNotes:existing.memory?.opponent_notes,controller:existing.controller,visibility:existing.visibility});
 return createAgentMind({agentId:agent?.id,personality:agent?.personality||agent?.strategy||'balanced',strategy:agent?.strategy||'balanced',longTerm:agent?.memory||[],visibility:'public'});
}
export function addMindLesson(mind,lesson){
 const next=createAgentMind({agentId:mind.agent_id,personality:mind.identity.personality,strategy:mind.identity.strategy,goals:mind.goals,shortTerm:mind.memory.short_term,longTerm:mind.memory.long_term,opponentNotes:mind.memory.opponent_notes,controller:mind.controller,visibility:mind.visibility});
 const record={lesson_type:trim(lesson.lesson_type||'observation',32),subject_agent_id:lesson.subject_agent_id&&ID.test(lesson.subject_agent_id)?lesson.subject_agent_id:null,summary:trim(lesson.summary,320),evidence_match_ids:Array.isArray(lesson.evidence_match_ids)?lesson.evidence_match_ids.filter(value=>typeof value==='string'&&ID.test(value)).slice(0,8):[],confidence:Math.max(0,Math.min(1,Number(lesson.confidence)||0)),created_at:trim(lesson.created_at,40)||new Date().toISOString()};
 next.memory.long_term=[...next.memory.long_term,record].slice(-MAX_ITEMS);return next;
}
export function mindContext(mind){return {agent_id:mind.agent_id,identity:mind.identity,goals:mind.goals,short_term:mind.memory.short_term.slice(-4),long_term:mind.memory.long_term.slice(-8),opponent_notes:mind.memory.opponent_notes.slice(-8),controller:mind.controller};}
