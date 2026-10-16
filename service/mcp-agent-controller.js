const ID=/^[A-Za-z0-9_-]{1,96}$/;
const ACTIONS=new Set(['move','target','attack','retreat','defend','interact']);
function invalid(message){return Object.assign(new Error(message),{code:'INVALID_AGENT_INTENT',status:400});}
function id(value,field){if(typeof value!=='string'||!ID.test(value))throw invalid(`${field} is invalid`);return value;}
function boundedNumber(value,field,min,max){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw invalid(`${field} is invalid`);return value;}
export function approvedObservation(input={}) {
  return {agent_id:id(input.agent_id,'agent_id'), game_state:typeof input.game_state==='string'?input.game_state.slice(0,80):'plaza', hp:input.hp===undefined?null:boundedNumber(input.hp,'hp',0,100), position:{x:boundedNumber(input.position?.x??0,'position.x',-10000,10000),y:boundedNumber(input.position?.y??0,'position.y',-10000,10000)}, legal_actions:Array.isArray(input.legal_actions)?input.legal_actions.filter(action=>ACTIONS.has(action)).slice(0,8):[], nearby_agents:Array.isArray(input.nearby_agents)?input.nearby_agents.filter(value=>typeof value==='string'&&ID.test(value)).slice(0,20):[], research_summary:typeof input.research_summary==='string'?input.research_summary.slice(0,500):'', objective:typeof input.objective==='string'?input.objective.slice(0,160):''};
}
export function validateAgentIntent(input={}) {
  if(!input||typeof input!=='object'||!ACTIONS.has(input.action))throw invalid('action is not approved');
  const result={action:input.action};
  if(input.target_id!==undefined)result.target_id=id(input.target_id,'target_id');
  if(input.action==='move'){result.x=boundedNumber(input.x,'x',-1,1);result.y=boundedNumber(input.y,'y',-1,1);}
  return result;
}
export function safeFallbackIntent(){return {action:'defend'};}
export class McpAgentController {
  constructor({adapter,timeoutMs=1200,onError=()=>{}}={}) {this.adapter=adapter;this.timeoutMs=timeoutMs;this.onError=onError;this.connected=true;}
  observe(input){return approvedObservation(input);}
  async decide(observation){
    if(!this.connected||!this.adapter?.decide)return safeFallbackIntent();
    try{
      const response=await Promise.race([Promise.resolve(this.adapter.decide(this.observe(observation))),new Promise((_,reject)=>setTimeout(()=>reject(new Error('controller timeout')),this.timeoutMs))]);
      return validateAgentIntent(response);
    }catch(error){this.onError({code:error?.message==='controller timeout'?'MCP_TIMEOUT':'MCP_FALLBACK'});return safeFallbackIntent();}
  }
  health(){return {connected:this.connected,controller:'mcp',timeout_ms:this.timeoutMs};}
  disconnect(){this.connected=false;this.adapter?.disconnect?.();}
}
