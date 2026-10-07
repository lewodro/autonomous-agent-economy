const byId=id=>document.getElementById(id);
const message=text=>{byId('message').textContent=text;};
async function request(route,options={}){
 const response=await fetch(route,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 const value=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(value.error||'Request failed'),{code:value.code,status:response.status});return value;
}
function button(label,handler){const value=document.createElement('button');value.type='button';value.textContent=label;value.addEventListener('click',handler);return value;}
function showAgent(agent,root){
 const card=document.createElement('article');card.className='agent';
 const title=document.createElement('h3');title.textContent=agent.name;card.append(title);
 const details=[`${agent.strategy} · ${agent.provider}`,`Avatar: ${agent.avatar}`,`Ownership: ${agent.ownership_status}`,`Treasury: ${agent.treasury.currency} ${agent.treasury.available_base_units} · ${agent.treasury.network}`,`Policy: ${agent.treasury.spending_policy.mode}`];
 for(const text of details){const line=document.createElement('p');line.textContent=text;card.append(line);}
 const controls=document.createElement('div');controls.className='actions';
 controls.append(button('Export agent.json',async()=>{try{const {agent:config}=await request(`/api/me/agents/${agent.id}/export`);const file=new Blob([JSON.stringify(config,null,2)],{type:'application/json'}),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=`${agent.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.json`;link.click();URL.revokeObjectURL(url);}catch(error){message(error.message);}}));
 controls.append(button('Set read-only',async()=>{try{await request(`/api/me/agents/${agent.id}/spending-policy`,{method:'POST',body:JSON.stringify({mode:'read_only'})});await refresh();message('Agent spending remains disabled.');}catch(error){message(error.message);}}));
 card.append(controls);
 root.append(card);
}
async function refresh(){
 try{
  const {owner}=await request('/api/me');byId('identity').textContent=`${owner.identity_type==='solana'?'Verified wallet':'Free browser identity'} · ${owner.wallet_public_key||owner.id}`;
  byId('create-panel').classList.remove('hidden');byId('logout').classList.remove('hidden');
  const [{agents},capabilities]=await Promise.all([request('/api/me/agents'),request('/api/capabilities')]);
  const roster=byId('agents');roster.replaceChildren();
  if(!agents.length){const empty=document.createElement('p');empty.textContent='No agents yet. Create your first one above.';roster.append(empty);}
  agents.forEach(agent=>showAgent(agent,roster));
  const mockFunding=capabilities.ownership.mock_agent_funding;
  for(const [index,agent] of agents.entries())if(mockFunding){const card=roster.children[index];const fund=button('Add 100 mock credits',async()=>{try{await request(`/api/me/agents/${agent.id}/mock-fund`,{method:'POST',body:JSON.stringify({amount:100})});await refresh();message('Mock credits recorded. No blockchain transaction occurred.');}catch(error){message(error.message);}});card.querySelector('.actions').append(fund);}
 }catch(error){
  byId('identity').textContent='No signed-in identity.';
  if(error.status===401){byId('create-panel').classList.add('hidden');byId('logout').classList.add('hidden');}
  else message(error.message);
 }
}
byId('guest').addEventListener('click',async()=>{try{await request('/api/auth/anonymous',{method:'POST',body:'{}'});await refresh();message('Free identity ready. No wallet or payment is needed.');}catch(error){message(error.message);}});
byId('connect').addEventListener('click',async()=>{
 try{
  const wallet=window.solana;if(!wallet?.connect||!wallet?.signMessage)throw new Error('No compatible Solana wallet was found. Continue free is always available.');
  const connected=await wallet.connect(),publicKey=connected.publicKey?.toString()||wallet.publicKey?.toString();if(!publicKey)throw new Error('Wallet did not provide a public address.');
  const challenge=await request('/api/auth/wallet/challenge',{method:'POST',body:JSON.stringify({public_key:publicKey})});
  const signed=await wallet.signMessage(new TextEncoder().encode(challenge.message),'utf8');
  const signature=Array.from(signed.signature,value=>String.fromCharCode(value)).join('');
  const signatureB64=btoa(signature).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  await request('/api/auth/wallet/verify',{method:'POST',body:JSON.stringify({challenge_id:challenge.challenge_id,public_key:publicKey,signature:signatureB64})});
  await refresh();message('Wallet ownership verified. No transfer was requested.');
 }catch(error){message(error.message);}
});
byId('logout').addEventListener('click',async()=>{try{await request('/api/auth/logout',{method:'POST',body:'{}'});location.reload();}catch(error){message(error.message);}});
byId('create-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=new FormData(event.currentTarget),config=Object.fromEntries(form.entries());
 try{await request('/api/me/agents',{method:'POST',body:JSON.stringify(config)});await refresh();message('Agent created. It is yours, free, and uses the mock strategy provider.');}
 catch(error){message(error.message);}
});
byId('import-agent').addEventListener('change',async event=>{
 const file=event.currentTarget.files?.[0];if(!file)return;
 try{if(file.size>8192)throw new Error('Agent file must be 8 KB or smaller.');const config=JSON.parse(await file.text());
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Agent file must contain a JSON object.');
  await request('/api/me/agents/import',{method:'POST',body:JSON.stringify(config)});await refresh();message('Agent imported and assigned to this profile. No claimed owner or secret fields are accepted.');
 }catch(error){message(error.message);}finally{event.currentTarget.value='';}
});
async function loadAvatars(){
 try{const {avatars}=await request('/assets/avatars/index.json'),select=byId('avatar');select.replaceChildren();
  for(const avatar of avatars.filter(value=>value.approved===true)){const option=document.createElement('option');option.value=avatar.id;option.textContent=avatar.name;select.append(option);}
 }catch{message('Approved avatar catalog could not be loaded.');}
}
await loadAvatars();await refresh();
