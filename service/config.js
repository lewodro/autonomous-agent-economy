// Configuration ergonomics only. Rust still validates every rule and numeric bound.
export function expandConfig(input,defaults){
 if(!input||!Array.isArray(input.agents))throw new Error('Config needs an agents array');
 const aliases={defensive:'conservative'};
 return {...defaults,...input,agents:input.agents.map((profile,i)=>{
  const {system_prompt,avatar,starting_stats,...fields}=profile;
  const strategy=aliases[fields.strategy]||fields.strategy||defaults.agents[i].strategy;
  const provider=fields.provider||defaults.agents[i].provider;
  return {...defaults.agents[i],...fields,id:fields.id||`agent-${i+1}`,strategy,model:fields.model||(provider==='mock'?`mock/${strategy}`:defaults.agents[i].model),...(system_prompt!==undefined?{prompt:system_prompt}:{}),...(avatar!==undefined?{sprite:avatar}:{}),...(starting_stats?{starting_credits:starting_stats.credits}: {})};
 })};
}
export async function resolveConfig(core,input){const defaults=await core.request({command:'defaults',count:input?.agents?.length||4});return expandConfig(input,defaults);}
