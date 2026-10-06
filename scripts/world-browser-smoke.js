import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listChromeTargets } from './chrome-debug.js';
const base=process.env.GAME_URL||'http://localhost:3000',debug=process.env.CHROME_DEBUG_URL||'http://127.0.0.1:9322';
const targets=await listChromeTargets(debug);
const target=targets.find(t=>t.type==='page')||await(await fetch(debug+'/json/new?'+encodeURIComponent(base),{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let nextId=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(request){clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(100);}throw new Error('Browser condition timed out: '+expression);};
const key=async(key,ms)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key});await delay(ms);await send('Input.dispatchKeyEvent',{type:'keyUp',key});};
const screenshot=async name=>{if(process.env.WORLD_SCREENSHOTS!=='1')return;const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(os.tmpdir(),`agent-world-${name}.png`),Buffer.from(r.data,'base64'));};
try{
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base});await wait("document.querySelector('a[href=\"/world\"]')");
 await evaluate("sessionStorage.setItem('last-seat-entry-seen-v1','1');sessionStorage.removeItem('agent-world-entered');localStorage.removeItem('agent-world-settings-v1');document.querySelector('a[href=\"/world\"]').click()");
 await wait('document.getElementById("character-dialog")?.open');
 await wait('document.querySelectorAll("#avatar-presets img").length===8&&[...document.querySelectorAll("#avatar-presets img")].every(i=>i.complete&&i.naturalWidth>0)');
 const focusedPreset=await evaluate('(()=>{const b=document.querySelector("[data-avatar=visitor_atlas]");b.focus();return b.dataset.avatar})()');
 await evaluate('document.querySelector("[data-avatar=visitor_ember]").click()');
 assert.equal(await evaluate('document.activeElement?.dataset.avatar'),focusedPreset,'changing a preset must preserve keyboard focus');
 assert.equal(await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).avatar'),'visitor_ember','avatar choice must persist immediately');
 await evaluate('document.getElementById("enter-world").click()');await screenshot('plaza');
 await wait('document.getElementById("world-canvas").getAttribute("aria-label").includes("20 agents in the plaza")');
 await wait('document.activeElement?.id==="world-canvas"');
 await evaluate('window.__worldKeyDiagnostics=[];window.__worldRafTicks=0;const worldRafProbe=()=>{window.__worldRafTicks++;requestAnimationFrame(worldRafProbe)};requestAnimationFrame(worldRafProbe);window.addEventListener("keydown",event=>setTimeout(()=>window.__worldKeyDiagnostics.push({key:event.key,target:event.target?.id||event.target?.tagName,active:document.activeElement?.id,prevented:event.defaultPrevented}),0),true)');
 const initialKeyboardX=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');
 await key('d',500);await delay(3100);
 const movedKeyboardX=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');
 const keyboardDiagnostics=await evaluate('JSON.stringify({events:window.__worldKeyDiagnostics,active:document.activeElement?.id,entered:sessionStorage.getItem("agent-world-entered"),characterOpen:document.getElementById("character-dialog").open,interactionOpen:document.getElementById("interaction-dialog").open,hidden:document.hidden,visibility:document.visibilityState,hasFocus:document.hasFocus(),rafTicks:window.__worldRafTicks})');
 if(movedKeyboardX<=initialKeyboardX+20){
  await send('Page.navigate',{url:base+'/labs/world'});await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
  await wait('document.activeElement?.id==="world-canvas"');await key('d',500);await delay(1200);
  const liveWorldState=await evaluate('document.querySelector("#world-lab pre")?.textContent');
  assert.ok(movedKeyboardX>initialKeyboardX+20,`keyboard must move the player in open plaza (persisted x ${initialKeyboardX} -> ${movedKeyboardX}; ${keyboardDiagnostics}; live lab state=${liveWorldState}; runtimeErrors=${JSON.stringify(errors)})`);
 }
 const focusedAgent=await evaluate('(()=>{document.querySelector(".world-footer details").open=true;const b=document.querySelector("#agent-directory button");b.focus();return b.id})()');
 await delay(5200);assert.equal(await evaluate('document.activeElement?.id'),focusedAgent,'agent refresh must preserve keyboard focus');
 await evaluate('document.getElementById("world-canvas").focus()');
 await wait('document.getElementById("world-hint").textContent.includes("Inspect")');await key('e',50);
 await wait('document.getElementById("interaction-dialog").open');
 assert.ok(await evaluate('document.getElementById("interaction-content").textContent.includes("retained arena runs")'));
 await screenshot('profile');await evaluate('document.getElementById("interaction-close").click()');
 await wait('document.activeElement?.id==="world-canvas"');
 // Walk around the south side of the arena wall, then approach its entrance.
 // The divider ends at y=700; cross south of it before walking east to the Arena.
 await key('s',1650);await key('d',2120);
 await wait('document.getElementById("world-hint").textContent.includes("Enter Arena")');await screenshot('desktop');await key('e',50);
 await wait('location.pathname==="/arena"&&document.querySelectorAll(".room-card").length===4');await screenshot('lobby');
 for(const [id,game] of [['rps-1','rps'],['ttt-1','tictactoe']]){
  await evaluate(`document.querySelector('a[href="/arena/${game}/${id}"]').click()`);
  await wait('document.getElementById("run-status")?.textContent.includes("SHARED")');
  await wait('document.getElementById("match-title").textContent.includes("game-")');
  if(game==='tictactoe'){await wait('document.querySelectorAll("#ttt-board span").length===9');await screenshot('tictactoe');}
  else{assert.ok(await evaluate('document.getElementById("duel").textContent.includes("VS")'));await screenshot('rps');}
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".play-controls")).display'),'none','shared room controls must be hidden');
  assert.equal(await evaluate('[...document.querySelectorAll(".play-controls button")].every(button=>button.disabled)'),true,'read-only spectators cannot trigger local moves');
  await evaluate('document.querySelector(".return-link").click()');await wait('location.pathname==="/arena"&&document.querySelectorAll(".room-card").length===4');
 }
 await evaluate("document.querySelector('a[href=\"/world\"]').click()");await wait('location.pathname==="/world"&&!document.getElementById("character-dialog").open');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 assert.ok(await evaluate('document.documentElement.scrollWidth<=390'));
 await delay(3100);const before=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');
 const pad=await evaluate('(()=>{const r=document.getElementById("joystick").getBoundingClientRect();return {x:r.x+r.width/2+32,y:r.y+r.height/2}})()');
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pad.x,y:pad.y}]});await delay(450);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(3100);
 assert.ok(await evaluate(`JSON.parse(localStorage.getItem('agent-world-settings-v1')).position.x>${before+15}`),'touch joystick must move the player');
 const released=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');await delay(3100);
 assert.ok(Math.abs((await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x'))-released)<1,'released joystick must stop movement');
 await screenshot('mobile');
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:780,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base});await wait("document.querySelector('a[href=\"/world\"]')");
 assert.ok(await evaluate('document.documentElement.scrollWidth<=360'),'original Last Seat page must fit a 360px viewport');
 assert.ok(await evaluate("document.querySelector('a[href=\"/world\"]').getBoundingClientRect().width>0"),'world entry must remain visible on mobile');
 await screenshot('landing-mobile');assert.deepEqual(errors,[]);
 console.log('PASS world: character, NPC profile, keyboard, arena portal, shared RPS/TTT, return navigation, mobile joystick/release, 390px layout');
}finally{for(const request of pending.values())clearTimeout(request.timer);socket.close();}
