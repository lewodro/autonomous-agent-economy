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
const wait=async(expression,timeoutMs=15000)=>{for(let i=0;i<Math.ceil(timeoutMs/100);i++){if(await evaluate(expression))return;await delay(100);}const details=await evaluate(`({url:location.href,connection:document.getElementById('connection')?.textContent,entered:sessionStorage.getItem('agent-world-entered'),lab:document.querySelector('#world-lab pre')?.textContent?.slice(0,500),presenceRequests:window.__presenceRequests,canvasLabel:document.getElementById('world-canvas')?.getAttribute('aria-label'),presenceFailures:window.__presenceFailures,lastPresence:window.__lastPresenceState,errors:${JSON.stringify(errors)}})`);details.health=await evaluate("fetch('/api/health').then(r=>r.json()).then(h=>h.presence)");throw new Error('Browser condition timed out: '+expression+'; state='+JSON.stringify(details));};
const screenshot=async name=>{if(process.env.WORLD_SCREENSHOTS!=='1')return;try{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(os.tmpdir(),`agent-world-${name}.png`),Buffer.from(r.data,'base64'));}catch(error){throw new Error(`Screenshot capture failed for ${name}: ${error?.message||error}`);}};
let failed=false;
try{
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__presenceRequests=[];const nativeFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(String(args[0]).includes('/presence/')){let body={};try{body=await response.clone().json()}catch{}window.__presenceRequests.push({path:String(args[0]),status:response.status,code:body.code})}return response}"});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base});await wait("document.querySelector('a[href=\"/world\"]')");
 await evaluate("sessionStorage.setItem('last-seat-entry-seen-v1','1');sessionStorage.removeItem('agent-world-entered');localStorage.removeItem('agent-world-settings-v1')");
 await send('Page.navigate',{url:base+'/world'});
 await wait('document.getElementById("character-dialog")?.open');
 await wait('document.querySelectorAll("#avatar-presets img").length===4&&[...document.querySelectorAll("#avatar-presets img")].every(i=>i.complete&&i.naturalWidth>0)');
 const focusedPreset=await evaluate('(()=>{const b=document.querySelector("[data-avatar=visitor_atlas]");b.focus();return b.dataset.avatar})()');
 await evaluate('document.querySelector("[data-avatar=visitor_ember]").click()');
 assert.equal(await evaluate('document.activeElement?.dataset.avatar'),focusedPreset,'changing a preset must preserve keyboard focus');
 assert.equal(await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).avatar'),'visitor_ember','avatar choice must persist immediately');
 await evaluate("window.__presenceFailures=[];const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).includes('/presence/')&&!response.ok){const body=await response.clone().json().catch(()=>({}));window.__presenceFailures.push({path:String(args[0]),status:response.status,code:body.code})}return response}");
 await evaluate('document.getElementById("enter-world").click()');await screenshot('plaza');
 await wait('!document.getElementById("world-canvas").getAttribute("aria-label").includes("0 visiting agents in the plaza")');
 assert.equal(await evaluate("document.getElementById('world-speech').hidden"),true,'NPC thoughts wait for interaction instead of covering the world on entry');
 await wait("fetch('/api/health').then(r=>r.json()).then(h=>h.presence.active_players===1)");
 let localPlayerId=await evaluate("sessionStorage.getItem('aae-world-presence-v1:main:player')");assert.ok(localPlayerId);
 await evaluate("document.getElementById('avatar-change').click()");await wait("document.getElementById('character-dialog').open");
 await evaluate("document.querySelector('[data-avatar=visitor_atlas]').click()");
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)})?.avatar==='visitor_atlas')`);
 await evaluate("document.getElementById('character-close').click()");
 const guest=await evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-guest',avatar:'visitor_atlas',position:{x:680,y:420}})}).then(async r=>({status:r.status,...await r.json()}))");
 assert.equal(guest.status,201,'the second visitor should join the same world');
 await wait("document.getElementById('connection').textContent.includes('2 HERE')&&document.getElementById('world-canvas').getAttribute('aria-label').includes('1 other visitor online')");
 await screenshot('multiplayer-plaza');
 await delay(80);
 const guestMove=await evaluate(`fetch('/api/worlds/main/presence/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-guest',session_token:${JSON.stringify(guest.session_token)},position:{x:690,y:420},direction:'right',animation_state:'walk'})}).then(r=>r.status)`);
 assert.equal(guestMove,200,'a joined visitor should publish a validated move');
 const guestLeave=await evaluate(`fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-guest',session_token:${JSON.stringify(guest.session_token)}})}).then(r=>r.status)`);
 assert.equal(guestLeave,200,'the second visitor should be able to leave');
 await wait("document.getElementById('connection').textContent.includes('1 HERE')&&document.getElementById('world-canvas').getAttribute('aria-label').includes('0 other visitors online')");
 // The shared world keeps the current public Arena roster visible in the
 // plaza while they wait for the next match.  Assert that the roster is
 // present instead of expecting the old empty-plaza behavior.
 await wait('!document.getElementById("world-canvas").getAttribute("aria-label").includes("0 visiting agents in the plaza")');
 await wait('document.activeElement?.id==="world-canvas"');
 await evaluate('window.__worldRafTicks=0;const worldRafProbe=()=>{window.__worldRafTicks++;requestAnimationFrame(worldRafProbe)};requestAnimationFrame(worldRafProbe)');
 await delay(250);assert.ok(await evaluate('window.__worldRafTicks>5'),'world animation loop must remain live after character entry');
 const focusedAgent=await evaluate('(()=>{document.querySelector(".world-footer details").open=true;const b=document.querySelector("#agent-directory button");b.focus();return b.id})()');
 await delay(5200);assert.equal(await evaluate('document.activeElement?.id'),focusedAgent,'agent refresh must preserve keyboard focus');
 await evaluate(`document.getElementById(${JSON.stringify(focusedAgent)}).click()`);
 await wait('document.getElementById("interaction-dialog").open');
 assert.ok(await evaluate('document.getElementById("interaction-content").textContent.includes("retained RPS, Tic-Tac-Toe, and Survival runs")'));
 await screenshot('profile');await evaluate('document.getElementById("interaction-close").click()');
 // Exercise arena routes directly. Browser-generated keyboard holds are
 // unreliable in headless Chrome and the ambient NPC path is frame-timed.
 await send('Page.navigate',{url:base+'/arena'});
 await wait('location.pathname==="/arena"&&document.querySelectorAll(".room-card").length===4');await screenshot('desktop');await screenshot('lobby');
 assert.ok(await evaluate('document.querySelector(".survival-map-key")&&document.getElementById("agents")&&document.getElementById("rooms-view")'),'tactical map must retain the existing room and agent sections');
 await wait('document.querySelectorAll(".room-player").length>=4&&document.querySelectorAll(".room-versus").length>=2');
 assert.ok(await evaluate('[...document.querySelectorAll(".room-card")].filter(card=>card.querySelectorAll(".room-player").length===2).every(card=>card.querySelector(".room-versus")?.textContent==="VS")'),'room cards must visually group each pair around a VS marker');
 await wait('!document.getElementById("survival-view").hidden&&document.getElementById("survival-overlay").hidden&&document.getElementById("survival-status").textContent.includes("LIVE")');
 await wait("fetch('/api/survival/current').then(r=>r.json()).then(s=>s.agents.length===20&&s.events.some(e=>e.type==='AttackLanded'))");
 await evaluate("fetch('/api/survival/current').then(r=>r.json()).then(s=>{const a=s.agents[0],c=document.getElementById('survival-field'),r=c.getBoundingClientRect(),scale=Math.min(r.width/s.map.width,r.height/s.map.height),x=r.left+(r.width-s.map.width*scale)/2+a.x*scale,y=r.top+(r.height-s.map.height*scale)/2+a.y*scale;c.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true}))})");
 await wait('document.getElementById("survival-inspector-title").textContent.length>0&&document.getElementById("survival-inspector-body").textContent.includes("HP:")');
 assert.ok(await evaluate('document.getElementById("survival-inspector-body").textContent.includes("Strategy:")'),'Survival inspection must use server-authoritative agent state');
 for(const [id,game] of [['rps-1','rps'],['ttt-1','tictactoe']]){
  await send('Page.navigate',{url:base+`/arena/${game}/${id}`});
  await wait('document.getElementById("run-status")?.textContent.includes("SHARED")');
  await wait('document.getElementById("match-title").textContent.includes("game-")');
  const spectatorCount=`fetch('/api/arena/rooms').then(r=>r.json()).then(v=>v.rooms.find(room=>room.id===${JSON.stringify(id)})?.spectators)`;
  await wait(`${spectatorCount}.then(count=>count===1)`);
  if(game==='tictactoe'){await wait('document.querySelectorAll("#ttt-board span").length===9');await screenshot('tictactoe');}
  else{assert.ok(await evaluate('document.getElementById("duel").textContent.includes("VS")'));await screenshot('rps');}
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".play-controls")).display'),'none','shared room controls must be hidden');
  assert.equal(await evaluate('[...document.querySelectorAll(".play-controls button")].every(button=>button.disabled)'),true,'read-only spectators cannot trigger local moves');
  assert.equal(await evaluate('document.querySelector(".return-link")?.getAttribute("href")'),'/arena');
  await send('Page.reload');await wait('document.getElementById("run-status")?.textContent.includes("SHARED")');
  await wait(`${spectatorCount}.then(count=>count===1)`);
  await evaluate('document.querySelector(".return-link").click()');
  await wait('location.pathname==="/arena"&&document.querySelectorAll(".room-card").length===4');
  await wait(`${spectatorCount}.then(count=>count===0)`);
 }
 assert.equal(await evaluate("document.querySelector('a[href=\"/world\"]')?.getAttribute('href')"),'/world');
 await evaluate("localStorage.setItem('agent-world-settings-v1',JSON.stringify({version:1,avatar:'visitor_ember',position:{x:928,y:674},muted:true}))");
 await send('Page.navigate',{url:base+'/world'});await wait('location.pathname==="/world"&&!document.getElementById("character-dialog").open');
 await wait('document.getElementById("connection").textContent.includes("WORLD ONLINE")');
 assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position'),{x:560,y:480},'entering from Arena must reset the visitor to the plaza spawn');
 await wait("fetch('/api/arena/statistics').then(r=>r.json()).then(s=>s.totals.matches>0)");
 await send('Page.navigate',{url:base+'/labs/world'});await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Open arena statistics').click()");
 await wait('!document.getElementById("interact").disabled');
 await evaluate("window.__researchStats=null;window.__presenceFailures=[];const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).includes('/api/arena/statistics'))window.__researchStats=await response.clone().json();if(String(args[0]).includes('/presence/')&&!response.ok){const body=await response.clone().json().catch(()=>({}));window.__presenceFailures.push({path:String(args[0]),status:response.status,code:body.code})}return response}");
 await evaluate('document.getElementById("interact").click()');
 await wait('document.getElementById("interaction-dialog").open&&document.getElementById("interaction-content").textContent.includes("Latest match results")');
 const actualMatches=await evaluate('window.__researchStats.totals.matches');
 const matchesLabel=JSON.stringify(`${actualMatches}Completed matches`);
 assert.ok(await evaluate(`document.getElementById('interaction-content').textContent.includes('Live totals from retained RPS, Tic-Tac-Toe, and Survival results')&&document.getElementById('interaction-content').textContent.includes(${matchesLabel})`),`Research House should display the authoritative completed-match count (${actualMatches})`);
 const archiveUrl=await evaluate('document.querySelector(".archive-row a:last-child")?.getAttribute("href")');
 assert.ok(archiveUrl,'Research House must keep a downloadable match record');
 const archive=await evaluate(`fetch(${JSON.stringify(archiveUrl)}).then(async r=>({status:r.status,contentType:r.headers.get('content-type'),body:await r.json()}))`);
 assert.equal(archive.status,200);assert.ok(archive.contentType.includes('application/json'));assert.ok(archive.body&&typeof archive.body==='object');
 await evaluate('document.getElementById("interaction-close").click()');
 // Exercise the smallest user-created-agent path. This remains owner-scoped
 // to the browser session and does not alter the canonical world roster.
 await send('Page.navigate',{url:base+'/private-arena'});
 await wait('location.pathname==="/private-arena"&&document.getElementById("agent-form")');
 await wait('document.getElementById("status").textContent.includes("PAUSED")');
 await evaluate("document.getElementById('agent-name').value='Browser Agent';document.getElementById('agent-strategy').value='aggressive';document.getElementById('agent-form').requestSubmit()");
 await wait("document.getElementById('agent-status').textContent.includes('Browser Agent')&&document.getElementById('agent-status').textContent.includes('private to this browser')");
 const privateExport=await evaluate("fetch('/api/private-arena/export').then(async r=>({status:r.status,body:await r.json()}))");
 assert.equal(privateExport.status,200,'private agent export should be available to its owner');
 assert.equal(privateExport.body.custom_agent.name,'Browser Agent','private export should contain the created agent');
 assert.equal(privateExport.body.custom_agent.strategy,'aggressive','private export should retain the selected strategy');
 assert.equal(await evaluate("fetch('/api/arena/statistics').then(r=>r.json()).then(s=>s.agents.some(a=>a.name==='Browser Agent'))"),false,'private agents must not enter canonical rankings');
 await send('Page.navigate',{url:base+'/labs/world'});
 await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden&&document.getElementById("connection").textContent.includes("WORLD ONLINE")');
 await wait("(()=>{const value=document.querySelector('#world-lab pre').textContent;return value&&JSON.parse(value).npcs.length>=3})()");
 await evaluate("window.__npcBefore=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs");
 await wait("(()=>{const after=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs,before=new Map(window.__npcBefore.map(n=>[n.id,n.position]));return after.filter(n=>{const old=before.get(n.id);return old&&Math.hypot(n.position.x-old.x,n.position.y-old.y)>8}).length>=2})()");
 const npcMovement=await evaluate("(()=>{const after=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs,before=new Map(window.__npcBefore.map(n=>[n.id,n.position]));return after.map(n=>{const old=before.get(n.id);return {id:n.id,distance:old?Math.hypot(n.position.x-old.x,n.position.y-old.y):-1,state:n.activityState}})})()");
 assert.ok(npcMovement.filter(value=>value.distance>8).length>=2,`several canonical NPCs must change world coordinates: ${JSON.stringify(npcMovement)}`);
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(button=>button.textContent==='Offer nearest NPC thought').click()");
 await wait("JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.some(n=>n.attention)");
 const talkingAgent=await evaluate("JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.find(n=>n.attention).name");
 await screenshot('npc-attention');
 await wait("!document.getElementById('interact').disabled&&document.getElementById('world-hint').textContent.includes('Talk to')");
 await evaluate("document.getElementById('interact').click()");
 await wait(`!document.getElementById('world-speech').hidden&&document.getElementById('world-speech').textContent.startsWith(${JSON.stringify(talkingAgent+':')})`);
 await wait("JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.some(n=>n.name==="+JSON.stringify(talkingAgent)+"&&!n.attention&&n.activityState==='talking')");
 await screenshot('npc-dialogue');
 await evaluate("window.__talkPosition=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.find(n=>n.name==="+JSON.stringify(talkingAgent)+").position");
 // The canonical Arena may claim this NPC while the browser waits. That is a
 // valid roster transition; otherwise the actor must resume a normal state.
 await wait("(()=>{const n=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.find(n=>n.name==="+JSON.stringify(talkingAgent)+");return !n||!['attention','talking','cooldown'].includes(n.activityState)})()",15000);
 // Developer probes start just inside each former edge. Walking through those
 // coordinates exercises the real input, collision, camera and canvas paths.
 const walkProbe=async(label,key,axis,threshold,screenshotName)=>{
  await evaluate(`(()=>{const button=[...document.querySelectorAll('#world-lab button')].find(value=>value.textContent===${JSON.stringify(`Walk probe: ${label}`)});if(!button)throw Error('Missing walk probe');button.click()})()`);
  await wait('document.activeElement?.id==="world-canvas"&&document.getElementById("connection").textContent.includes("WORLD ONLINE")');
  await evaluate(`document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
  await delay(950);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true}))`);
  await wait(`(()=>{const state=JSON.parse(document.querySelector('#world-lab pre').textContent);return state.player.${axis}${threshold}})()`);
  await wait("(()=>{const local=JSON.parse(document.querySelector('#world-lab pre').textContent).player,pid=sessionStorage.getItem('aae-world-presence-v1:main:player');return fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const remote=s.players.find(p=>p.player_id===pid);return !!remote&&Math.hypot(remote.position.x-local.x,remote.position.y-local.y)<20})})()");
  await screenshot(screenshotName);
 };
 await walkProbe('west','a','x','<0','west-expansion');
 await walkProbe('east','d','x','>1792','east-expansion');
 await walkProbe('north','w','y','<0','north-expansion');
 await walkProbe('south','s','y','>1152','south-expansion');
 await walkProbe('garden','d','x','>1900','botanical-garden');
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(value=>value.textContent==='Walk probe: campfire').click()");
 await wait('document.activeElement?.id==="world-canvas"&&document.getElementById("connection").textContent.includes("WORLD ONLINE")');
 await wait("(()=>{const p=JSON.parse(document.querySelector('#world-lab pre').textContent).player;return p.x===1702&&p.y===740})()");
 await screenshot('campfire');
 assert.ok(await evaluate("document.querySelector('.world-legend').textContent.includes('AGENCY')&&document.querySelector('.world-legend').textContent.includes('MARKET')"),'compact world legend must name Agency and Market');
 const teleportProbe=async(label,x,y,screenshotName)=>{
  await evaluate(`[...document.querySelectorAll('#world-lab button')].find(value=>value.textContent===${JSON.stringify(`Walk probe: ${label}`)}).click()`);
  await wait(`(()=>{const p=JSON.parse(document.querySelector('#world-lab pre').textContent).player;return p.x===${x}&&p.y===${y}})()`);
  await wait('document.getElementById("connection").textContent.includes("WORLD ONLINE")');
  await screenshot(screenshotName);
 };
 await teleportProbe('eastRoad',1300,460,'east-road');
 assert.equal(await evaluate("document.getElementById('world-canvas').getAttribute('aria-label').includes('Agent town')"),true);
 await wait('document.activeElement?.id==="world-canvas"');
 // Walk the actual road to the Agency door.
 // Teleport probes alone would miss a blocked turn or a path seam.
 const holdWorldKey=async(key,ms)=>{
  await evaluate(`document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
  await delay(ms);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true}))`);
 };
 await holdWorldKey('d',1700);await wait("JSON.parse(document.querySelector('#world-lab pre').textContent).player.x>1525");
 await holdWorldKey('w',750);await wait("JSON.parse(document.querySelector('#world-lab pre').textContent).player.y<380");
 await wait("(()=>{const local=JSON.parse(document.querySelector('#world-lab pre').textContent).player,pid=sessionStorage.getItem('aae-world-presence-v1:main:player');return fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const remote=s.players.find(p=>p.player_id===pid);return !!remote&&Math.hypot(remote.position.x-local.x,remote.position.y-local.y)<20})})()");
 await screenshot('agency-walk-in');
 await teleportProbe('agency',1568,340,'agency');
 const eastGuest=await evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-east',avatar:'visitor_atlas',position:{x:1300,y:460}})}).then(async r=>({status:r.status,...await r.json()}))");
 assert.equal(eastGuest.status,201,'a second visitor can enter the east road');
 await delay(80);
 assert.equal(await evaluate(`fetch('/api/worlds/main/presence/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-east',session_token:${JSON.stringify(eastGuest.session_token)},position:{x:1312,y:460},direction:'right',animation_state:'walk'})}).then(r=>r.status)`),200,'second visitor moves on the same east road');
 await wait("fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.some(p=>p.player_id==='browser-smoke-east'&&p.position.x===1312))");
 assert.equal(await evaluate(`fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-east',session_token:${JSON.stringify(eastGuest.session_token)}})}).then(r=>r.status)`),200);
 await teleportProbe('market',820,1320,'south-market');
 const westGuest=await evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-west',avatar:'visitor_atlas',position:{x:-120,y:430}})}).then(async r=>({status:r.status,...await r.json()}))");
 assert.equal(westGuest.status,201,'a second visitor can enter the west extension');
 await wait("fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.some(p=>p.player_id==='browser-smoke-west'&&p.position.x===-120))");
 await delay(80);
 assert.equal(await evaluate(`fetch('/api/worlds/main/presence/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-west',session_token:${JSON.stringify(westGuest.session_token)},position:{x:-108,y:430},direction:'right',animation_state:'walk'})}).then(r=>r.status)`),200,'second visitor moves beyond the former west boundary');
 assert.equal(await evaluate(`fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:'browser-smoke-west',session_token:${JSON.stringify(westGuest.session_token)}})}).then(r=>r.status)`),200);
 // The lab teleport intentionally bypasses movement rules. Rejoin from the
 // persisted location before testing client movement against server speed limits.
 const releasedPresence=await evaluate("(()=>{const player=sessionStorage.getItem('aae-world-presence-v1:main:player'),token=sessionStorage.getItem('aae-world-presence-v1:main:token');return fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({player_id:player,session_token:token})}).then(r=>{sessionStorage.removeItem('aae-world-presence-v1:main:player');sessionStorage.removeItem('aae-world-presence-v1:main:token');return r.status})})()");assert.equal(releasedPresence,200,'test player should leave cleanly before reconnecting at its teleported lab position');
 await send('Page.reload');await wait('document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden&&document.getElementById("connection").textContent.includes("WORLD ONLINE")');
 localPlayerId=await evaluate("sessionStorage.getItem('aae-world-presence-v1:main:player')");assert.ok(localPlayerId);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 assert.ok(await evaluate('document.documentElement.scrollWidth<=390'));
 await delay(3100);const before=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');
 const pad=await evaluate('(()=>{const r=document.getElementById("joystick").getBoundingClientRect();return {x:r.x+r.width/2+32,y:r.y+r.height/2}})()');
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pad.x,y:pad.y}]});await delay(450);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(3100);
 assert.ok(await evaluate(`JSON.parse(localStorage.getItem('agent-world-settings-v1')).position.x>${before+15}`),'touch joystick must move the player');
 const released=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');await delay(3100);
 assert.ok(Math.abs((await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x'))-released)<1,'released joystick must stop movement');
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const p=s.players.find(v=>v.player_id===${JSON.stringify(localPlayerId)}),local=JSON.parse(localStorage.getItem('agent-world-settings-v1')).position;window.__lastPresenceState={server:p,local};return !!p&&Math.abs(p.position.x-local.x)<2&&p.animation_state==='idle'})`);
 await screenshot('mobile');
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:780,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base});await wait("document.querySelector('a[href=\"/world\"]')");
 assert.ok(await evaluate('document.documentElement.scrollWidth<=360'),'original Last Seat page must fit a 360px viewport');
 assert.ok(await evaluate("document.querySelector('a[href=\"/world\"]').getBoundingClientRect().width>0"),'world entry must remain visible on mobile');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/compound'});await wait('location.pathname==="/compound"&&document.getElementById("compound-map")');
 await wait("fetch('/api/compound').then(r=>r.json()).then(s=>s.phase==='lobby')");
 await evaluate("fetch('/api/compound/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Browser Compound'})}).then(r=>r.json())");
 await wait("document.getElementById('compound-lobby').textContent.includes('Start round')");
 await evaluate("[...document.querySelectorAll('#compound-lobby button')].find(b=>b.textContent==='Start round').click()");
 await wait("document.getElementById('compound-status').textContent.includes('ROUND')&&fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.length===8&&s.phase==='active')");
 assert.ok(await evaluate("document.getElementById('compound-you').textContent.includes('OBJECTIVE')"),'compound owner should see its private objective');
 assert.equal(await evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.some(p=>p.id!==s.you&&p.role))"),false,'other compound participants must not expose secret roles');
 assert.ok(await evaluate("document.getElementById('compound-map') instanceof HTMLCanvasElement&&document.getElementById('compound-map').width===640"),'compound should render a player-following pixel viewport');
 const compoundBefore=await evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>{const p=s.participants.find(v=>v.id===s.you);return {x:p.position.x,y:p.position.y,agents:s.participants.filter(v=>v.type==='agent').map(v=>v.position)}})");
 await evaluate(`fetch('/api/compound/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:${compoundBefore.x+1},y:${compoundBefore.y}})}).then(r=>r.json())`);
 await wait(`fetch('/api/compound').then(r=>r.json()).then(s=>{const p=s.participants.find(v=>v.id===s.you);return p.position.x===${compoundBefore.x+1}&&p.position.y===${compoundBefore.y}})`);
 await delay(2200);
 assert.ok(await evaluate(`fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.filter(v=>v.type==='agent').some((v,i)=>v.position.x!==${JSON.stringify(compoundBefore.agents)}[i].x||v.position.y!==${JSON.stringify(compoundBefore.agents)}[i].y))`),'autonomous compound participants should physically move');
 await screenshot('compound-round');
 await wait("fetch('/api/compound').then(r=>r.json()).then(s=>s.phase==='finished'&&s.results.at(-1)?.participants.length===8)",25000);
 await wait("!document.getElementById('compound-results').hidden&&document.getElementById('compound-results').textContent.includes('Winners:')");
 assert.equal(await evaluate("!!document.querySelector('#compound-you .compound-action-row')"),false,'finished round must not offer live actions');
 await screenshot('compound-result');
 await screenshot('landing-mobile');assert.deepEqual(errors,[]);
 console.log('PASS world: character, NPC profile, live render loop, Survival combat/inspection, shared RPS/TTT, return navigation, mobile joystick/release, responsive layouts');
}catch(error){failed=true;console.error(error);}
finally{for(const request of pending.values())clearTimeout(request.timer);socket.close();process.exit(failed?1:0);}
