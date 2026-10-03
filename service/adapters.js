import {HttpModelAdapter,InferenceBudget,fallback} from './model-adapter.js';
// Mock decisions stay in Rust. The registry is the extension seam for other providers.
export const adapterFactories=new Map([
  ['http',(profile,budget)=>new HttpModelAdapter(profile,budget)],
  ['openai-compatible',(profile,budget)=>new HttpModelAdapter(profile,budget)],
]);
export async function decisionsFor(config,observation,budget=new InferenceBudget()) {
  if(config.agents.every(a=>a.provider==='mock'))return null;
  return Promise.all(config.agents.filter(a=>observation.agents.some(s=>s.id===a.id&&s.alive)).map(async profile=>{
    if(profile.provider==='mock')return null;
    const factory=adapterFactories.get(profile.provider);
    if(!factory)return fallback(profile,'Recorded adapter requires an explicit decision; local fallback.');
    try{return await factory(profile,budget).decide(observation);}catch{return fallback(profile,'Adapter configuration rejected; local fallback.');}
  }));
}
