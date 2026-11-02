import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {listChromeTargets} from './chrome-debug.js';

const base=process.env.GAME_URL||'http://localhost:3000';
const debugUrls=[process.env.CHROME_DEBUG_URL,process.env.CHROME_DEBUG_URL_2];
if(debugUrls.some(value=>!value))throw new Error('Two isolated Chrome debug sessions are required');

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(debugUrl){
  const targets=await listChromeTargets(debugUrl),target=targets.find(value=>value.type==='page');
  if(!target)throw new Error(`No page target at ${debugUrl}`);
  const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let nextId=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const request=pending.get(message.id);if(!request)return;clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser command timed out: ${method}`));},15_000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const wait=async(expression,timeout=15_000)=>{for(let elapsed=0;elapsed<timeout;elapsed+=100){if(await evaluate(expression))return;await delay(100);}const state=await evaluate(`({url:location.href,hint:document.getElementById('world-hint')?.textContent,notices:document.getElementById('farm-notices')?.textContent,disabled:document.getElementById('interact')?.disabled,dialog:document.getElementById('character-dialog')?.open,settings:localStorage.getItem('agent-world-settings-v1'),connection:document.getElementById('connection')?.textContent})`);throw new Error(`Browser condition timed out: ${expression}; state=${JSON.stringify(state)}`);};
  return{socket,send,evaluate,wait};
}

async function placeAtResource(browser,node,avatar){
  const preload=await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('agent-world-settings-v1',JSON.stringify({version:1,avatar:${JSON.stringify(avatar)},position:${JSON.stringify(node.position)},muted:true}));sessionStorage.setItem('agent-world-entered','1');`});
  await browser.send('Page.reload',{ignoreCache:true});
  await browser.wait("document.getElementById('connection')?.textContent.includes('HERE')");
  await browser.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:preload.identifier});
  await browser.evaluate("document.getElementById('character-dialog').open&&document.getElementById('enter-world').click()");
  await browser.wait("!document.getElementById('character-dialog').open");
  await browser.evaluate(`(async()=>{const target=${JSON.stringify(node.position)},headers={'Content-Type':'application/json'},joined=await fetch('/api/worlds/main/presence/join',{method:'POST',headers,body:JSON.stringify({avatar:${JSON.stringify(avatar)},position:target,direction:'down',activity:'Exploring'})}).then(r=>r.json());let position=joined.player.position;for(let step=0;step<400&&Math.hypot(target.x-position.x,target.y-position.y)>2;step++){const distance=Math.hypot(target.x-position.x,target.y-position.y),amount=Math.min(16,distance);position={x:position.x+(target.x-position.x)/distance*amount,y:position.y+(target.y-position.y)/distance*amount};await new Promise(resolve=>setTimeout(resolve,80));const response=await fetch('/api/worlds/main/presence/move',{method:'POST',headers,body:JSON.stringify({position,direction:'down',animation_state:'walk'})});if(response.status===429){step--;continue;}if(!response.ok)throw new Error('authoritative walk failed '+response.status);position=(await response.json()).player.position;}return position;})()`);
  await browser.wait(`!document.getElementById('interact').disabled&&document.getElementById('world-hint').textContent.toLowerCase().includes(${JSON.stringify(node.rarity.replace('_',' '))})`);
}

const [first,second]=await Promise.all(debugUrls.map(connect));
try{
  await Promise.all([first.send('Runtime.enable'),first.send('Page.enable'),second.send('Runtime.enable'),second.send('Page.enable')]);
  await first.send('Page.navigate',{url:`${base}/world`});
  await first.wait("document.getElementById('connection')?.textContent.includes('HERE')");
  const spawnUi=await first.evaluate(`({hint:document.getElementById('hud-hint')?.textContent||'',helpOpen:document.querySelector('.world-footer details')?.open,directionsOpen:document.querySelector('.world-legend')?.open,hasGlobalArena:!!document.querySelector('.world-header a[href="/arena"]')})`);
  assert.match(spawnUi.hint,/Explore beyond the plaza/i);assert.equal(spawnUi.helpOpen,false);assert.equal(spawnUi.directionsOpen,false);assert.equal(spawnUi.hasGlobalArena,false);
  const node=await first.evaluate("fetch('/api/world/economy').then(r=>r.json()).then(s=>s.nodes.find(n=>n.available))");
  assert.ok(node);assert.ok(['common','uncommon'].includes(node.rarity));
  await Promise.all([placeAtResource(first,node,'visitor_atlas'),placeAtResource(second,node,'visitor_ember')]);
  const harvest=await first.evaluate(`fetch('/api/world/economy/gather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({node_id:${JSON.stringify(node.id)}})}).then(async r=>({status:r.status,body:await r.json()}))`);
  assert.equal(harvest.status,200);assert.equal(harvest.body.receipt.amount_credits,node.reward);
  await second.wait(`fetch('/api/world/economy').then(r=>r.json()).then(s=>s.nodes.find(n=>n.id===${JSON.stringify(node.id)})?.available===false)`);
  const duplicate=await second.evaluate(`fetch('/api/world/economy/gather',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({node_id:${JSON.stringify(node.id)}})}).then(async r=>({status:r.status,body:await r.json()}))`);
  assert.equal(duplicate.status,409);assert.match(duplicate.body.error,/respawn/i);
  const firstView=await first.evaluate("fetch('/api/world/economy').then(r=>r.json()).then(s=>s.nodes)"),secondView=await second.evaluate("fetch('/api/world/economy').then(r=>r.json()).then(s=>s.nodes)");
  assert.deepEqual(secondView,firstView);
  await first.wait(`!document.getElementById('world-hint').textContent.toLowerCase().includes(${JSON.stringify(node.rarity.replace('_',' '))})`,7_000);
  await first.send('Emulation.setDeviceMetricsOverride',{width:390,height:760,deviceScaleFactor:1,mobile:true});
  assert.equal(await first.evaluate("document.documentElement.scrollWidth<=document.documentElement.clientWidth"),true,'small viewport should not overflow horizontally');
  if(process.env.WORLD_SCREENSHOTS==='1'){const capture=await first.send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(os.tmpdir(),'lastseat-resource-zone.png'),Buffer.from(capture.data,'base64'));}
  console.log(`World resource browser smoke passed: ${node.id} (${node.rarity}) shared by two visitors.`);
}finally{first.socket.close();second.socket.close();}
