const target=process.env.DEPLOYMENT_VERIFY_URL;
if(!target)throw new Error('Set DEPLOYMENT_VERIFY_URL to the deployed HTTPS origin. This creates one small private test experiment.');
const origin=new URL(target);
if(origin.origin!==target||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1'].includes(origin.hostname))throw new Error('DEPLOYMENT_VERIFY_URL must be an HTTPS origin (HTTP loopback is allowed for local tests).');
async function request(path,{method='GET',body,cookie}={}){
  const response=await fetch(origin.origin+path,{method,headers:{Origin:origin.origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const content=await response.text();let data;try{data=JSON.parse(content);}catch{data=content;}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
function expect(response,status,label){if(response.status!==status)throw new Error(`${label}: expected ${status}, received ${response.status}: ${JSON.stringify(response.data).slice(0,300)}`);return response;}
const health=expect(await request('/api/health'),200,'health').data;
if(health.ok!==true||health.storage!=='ok'||health.experiments?.status!=='ok'||health.arena?.status!=='ok'||health.survival?.status!=='ok')throw new Error('Health readiness failed');
for(const route of ['/','/world','/arena','/rps'])expect(await request(route),200,route);
expect(await request('/api/arena/rooms'),200,'RPS/TTT rooms');
expect(await request('/api/survival/current'),200,'Survival');
const a=expect(await request('/api/experiments'),200,'visitor A'),b=expect(await request('/api/experiments'),200,'visitor B');
if(!a.cookie||!b.cookie||a.cookie===b.cookie)throw new Error('Anonymous session isolation failed');
const config=expect(await request('/api/config?agents=2'),200,'config').data;
config.max_turns=2;config.seed=crypto.getRandomValues(new Uint32Array(1))[0]||1;
const created=expect(await request('/api/experiments',{method:'POST',body:{config},cookie:a.cookie}),201,'create').data;
const id=created.session;
expect(await request(`/api/experiments/${id}`,{cookie:a.cookie}),200,'owner reload');
expect(await request(`/api/experiments/${id}`,{cookie:b.cookie}),404,'private isolation');
expect(await request(`/api/experiments/${id}/export`,{cookie:b.cookie}),404,'private log isolation');
let state=created.replay;
for(let i=0;i<3&&!state.final_state.ended;i++){
  const next=expect(await request(`/api/experiments/${id}/step`,{method:'POST',body:{expected_turn:state.final_state.turn},cookie:a.cookie}),200,'step').data;
  state=next.replay;
}
const exported=expect(await request(`/api/experiments/${id}/export`,{cookie:a.cookie}),200,'experiment download').data;
if(exported.experiment_id!==id||!Array.isArray(exported.structured_events)||!Array.isArray(exported.results))throw new Error('Experiment export schema failed');
const reloaded=expect(await request(`/api/experiments/${id}`,{cookie:a.cookie}),200,'experiment reload').data;
if(reloaded.replay.final_state.turn!==state.final_state.turn)throw new Error('Experiment reload lost its latest turn');
expect(await request(`/api/experiments/${id}/matches/${state.match_id}.json`,{cookie:a.cookie}),200,'match download');
console.log(JSON.stringify({ok:true,origin:target,experiment_id:id,match_id:state.match_id,health:health.ok,shared_world:true,private_isolation:true,json_download:true}));
