/** Provider boundary: observe immutable public state, decide a structured action,
 * explain with a public reason. Adapters have no state mutation or wallet access. */
export class InferenceBudget {
  constructor({requests=200,tokens=128000}={}) { this.limit={requests,tokens};this.requests=0;this.tokens=0;this.agents=new Map(); }
  reserve(id,settings,cost) {
    const used=this.agents.get(id)||0;
    if(this.requests>=this.limit.requests||used>=settings.max_requests||this.tokens+cost>this.limit.tokens)throw new Error('Inference budget exhausted');
    this.requests++;this.tokens+=cost;this.agents.set(id,used+1);
  }
  view(){return {requests:this.requests,tokens_reserved:this.tokens,limits:this.limit};}
}
export const fallback=(profile,reason)=>({agent_id:profile.id,action:profile.inference?.fallback||'guard',target:null,reason});
export function settings(profile) {
  const c=profile.inference||{};
  return {base_url:c.base_url||process.env.MODEL_BASE_URL||'https://api.openai.com/v1',api_key_env:c.api_key_env||process.env.MODEL_API_KEY_ENV||'OPENAI_API_KEY',timeout_ms:c.timeout_ms??4000,max_tokens:c.max_tokens??256,max_requests:c.max_requests??40,retries:c.retries??1,fallback:c.fallback||'guard'};
}
function approvedEndpoint(options) {
  // Public configs/replays cannot redirect server credentials or choose secrets.
  const base = process.env.MODEL_BASE_URL || 'https://api.openai.com/v1';
  const key = process.env.MODEL_API_KEY_ENV || 'OPENAI_API_KEY';
  const canonical = value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid model base URL');
    return url.href.replace(/\/+$/, '');
  };
  if (canonical(options.base_url) !== canonical(base) || options.api_key_env !== key) throw new Error('Model endpoint or credential is not approved by the server');
  return `${canonical(base)}/chat/completions`;
}
export function validateDecision(result,profile) {
  if(!['work','challenge','guard','cooperate'].includes(result.action)||typeof result.reason!=='string'||!result.reason.trim()||result.reason.length>300||(result.target!=null&&typeof result.target!=='string'))throw new Error('Invalid structured decision');
  return {agent_id:profile.id,action:result.action,target:result.target||null,reason:result.reason};
}
async function boundedJson(response) {
  if(!response.ok)throw Object.assign(new Error(`HTTP ${response.status}`),{retryable:response.status===429||response.status>=500});
  const reader=response.body.getReader();let text='',bytes=0;const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8192)throw new Error('Model response exceeds 8 KB');text+=decoder.decode(value,{stream:true});}}finally{await reader.cancel();}
  return JSON.parse(text+decoder.decode());
}
export class HttpModelAdapter {
  constructor(profile,budget){this.profile=profile;this.budget=budget;this.options=settings(profile);}
  observe(observation){return structuredClone(observation);}
  explain(choice){return choice.reason;}
  async decide(observation){
    const p=this.profile,o=this.options,compatible=p.provider==='openai-compatible';
    const messages=[{role:'system',content:`You compete at Last Seat. Choose one legal action: work, guard, challenge, cooperate. Challenge/cooperate require another living target; work/guard require target:null. Return JSON {action,target,reason}. Reason is public, at most 300 characters. ${p.prompt}\nPersonality: ${p.personality}`},{role:'user',content:JSON.stringify({self:p.id,observation:this.observe(observation)})}];
    const endpoint=compatible?approvedEndpoint(o):process.env.AGENT_HTTP_ENDPOINT;
    if(!endpoint)return fallback(p,'HTTP adapter not configured; local fallback.');
    const url=new URL(endpoint);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP endpoint without embedded credentials');
    const credential=compatible?process.env[o.api_key_env]:process.env.AGENT_HTTP_TOKEN;
    const payload=compatible?{model:p.model,messages,max_tokens:o.max_tokens,temperature:0,response_format:{type:'json_object'}}:{agent:{id:p.id,model:p.model,prompt:p.prompt,personality:p.personality},observation:this.observe(observation),response_schema:{action:['work','guard','challenge','cooperate'],target:'agent ID or null',reason:'brief public explanation'}};
    // Conservative context+output reservation; failed requests/retries count too.
    const cost=Math.ceil(JSON.stringify(payload).length/4)+o.max_tokens;
    for(let attempt=0;attempt<=o.retries;attempt++){
      try{
        this.budget.reserve(p.id,o,cost);
        const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(credential?{Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify(payload),signal:AbortSignal.timeout(o.timeout_ms)});
        const data=await boundedJson(response);
        const decision=compatible?JSON.parse(data.choices?.[0]?.message?.content||'null'):data;
        return validateDecision(decision,p);
      }catch(error){
        if(error.message.includes('budget'))return fallback(p,'Inference budget exhausted; local fallback.');
        if(attempt===o.retries||(!error.retryable&&error.name!=='TimeoutError'&&error.name!=='TypeError'))return fallback(p,'Model request failed or returned invalid output; local fallback.');
        await new Promise(resolve=>setTimeout(resolve,Math.min(1000,200*(attempt+1))));
      }
    }
    return fallback(p,'No model decision; local fallback.');
  }
}
