import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listChromeTargets } from './chrome-debug.js';
import { OUTER_CAMPS, OUTER_LOOP } from '../web/dist/world/map.js';
const base=process.env.GAME_URL||'http://localhost:3000',debug=process.env.CHROME_DEBUG_URL||'http://127.0.0.1:9322';
const secondDebug=process.env.CHROME_DEBUG_URL_2;
const targets=await listChromeTargets(debug);
const target=targets.find(t=>t.type==='page')||await(await fetch(debug+'/json/new?'+encodeURIComponent(base),{method:'PUT'})).json();
const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let nextId=0;const pending=new Map(),errors=[];
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(request){clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Browser command timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{let r;try{r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});}catch(error){throw new Error(`${error?.message||error}; expression=${expression.slice(0,240)}`);}if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const wait=async(expression,timeoutMs=15000)=>{for(let i=0;i<Math.ceil(timeoutMs/100);i++){if(await evaluate(expression))return;await delay(100);}const details=await evaluate(`({url:location.href,hint:document.getElementById('world-hint')?.textContent,connection:document.getElementById('connection')?.textContent,entered:sessionStorage.getItem('agent-world-entered'),lab:document.querySelector('#world-lab pre')?.textContent?.slice(0,500),nearest:(()=>{try{const s=JSON.parse(document.querySelector('#world-lab pre').textContent);return s.npcs.map(n=>({name:n.name,distance:Math.round(Math.hypot(n.position.x-s.player.x,n.position.y-s.player.y)),attention:n.attention})).sort((a,b)=>a.distance-b.distance).slice(0,3)}catch{return null}})(),presenceRequests:window.__presenceRequests,canvasLabel:document.getElementById('world-canvas')?.getAttribute('aria-label'),presenceFailures:window.__presenceFailures,lastPresence:window.__lastPresenceState,errors:${JSON.stringify(errors)}})`);details.health=await evaluate("fetch('/api/health').then(r=>r.json()).then(h=>h.presence)");throw new Error('Browser condition timed out: '+expression+'; state='+JSON.stringify(details));};
const waitPosition=async(x,y,tolerance=20)=>{const expression=`(()=>{try{const s=JSON.parse(document.querySelector('#world-lab pre').textContent);return Math.hypot(s.player.x-(${x}),s.player.y-(${y}))<${tolerance}}catch{return false}})()`;await wait(expression);};
const waitCaveReady=async()=>{await wait("location.pathname==='/cave'",10000);await wait("document.body.dataset.caveReady==='1'",10000);};
const screenshot=async name=>{if(process.env.WORLD_SCREENSHOTS!=='1')return;try{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(path.join(os.tmpdir(),`agent-world-${name}.png`),Buffer.from(r.data,'base64'));}catch(error){throw new Error(`Screenshot capture failed for ${name}: ${error?.message||error}`);}};
async function connectSecondBrowser(){
 if(!secondDebug)throw new Error('Second Chrome session is required for Compound multiplayer smoke');
 const secondTargets=await listChromeTargets(secondDebug),secondTarget=secondTargets.find(value=>value.type==='page');if(!secondTarget)throw new Error('Second Chrome page target unavailable');
 const secondSocket=new WebSocket(secondTarget.webSocketDebuggerUrl);await new Promise(resolve=>secondSocket.addEventListener('open',resolve,{once:true}));let id=0;const requests=new Map();
 secondSocket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const request=requests.get(message.id);if(request){clearTimeout(request.timer);requests.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}});
 const secondSend=(method,params={})=>new Promise((resolve,reject)=>{const requestId=++id,timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('Second browser command timed out: '+method));},20000);requests.set(requestId,{resolve,reject,timer});secondSocket.send(JSON.stringify({id:requestId,method,params}));});
 const secondEvaluate=async expression=>{let result;try{result=await secondSend('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});}catch(error){throw new Error(`${error?.message||error}; second expression=${expression.slice(0,240)}`);}if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const secondWait=async(expression,timeoutMs=15000)=>{for(let attempt=0;attempt<Math.ceil(timeoutMs/100);attempt++){if(await secondEvaluate(expression))return;await delay(100);}throw new Error('Second browser condition timed out: '+expression);};
 return{send:secondSend,evaluate:secondEvaluate,wait:secondWait,close:()=>{for(const request of requests.values())clearTimeout(request.timer);secondSocket.close();}};
}
let secondBrowser;
let failed=false;
try{
 await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');
 await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.__presenceRequests=[];const nativeFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(String(args[0]).includes('/presence/')){let body={};try{body=await response.clone().json()}catch{}window.__presenceRequests.push({path:String(args[0]),status:response.status,code:body.code,presence_id:body.presence_id})}return response}"});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base});await wait("document.querySelector('a[href=\"/world\"]')");
 // The plaza auto-joins the shared world on load and that join owns the
 // visitor cookie. Let it finish before the identity-refresh reload so the
 // visitor is not replaced by a second login on this first visit.
 await wait("document.getElementById('connection')?.textContent.includes('HERE')");
 await evaluate("sessionStorage.clear();localStorage.removeItem('agent-world-settings-v1');localStorage.removeItem('agent-world-discoveries-v1')");
 await send('Page.reload',{ignoreCache:true});
 await wait("document.getElementById('connection')?.textContent.includes('HERE')");
 await wait("document.getElementById('character-dialog')?.open");
 assert.ok(await evaluate("document.querySelector('#character-dialog h2')?.textContent.includes('Step into the live world')"),'the intro must greet returning visitors on every world load');
 const googleIntro=await evaluate("(()=>{const button=document.getElementById('intro-google'),note=document.getElementById('intro-auth-note');return {text:button?.textContent||'',disabled:button?.disabled,note:note?.textContent||''}})()");
 assert.ok(googleIntro.text.includes('Continue with Google'),'the intro must offer a Google saved-instance sign-in');
 assert.ok(googleIntro.disabled?/not configured|Checking/.test(googleIntro.note):googleIntro.note.includes('Sign in with Google'),'the Google button must explain its configured or guest-only state');
 await wait('document.getElementById("character-preview")&&document.querySelectorAll("#character-body-swatches button").length===6&&document.querySelectorAll("#character-hair-colors button").length===6&&document.querySelectorAll("#character-outfit-colors button").length===6');
 assert.ok(await evaluate('getComputedStyle(document.getElementById("character-preview")).imageRendering==="pixelated"'),'the creator preview must stay pixel-perfect');
 assert.equal(await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).appearance.body'),'body_brown','new visitors start with the starter kit appearance');
 const focusedSwatch=await evaluate('(()=>{const b=document.querySelectorAll("#character-body-swatches button")[5];b.focus();return b.dataset.value})()');
 await evaluate('document.querySelectorAll("#character-body-swatches button")[5].click()');
 assert.equal(await evaluate('document.activeElement?.dataset.value'),focusedSwatch,'changing a skin tone must preserve keyboard focus');
 assert.equal(await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).appearance.body'),'body_tan','appearance choices persist immediately');
 await evaluate('document.getElementById("character-hair-next").click();document.querySelectorAll("#character-hair-colors button")[4].click();document.getElementById("character-outfit-next").click();document.querySelectorAll("#character-outfit-colors button")[2].click();document.getElementById("character-accessory-next").click()');
 const chosenAppearance=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).appearance');
 assert.equal(chosenAppearance.hair,'hair_buzz_red');assert.equal(chosenAppearance.outfit,'outfit_jacket_forest');assert.equal(chosenAppearance.body,'body_tan');
 await evaluate("window.__presenceFailures=[];const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).includes('/presence/')&&!response.ok){const body=await response.clone().json().catch(()=>({}));window.__presenceFailures.push({path:String(args[0]),status:response.status,code:body.code})}return response}");
 await evaluate('document.getElementById("enter-world").click()');await screenshot('plaza');
 await wait('!document.getElementById("world-canvas").getAttribute("aria-label").includes("0 visiting agents in the plaza")');
 await wait("!document.getElementById('world-live').hidden&&document.getElementById('world-live').textContent.startsWith('LIVE ·')");
 assert.equal(await evaluate('!!document.querySelector(".world-header a[href=\\"/compound\\"],.world-header a[href=\\"/arena\\"]")'),false,'Arena and Compound must not return as global header buttons');
 assert.ok(await evaluate('(()=>{const text=document.querySelector(".world-legend")?.textContent||"";return text.includes("ARENA")&&text.includes("COMPOUND")})()'),'the world must still show where Arena and Compound are');
 assert.ok(await evaluate('(()=>{const p=document.getElementById("world-minimap"),c=document.getElementById("minimap-canvas"),r=p?.getBoundingClientRect();return !!p&&!!c&&!p.hidden&&r.width>120&&r.width<=160&&r.right<=1280&&c.width===416&&c.height===300})()'),'desktop minimap must load at a compact size with a cached pixel canvas');
 assert.equal(await evaluate("document.getElementById('minimap-canvas').dataset.outer"),'0','undiscovered outer landmarks must stay hidden from the minimap');
 assert.ok((await evaluate("document.getElementById('minimap-journal').textContent")).includes('DISCOVERIES 0/'),'fresh visitors start with an empty discovery journal count');
 assert.equal(await evaluate("document.getElementById('minimap-region').textContent"),'CITY CENTER');
 assert.ok(await evaluate("document.getElementById('minimap-canvas').dataset.player.includes(',')"),'minimap publishes the current player marker position');
 await evaluate("document.getElementById('minimap-toggle').click()");
 await wait("document.getElementById('minimap-toggle').getAttribute('aria-expanded')==='false'&&document.getElementById('world-minimap').classList.contains('is-collapsed')");
 await evaluate("document.getElementById('minimap-toggle').click()");
 await wait("document.getElementById('minimap-toggle').getAttribute('aria-expanded')==='true'");
 await wait("fetch('/api/health').then(r=>r.json()).then(h=>h.presence.active_players>=1)");
 let localPlayerId=await evaluate("window.__presenceRequests.findLast(value=>value.presence_id)?.presence_id");assert.ok(localPlayerId);
 await evaluate("document.getElementById('avatar-change').click()");await wait("document.getElementById('character-dialog').open");
 await evaluate('document.getElementById("character-randomize").click()');
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)})?.appearance?.hair)`);
 const changedAppearance=await evaluate(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)}).appearance)`);
 assert.ok(changedAppearance&&changedAppearance.version===1&&changedAppearance.body&&changedAppearance.hair&&changedAppearance.outfit,'appearance changes must reach the server immediately');
 await evaluate("document.getElementById('character-close').click()");
 secondBrowser=await connectSecondBrowser();await secondBrowser.send('Runtime.enable');await secondBrowser.send('Page.enable');
 await secondBrowser.send('Page.navigate',{url:base+'/world'});
 await secondBrowser.wait("document.getElementById('connection')?.textContent.includes('HERE')");
 const secondWorldJoin=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:'visitor_ember',position:{x:560,y:480},direction:'down',activity:'Exploring'})}).then(async response=>({status:response.status,...await response.json()}))");
 assert.equal(secondWorldJoin.status,201,'the independent browser should receive its own world actor');assert.notEqual(secondWorldJoin.presence_id,localPlayerId);
 await wait("document.getElementById('connection').textContent.includes('2 HERE')&&document.getElementById('world-canvas').getAttribute('aria-label').includes('1 other visitor online')");
 await secondBrowser.wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const p=s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)});return p?.appearance?.hair===${JSON.stringify(changedAppearance.hair)}&&p?.appearance?.body===${JSON.stringify(changedAppearance.body)}})`);

 await screenshot('multiplayer-plaza');
 const guestBefore=await secondBrowser.evaluate("fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.find(p=>p.player_id!=="+JSON.stringify(localPlayerId)+").position.x)");
 await delay(80);assert.equal(await secondBrowser.evaluate(`fetch('/api/worlds/main/presence/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({position:{x:${guestBefore+12},y:480},direction:'right',animation_state:'walk'})}).then(r=>r.status)`),200);
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.some(p=>p.player_id!==${JSON.stringify(localPlayerId)}&&p.position.x>${guestBefore+5}))`);
 await secondBrowser.send('Page.reload',{ignoreCache:true});
 await secondBrowser.wait("document.getElementById('connection')?.textContent.includes('2 HERE')");
 await wait("document.getElementById('connection').textContent.includes('2 HERE')");
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.length)"),2,'a refresh reuses the visitor identity instead of leaving a ghost');
 // Both real browsers are now in the plaza. Browser B gets a character so its
 // own quick-chat selector can be exercised too.
 await secondBrowser.wait('document.getElementById("character-dialog")?.open',8000);
 await secondBrowser.evaluate("document.getElementById('enter-world').click()");
 await secondBrowser.wait('!document.getElementById("character-dialog").open');
 await wait('!document.getElementById("quick-chat-prompt").hidden');
 // A holds E: the directional selector appears instead of interacting.
 await evaluate("document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await delay(520);
 await wait('!document.getElementById("quick-chat").hidden&&document.querySelectorAll(".quick-chat__option").length===4');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".quick-chat__option")].map(option=>[option.dataset.phrase,option.dataset.direction])'),[['hi','up'],['follow','right'],['nice','down'],['wait','left']],'the selector opens on the social page with four approved directions');
 assert.equal(await evaluate('document.getElementById("quick-chat-page").textContent'),'SOCIAL ▸');
 assert.ok(await evaluate('(()=>{const r=document.getElementById("quick-chat-wheel").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'),'the desktop selector stays inside the viewport');
 // Q switches to the game page without sending a phrase; directions remap to
 // the challenge phrases. Switching back restores the social page.
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}))");
 await wait('document.querySelector(".quick-chat__option[data-phrase=\\"ttt\\"]")');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".quick-chat__option")].map(option=>[option.dataset.phrase,option.dataset.direction])'),[['ttt','up'],['rps','right'],['arena','down'],['explore','left']],'the game page keeps the four approved directions');
 assert.equal(await evaluate('document.getElementById("quick-chat-page").textContent'),'GAME ▸');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}))");
 await wait('document.querySelector(".quick-chat__option[data-phrase=\\"hi\\"]")');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
 await wait('document.getElementById("quick-chat").hidden');
 await wait('document.getElementById("quick-chat-bubbles").textContent.includes("nice one")');
 await secondBrowser.wait('document.getElementById("quick-chat-bubbles").textContent.includes("nice one")',8000);
 await wait('!document.querySelector(".quick-chat__bubble")',6000);
 await secondBrowser.wait('!document.querySelector(".quick-chat__bubble")',6000);
 // B holds E and answers with the left direction.
 await secondBrowser.wait("document.getElementById('connection').textContent.includes('WORLD ONLINE')",8000);
 await secondBrowser.wait("!document.getElementById('quick-chat-prompt').hidden",8000);
 await secondBrowser.evaluate("document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await secondBrowser.wait('!document.getElementById("quick-chat").hidden',5000);
 await secondBrowser.evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))");
 await wait('document.getElementById("quick-chat-bubbles").textContent.includes("wait here")',8000);
 // Rapid second send inside the cooldown is rejected and must not stack bubbles.
 const spamQuickChat=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/quick-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase_id:'nice'})}).then(async response=>({status:response.status,...await response.json()}))");
 assert.equal(spamQuickChat.status,429,'quick chat spam must be rate limited');
 assert.equal(spamQuickChat.code,'QUICK_CHAT_RATE_LIMITED');
 assert.equal(await evaluate('document.querySelectorAll(".quick-chat__bubble").length'),1,'a rejected send must not create another bubble');
 await wait('!document.querySelector(".quick-chat__bubble")',6000);
 // Two real browsers: a TTT challenge is accepted into one shared match, then
 // each returns to its own saved world position.
 const mainHome=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 const guestHome=await secondBrowser.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 await evaluate("document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await delay(520);
 await wait('!document.getElementById("quick-chat").hidden');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}))");
 await wait('document.querySelector(".quick-chat__option[data-phrase=\\"ttt\\"]")');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))");
 await wait('!document.getElementById("challenge-outgoing").hidden&&document.getElementById("quick-chat-bubbles").textContent.includes("tic-tac-toe?")',8000);
 await secondBrowser.wait('!document.getElementById("challenge-prompt").hidden&&document.getElementById("challenge-game").textContent.includes("TIC-TAC-TOE")',8000);
 assert.ok(await secondBrowser.evaluate('document.getElementById("challenge-from").textContent.trim().length>0'),'the prompt names the challenger');
 assert.ok(await secondBrowser.evaluate('(()=>{const p=document.getElementById("challenge-prompt").getBoundingClientRect(),a=document.getElementById("challenge-accept").getBoundingClientRect(),d=document.getElementById("challenge-decline").getBoundingClientRect();return p.width<300&&p.left>=0&&p.right<=innerWidth&&a.height>=30&&d.height>=30})()'),'the desktop prompt stays compact');
 await secondBrowser.evaluate('document.getElementById("challenge-accept").click()');
 await wait("location.pathname.startsWith('/duel/')",10000);
 await secondBrowser.wait("location.pathname.startsWith('/duel/')",10000);
 assert.equal(await evaluate('location.pathname'),await secondBrowser.evaluate('location.pathname'),'both browsers must resolve to the same authoritative match');
 await wait('!document.getElementById("duel-board").hidden&&document.querySelectorAll(".duel-cell").length===9',10000);
 await secondBrowser.wait('!document.getElementById("duel-board").hidden&&document.querySelectorAll(".duel-cell").length===9',10000);
 await evaluate('document.querySelector(".duel-cell[data-cell=\\"0\\"]").click()');
 await secondBrowser.wait('document.querySelector(".duel-cell[data-cell=\\"0\\"]").textContent==="X"',10000);
 await secondBrowser.evaluate('document.querySelector(".duel-cell[data-cell=\\"3\\"]").click()');
 await wait('document.querySelector(".duel-cell[data-cell=\\"3\\"]").textContent==="O"',10000);
 await evaluate('document.querySelector(".duel-cell[data-cell=\\"1\\"]").click()');
 await secondBrowser.wait('document.querySelector(".duel-cell[data-cell=\\"1\\"]").textContent==="X"',10000);
 await secondBrowser.evaluate('document.querySelector(".duel-cell[data-cell=\\"4\\"]").click()');
 await wait('document.querySelector(".duel-cell[data-cell=\\"4\\"]").textContent==="O"',10000);
 await evaluate('document.querySelector(".duel-cell[data-cell=\\"2\\"]").click()');
 await wait('!document.getElementById("duel-result").hidden&&document.getElementById("duel-result").textContent.includes("YOU WIN")',10000);
 await secondBrowser.wait('!document.getElementById("duel-result").hidden&&document.getElementById("duel-status").textContent.includes("YOU LOST")',10000);
 assert.equal(await evaluate('document.querySelectorAll(".duel-cell.is-winning").length'),3,'the winning line is emphasised without confetti');
 await screenshot('duel-ttt');
 await evaluate('document.getElementById("duel-return").click()');
 await secondBrowser.evaluate('document.getElementById("duel-return").click()');
 await wait("location.pathname==='/world'",10000);
 await secondBrowser.wait("location.pathname==='/world'",10000);
 await wait('document.getElementById("character-dialog")?.open',10000);
 await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 await secondBrowser.wait('document.getElementById("character-dialog")?.open',10000);
 await secondBrowser.evaluate('document.getElementById("enter-world").click()');await secondBrowser.wait('!document.getElementById("character-dialog").open');
 const mainReturn=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 const guestReturn=await secondBrowser.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 assert.ok(Math.hypot(mainReturn.x-mainHome.x,mainReturn.y-mainHome.y)<1,'the challenger returns to its own saved coordinate');
 assert.ok(Math.hypot(guestReturn.x-guestHome.x,guestReturn.y-guestHome.y)<1,'the target returns to its own saved coordinate');
 assert.notDeepEqual(mainReturn,guestReturn,'the two visitors keep separate saved positions');
 // RPS uses the same challenge plumbing and one shared pick session.
 await delay(4200);
 await evaluate("document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await delay(520);
 await wait('!document.getElementById("quick-chat").hidden');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}))");
 await wait('document.querySelector(".quick-chat__option[data-phrase=\\"rps\\"]")');
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
 await secondBrowser.wait('!document.getElementById("challenge-prompt").hidden&&document.getElementById("challenge-game").textContent.includes("ROCK PAPER SCISSORS")',8000);
 await secondBrowser.evaluate('document.getElementById("challenge-accept").click()');
 await wait("location.pathname.startsWith('/duel/')",10000);
 await secondBrowser.wait("location.pathname.startsWith('/duel/')",10000);
 await wait('!document.getElementById("duel-actions").hidden&&document.querySelectorAll(".duel-actions button").length===3',10000);
 await secondBrowser.wait('!document.getElementById("duel-actions").hidden&&document.querySelectorAll(".duel-actions button").length===3',10000);
 await evaluate('document.querySelector(".duel-actions button[data-pick=\\"rock\\"]").click()');
 await secondBrowser.evaluate('document.querySelector(".duel-actions button[data-pick=\\"scissors\\"]").click()');
 await wait('!document.getElementById("duel-result").hidden&&document.getElementById("duel-result").textContent.includes("YOU WIN")',10000);
 await secondBrowser.wait('!document.getElementById("duel-result").hidden&&document.getElementById("duel-status").textContent.includes("YOU LOST")',10000);
 // Anyone can open the settled match read-only. The spectator page has no seat
 // and no enabled move or pick control.
 const rpsDuelPath=await evaluate('location.pathname');
 await send('Page.navigate',{url:base+rpsDuelPath+'?spectate=1'});
 await wait('document.getElementById("duel-mode").textContent.includes("SPECTATING")',10000);
 await wait('!document.getElementById("duel-result").hidden&&document.getElementById("duel-status").textContent.includes("WINS")',10000);
 assert.equal(await evaluate('document.querySelectorAll(".duel-actions button:not([disabled]),.duel-cell:not([disabled])").length'),0,'a spectator has no enabled move or pick control');
 assert.equal(await evaluate('document.getElementById("duel-return").getAttribute("href")'),'/arena','spectators return to the Arena');
 assert.equal(await evaluate('document.getElementById("duel-players").textContent.includes("PLAYER A")&&document.getElementById("duel-players").textContent.includes("PLAYER B")'),true,'spectators see both participants, not a seat');
 await screenshot('duel-spectate');
 await send('Page.navigate',{url:base+'/world?return=duel'});
 await secondBrowser.evaluate('document.getElementById("duel-return").click()');
 await wait("location.pathname==='/world'",10000);
 await secondBrowser.wait("location.pathname==='/world'",10000);
 await wait('document.getElementById("character-dialog")?.open',10000);
 await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 await secondBrowser.wait('document.getElementById("character-dialog")?.open',10000);
 await secondBrowser.evaluate('document.getElementById("enter-world").click()');await secondBrowser.wait('!document.getElementById("character-dialog").open');
 const mainRpsReturn=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 const guestRpsReturn=await secondBrowser.evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 assert.ok(Math.hypot(mainRpsReturn.x-mainHome.x,mainRpsReturn.y-mainHome.y)<1,'RPS also returns the challenger to its own coordinate');
 assert.ok(Math.hypot(guestRpsReturn.x-guestHome.x,guestRpsReturn.y-guestHome.y)<1,'RPS also returns the target to its own coordinate');
 // Rejoin B far away: the affordance disappears and the server refuses the send.
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)"),200);
 const farJoin=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:'visitor_atlas',position:{x:2000,y:1600},direction:'down',activity:'Exploring'})}).then(async response=>({status:response.status,...await response.json()}))");
 assert.equal(farJoin.status,201);
 await wait('document.getElementById("quick-chat-prompt").hidden&&document.getElementById("quick-chat-open").hidden',8000);
 const distantQuickChat=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/quick-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase_id:'nice'})}).then(async response=>({status:response.status,...await response.json()}))");
 assert.equal(distantQuickChat.status,409,'a distant visitor cannot quick chat');
 assert.equal(distantQuickChat.code,'NO_NEARBY_HUMAN');
 assert.equal(await evaluate('document.querySelectorAll(".quick-chat__bubble").length'),0,'a distant quick chat is never rendered');
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)"),200,'the second visitor should be able to leave');
 await secondBrowser.send('Page.navigate',{url:base+'/post'});await secondBrowser.wait('location.pathname.startsWith("/post")');
 await wait("document.getElementById('connection').textContent.includes('1 HERE')&&document.getElementById('world-canvas').getAttribute('aria-label').includes('0 other visitors online')");
 // The shared world keeps the current public Arena roster visible in the
 // plaza while they wait for the next match.  Assert that the roster is
 // present instead of expecting the old empty-plaza behavior.
 await wait('!document.getElementById("world-canvas").getAttribute("aria-label").includes("0 visiting agents in the plaza")');
 await wait('document.activeElement?.id==="world-canvas"');
 await evaluate('window.__worldRafTicks=0;const worldRafProbe=()=>{window.__worldRafTicks++;requestAnimationFrame(worldRafProbe)};requestAnimationFrame(worldRafProbe)');
 await delay(250);assert.ok(await evaluate('window.__worldRafTicks>5'),'world animation loop must remain live after character entry');
 const focusedAgent=await evaluate('(()=>{document.getElementById("agent-directory").closest("details").open=true;const b=document.querySelector("#agent-directory button");b.focus();return b.id})()');
 await delay(5200);assert.equal(await evaluate('document.activeElement?.id'),focusedAgent,'agent refresh must preserve keyboard focus');
 await evaluate(`document.getElementById(${JSON.stringify(focusedAgent)}).click()`);
 await wait('document.getElementById("interaction-dialog").open');
 const profileText=await evaluate('document.getElementById("interaction-content").textContent');
 assert.ok(profileText.includes('Statistics from')&&(profileText.includes('cumulative all-time arena results')||profileText.includes('retained RPS, Tic-Tac-Toe, and Survival runs')),'agent profile must show its authoritative statistics scope');
 await screenshot('profile');await evaluate('document.getElementById("interaction-close").click()');
 // Arena and Compound are entered through their physical doors in the world.
 // The lab teleport keeps the headless path deterministic while still
 // exercising the real interaction and navigation handoff.
 await send('Page.navigate',{url:base+'/labs/world'});
 await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
 await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 // Farm guidance must be local: the plot is a known minimap destination, but
 // its contextual arrow/help appears only within ~20 in-world metres (320 units).
 const farmTile=await evaluate("fetch('/api/world/farm').then(r=>r.json()).then(s=>s.tiles[0]||null)");
 assert.ok(farmTile&&Number.isFinite(farmTile.position.x),'the world has a farm plot to probe');
 const farmSign=farmTile.anchor==='west-road'?-1:1;
 const farmAt=distance=>({x:Math.round(farmTile.position.x+16*distance*farmSign),y:Math.round(farmTile.position.y)});
 await evaluate(`window.__worldTeleport(${JSON.stringify(farmAt(21))})`);
 await wait(`document.getElementById('minimap-canvas').dataset.player.split(',')[0]==='${farmAt(21).x}'`);
 await wait("document.getElementById('world-canvas').dataset.farmGuide===''");
 await evaluate(`window.__worldTeleport(${JSON.stringify(farmAt(19))})`);
 await wait(`document.getElementById('minimap-canvas').dataset.player.split(',')[0]==='${farmAt(19).x}'`);
 await wait("document.getElementById('world-canvas').dataset.farmGuide.length>0");
 await evaluate(`window.__worldTeleport(${JSON.stringify(farmAt(21))})`);
 await wait("document.getElementById('world-canvas').dataset.farmGuide===''");
 await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Enter Arena').click()");
 await waitPosition(928,674);
 await wait('!document.getElementById("interact").disabled');
 await evaluate('document.getElementById("interact").click()');
 await wait('location.pathname==="/arena"&&document.querySelectorAll(".room-card").length===4');await screenshot('desktop');await screenshot('lobby');
 // The public board merges only server data: human duels plus real tables.
 const publicBoard=await evaluate("fetch('/api/world/duels').then(r=>r.json())");
 assert.ok(Array.isArray(publicBoard.live)&&Array.isArray(publicBoard.recent),'the Arena board reads the public duel list');
 assert.ok(Array.isArray(publicBoard.recent),'completed shared duels use the public recent list');
 assert.equal(publicBoard.live.some(duel=>JSON.stringify(duel).includes('visitorId')),false,'public duels never expose visitor sessions');
 await wait(`Promise.all([
   fetch('/api/world/duels').then(r=>r.json()),
   fetch('/api/arena/history').then(r=>r.json()),
 ]).then(([duels,history])=>{
   const rows=[
     ...duels.recent.filter(d=>d.status!=='expired').map(d=>({stamp:d.finished_at||d.created_at,human:true})),
     ...history.matches.map(m=>({stamp:m.completedAt,human:false})),
   ].sort((a,b)=>String(b.stamp).localeCompare(String(a.stamp))).slice(0,8);
   const expected=rows.filter(row=>row.human).length;
   const actual=document.querySelectorAll('#recent-list .recent-row__tag[data-source="human"]').length;
   return actual===expected;
 })`,10000);
 await wait('document.querySelectorAll("#live-matches .live-match").length>0||!document.getElementById("live-empty").hidden');
 assert.ok(await evaluate('document.querySelector("#live-matches .live-match")?document.querySelectorAll("#live-matches .live-match__watch").length>0:document.getElementById("live-empty").textContent.includes("NO LIVE HUMAN DUELS")'),'live rows expose a WATCH link or the honest empty state');
 assert.ok(await evaluate('document.querySelector(".survival-map-key")&&document.getElementById("agents")&&document.getElementById("rooms-view")'),'tactical map must retain the existing room and agent sections');
 await wait('document.querySelectorAll(".room-player").length>=4&&document.querySelectorAll(".room-versus").length>=2');
 assert.ok(await evaluate('[...document.querySelectorAll(".room-card")].filter(card=>card.querySelectorAll(".room-player").length===2).every(card=>card.querySelector(".room-versus")?.textContent==="VS")'),'room cards must visually group each pair around a VS marker');
 assert.ok(await evaluate('document.querySelector(".arena-stage")&&document.querySelector(".arena-stage").compareDocumentPosition(document.getElementById("cumulative-stats"))&Node.DOCUMENT_POSITION_FOLLOWING'),'the live Arena stage must precede lifetime statistics');
 assert.ok(await evaluate('document.querySelector(".arena-stage .scope--live")&&document.querySelector(".arena-cumulative .scope--lifetime")'),'live and lifetime scopes must be labelled distinctly');
 assert.ok(await evaluate('document.querySelectorAll(".room-card img[src*=\\"/assets/agents/\\"]").length>=4'),'room cards must show real agent sprites');
 assert.ok(await evaluate('getComputedStyle(document.querySelector(".room-card img")).imageRendering==="pixelated"'),'agent sprites must stay pixel-crisp');
 await wait('!document.getElementById("survival-view").hidden&&document.getElementById("survival-overlay").hidden&&document.getElementById("survival-status").textContent.includes("LIVE")');
 await wait("fetch('/api/survival/current').then(r=>r.json()).then(s=>s.agents.length===20&&s.events.some(e=>e.type==='AttackLanded'))");
 // Agents are interpolated between snapshots, so a click at raw snapshot
 // coordinates can miss. Sweep a small offset grid around real agents to
 // exercise the actual tactical-map hit test deterministically.
 await evaluate(`fetch('/api/survival/current').then(r=>r.json()).then(s=>{
  const c=document.getElementById('survival-field'),r=c.getBoundingClientRect(),scale=Math.min(r.width/s.map.width,r.height/s.map.height);
  const offsets=[0,-10,10,-20,20,-30,30];
  for(const a of s.agents){
   if(a.status==='eliminated'||a.status==='spectating')continue;
   for(const dx of offsets)for(const dy of offsets){
    const cx=r.left+(r.width-s.map.width*scale)/2+(a.x+dx)*scale;
    const cy=r.top+(r.height-s.map.height*scale)/2+(a.y+dy)*scale;
    c.dispatchEvent(new PointerEvent('pointerdown',{clientX:cx,clientY:cy,bubbles:true}));
    if(document.getElementById('survival-inspector-body').textContent.includes('HP:'))return;
   }
  }
  // Fallback: sweep the visible map in case interpolation drifted an agent
  // further than the sampled offsets.
  if(!document.getElementById('survival-inspector-body').textContent.includes('HP:')){
   for(let y=r.top+4;y<r.bottom-4;y+=10)for(let x=r.left+4;x<r.right-4;x+=10){
    c.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true}));
    if(document.getElementById('survival-inspector-body').textContent.includes('HP:'))return;
   }
  }
 })`);
 await wait('document.getElementById("survival-inspector-title").textContent.length>0&&document.getElementById("survival-inspector-body").textContent.includes("HP:")');
 assert.ok(await evaluate('document.getElementById("survival-inspector-body").textContent.includes("Strategy:")'),'Survival inspection must use server-authoritative agent state');
 await wait('document.querySelectorAll("#survival-roster .roster-chip").length>=2');
 assert.ok(await evaluate('[...document.querySelectorAll("#survival-roster .roster-chip")].every(chip=>chip.querySelector("img")?.src.includes("/assets/agents/")&&chip.querySelector("i b"))'),'living participant chips must show real sprites and health bars');
 await wait('document.querySelectorAll("#arena-feed-list .feed-item").length>0');
 assert.ok(await evaluate('[...document.querySelectorAll("#arena-feed-list .feed-item")].every(item=>item.dataset.kind&&item.querySelector(".feed-item__text")?.textContent.trim().length>0)'),'the live feed must only render real server events');
 await wait('[...document.querySelectorAll("#arena-feed-list .feed-item")].every(item=>!item.classList.contains("is-entering")&&getComputedStyle(item).opacity==="1")');
 assert.ok(await evaluate('getComputedStyle(document.querySelector("#arena-feed-list .feed-item")).opacity==="1"'),'feed items must settle at full opacity after entering');
 assert.ok(await evaluate('document.querySelectorAll("#arena-feed-list .feed-item").length<=8'),'the feed must keep a bounded history');
 await wait('document.getElementById("survival-result").hidden||document.getElementById("survival-result").classList.contains("is-visible")',5000);
 assert.ok(await evaluate('document.getElementById("survival-result").hidden||document.getElementById("survival-result").classList.contains("is-visible")'),'the result banner may only appear for a finished snapshot');
 for(const [id,game] of [['rps-1','rps'],['ttt-1','tictactoe']]){
  await send('Page.navigate',{url:base+`/arena/${game}/${id}`});
  await wait('document.getElementById("run-status")?.textContent.includes("SHARED")');
  await wait('document.getElementById("match-title").textContent.includes("game-")');
  const spectatorCount=`fetch('/api/arena/rooms').then(r=>r.json()).then(v=>v.rooms.find(room=>room.id===${JSON.stringify(id)})?.spectators)`;
  await wait(`${spectatorCount}.then(count=>count===1)`);
  assert.ok(await evaluate('document.querySelector(".bout-stage")?.contains(document.getElementById("match-title"))'),'the active match must own the central bout stage');
  assert.equal(await evaluate('document.querySelectorAll(".bout-stage .duelist img[src*=\\"/assets/agents/\\"]").length'),2,'both duelists must show their real sprites');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".duelist img")).imageRendering'),'pixelated');
  assert.equal(await evaluate('document.querySelectorAll("#phases [data-phase]").length'),4,'the RPS/TTT phase strip must stay intact');
  assert.ok(await evaluate('["live","winner","draw"].includes(document.getElementById("match-result").dataset.state)'),'the result area must always expose a real match state');
  if(game==='tictactoe'){
    await wait('document.querySelectorAll("#ttt-board span").length===9');
    assert.ok(await evaluate('document.getElementById("ttt-board").getBoundingClientRect().width>=300'),'the tic-tac-toe board must be large enough to read');
    await screenshot('tictactoe');
  }
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
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base+'/arena'});
 await wait('document.querySelectorAll(".room-card").length===4');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=390'),true,'390px Arena must not overflow horizontally');
 assert.ok(await evaluate('document.querySelector(".arena-stage").getBoundingClientRect().top<document.getElementById("cumulative-stats").getBoundingClientRect().top'),'mobile keeps the live match above lifetime stats');
 await screenshot('arena-mobile-390');
 await send('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate('document.documentElement.scrollWidth<=430'),true,'430px Arena must not overflow horizontally');
 await screenshot('arena-mobile-430');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await send('Page.reload');
 await wait('document.querySelectorAll(".room-card").length===4');
 await wait('document.querySelectorAll("#arena-feed-list .feed-item").length>0');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".arena-crowd i")).animationName'),'none','reduced motion must stop the ambient Arena rig');
 assert.ok(await evaluate('[...document.querySelectorAll("#arena-feed-list .feed-item")].every(item=>getComputedStyle(item).transform==="none")'),'reduced motion must not offset feed items');
 await send('Emulation.setEmulatedMedia',{features:[]});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/arena'});
 await wait('location.pathname==="/arena"&&document.querySelectorAll(".room-card").length===4');
 assert.equal(await evaluate("document.querySelector('a[href=\"/world?return=arena\"]')?.getAttribute('href')"),'/world?return=arena');
 await evaluate("localStorage.setItem('agent-world-settings-v1',JSON.stringify({version:1,avatar:'visitor_ember',position:{x:928,y:674},muted:true}))");
 await send('Page.navigate',{url:base+'/world?return=arena'});await wait('location.pathname==="/world"&&document.getElementById("character-dialog").open');
 assert.ok(await evaluate("document.querySelector('#character-dialog h2')?.textContent.includes('Step into the live world')"),'a returning visitor still sees the intro');
 await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open&&document.activeElement?.id==="world-canvas"');
 await wait('document.getElementById("connection").textContent.includes("WORLD ONLINE")');
 assert.ok(await evaluate('(()=>{const r=document.getElementById("world-minimap").getBoundingClientRect();return r.width>0&&r.width<=160})()'),'the desktop local map must stay compact');
 await wait("document.getElementById('minimap-canvas').dataset.locationLabels?.includes('ARENA')");
 assert.deepEqual((await evaluate("document.getElementById('minimap-canvas').dataset.locationLabels.split(',')")),['ARENA','CMPD','MKT','LAB','AGY','VLT'],'the compact map must keep its public location names');
 await wait('document.querySelectorAll(".world-minimap__label").length===6');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".world-minimap__label")].map(node=>node.textContent)'),['ARENA','CMPD','MKT','LAB','AGY','VLT'],'the compact map renders all six destination labels');
 assert.ok(await evaluate('(()=>{const m=document.getElementById("world-minimap").getBoundingClientRect();return [...document.querySelectorAll(".world-minimap__label")].every(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.left>=m.left-1&&r.right<=m.right+1&&r.top>=m.top-1&&r.bottom<=m.bottom+1&&getComputedStyle(node).fontSize!=="0px"})})()'),'destination labels stay inside the compact map with readable text');
 assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position'),{x:928,y:674},'returning from Arena must restore the saved world position');
 await wait("fetch('/api/arena/statistics').then(r=>r.json()).then(s=>s.totals.matches>0)");
 await send('Page.navigate',{url:base+'/labs/world'});await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
 await wait('document.getElementById("character-dialog").open');await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Open arena statistics').click()");
 await waitPosition(560,790);
 await wait('!document.getElementById("interact").disabled');
 await evaluate("window.__researchStats=null;window.__presenceFailures=[];const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).includes('/api/arena/statistics'))window.__researchStats=await response.clone().json();if(String(args[0]).includes('/presence/')&&!response.ok){const body=await response.clone().json().catch(()=>({}));window.__presenceFailures.push({path:String(args[0]),status:response.status,code:body.code})}return response}");
 await evaluate('document.getElementById("interact").click()');
 await wait('document.getElementById("interaction-dialog").open&&document.getElementById("interaction-content").textContent.includes("Latest match results")');
 const actualMatches=await evaluate('window.__researchStats.totals.matches');
 const researchText=await evaluate('document.getElementById("interaction-content").textContent');
 assert.ok(researchText.includes('Completed record ·')&&researchText.includes(`${actualMatches}Completed matches`),`Research House should display the authoritative completed-match count (${actualMatches})`);
 await wait("document.querySelector('#research-live')?.textContent.includes('Survival')&&!document.querySelector('#research-live')?.textContent.includes('Loading current server match state')");
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
 await wait('document.getElementById("character-dialog").open');await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 await wait("(()=>{const value=document.querySelector('#world-lab pre').textContent;return value&&JSON.parse(value).npcs.length>=3})()");
 await evaluate("window.__npcBefore=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs");
 await wait("(()=>{const after=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs,before=new Map(window.__npcBefore.map(n=>[n.id,n.position]));return after.filter(n=>{const old=before.get(n.id);return old&&Math.hypot(n.position.x-old.x,n.position.y-old.y)>8}).length>=2})()");
 const npcMovement=await evaluate("(()=>{const after=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs,before=new Map(window.__npcBefore.map(n=>[n.id,n.position]));return after.map(n=>{const old=before.get(n.id);return {id:n.id,distance:old?Math.hypot(n.position.x-old.x,n.position.y-old.y):-1,state:n.activityState}})})()");
 assert.ok(npcMovement.filter(value=>value.distance>8).length>=2,`several canonical NPCs must change world coordinates: ${JSON.stringify(npcMovement)}`);
 // Stand somewhere without another interactable so the nearby target is the NPC.
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(button=>button.textContent==='Walk probe: west').click()");
 await waitPosition(90,430);
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(button=>button.textContent==='Offer nearest NPC thought').click()");
 const talkingAgent=await evaluate("window.__labThoughtAgentName");
 assert.ok(talkingAgent,'the lab thought control must report the agent it pinned');
 await wait(`JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.some(n=>n.name===${JSON.stringify(talkingAgent)}&&n.attention)`);
 await screenshot('npc-attention');
 await wait("!document.getElementById('interact').disabled&&document.getElementById('world-hint').textContent.includes('Talk to')");
 await evaluate("document.getElementById('interact').click()");
 await wait(`document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent===${JSON.stringify(talkingAgent)}&&document.querySelector('.agent-shared-thought')?.textContent.includes('CURRENT THOUGHT')`);
 await wait("!document.getElementById('world-live').textContent.includes('CURRENT THOUGHT')&&document.getElementById('world-live').textContent.startsWith('LIVE ·')");
 await wait("JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.some(n=>n.name==="+JSON.stringify(talkingAgent)+"&&!n.attention)");
 await screenshot('npc-dialogue');
 await evaluate("document.getElementById('interaction-close').click()");
 await wait("!document.getElementById('interaction-dialog').open&&!document.getElementById('world-live').hidden&&document.getElementById('world-live').textContent.startsWith('LIVE ·')");
 await evaluate("window.__talkPosition=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.find(n=>n.name==="+JSON.stringify(talkingAgent)+").position");
 // Personal thought state is client-local; authoritative movement continues
 // independently and every visitor still sees the same canonical position.
 await wait("(()=>{const n=JSON.parse(document.querySelector('#world-lab pre').textContent).npcs.find(n=>n.name==="+JSON.stringify(talkingAgent)+");return !n||!n.attention})()",15000);
 // Developer probes start just inside each former edge. Walking through those
 // coordinates exercises the real input, collision, camera and canvas paths.
 const walkProbe=async(label,key,axis,threshold,screenshotName)=>{
  await evaluate(`(()=>{const button=[...document.querySelectorAll('#world-lab button')].find(value=>value.textContent===${JSON.stringify(`Walk probe: ${label}`)});if(!button)throw Error('Missing walk probe');button.click()})()`);
  await wait('document.activeElement?.id==="world-canvas"&&document.getElementById("connection").textContent.includes("WORLD ONLINE")');
  await evaluate(`document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
  await delay(950);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true}))`);
  await wait(`(()=>{const state=JSON.parse(document.querySelector('#world-lab pre').textContent);return state.player.${axis}${threshold}})()`);
  await wait(`(()=>{const local=JSON.parse(document.querySelector('#world-lab pre').textContent).player;return fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const remote=s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)});return !!remote&&Math.hypot(remote.position.x-local.x,remote.position.y-local.y)<20})})()`);
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
 await wait(`(()=>{const local=JSON.parse(document.querySelector('#world-lab pre').textContent).player;return fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const remote=s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)});return !!remote&&Math.hypot(remote.position.x-local.x,remote.position.y-local.y)<20})})()`);
 await screenshot('agency-walk-in');
 await teleportProbe('agency',1568,340,'agency');
 // Generated cave mouths are ordinary interaction zones on the outer loop.
 await teleportProbe('caveNorth',-700,OUTER_LOOP.top,'north-cave');
 await wait("!document.getElementById('interact').disabled");
 const caveStart=await evaluate("JSON.parse(document.querySelector('#world-lab pre').textContent)");
 assert.equal(caveStart.discovered.includes('cave-north'),false,'approaching a cave must not discover it passively');
 assert.equal(caveStart.minimap.outer,0,'undiscovered landmarks stay off the minimap');
 assert.ok(caveStart.region==='NORTH OUTCROP','outer travel must report the actual region');
 await evaluate("document.getElementById('interact').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='DANGEROUS AREA'&&document.getElementById('interaction-content').textContent.includes('crystal')&&document.getElementById('interaction-content').textContent.includes('game credits')");
 await wait("(()=>{const s=JSON.parse(document.querySelector('#world-lab pre').textContent);return s.discovered.includes('cave-north')&&s.minimap.outer>=1})()");
 await wait("document.getElementById('minimap-canvas').dataset.outer==='1'");
 await wait("!document.getElementById('discovery-toast').hidden&&document.getElementById('discovery-toast').textContent.includes('DISCOVERED')&&document.getElementById('discovery-toast').textContent.includes('NORTHERN CAVE')");
 assert.ok((await evaluate("JSON.parse(localStorage.getItem('agent-world-discoveries-v1'))")).includes('cave-north'),'discoveries persist in the visitor browser');
 await screenshot('discovery-toast');
 await evaluate("document.getElementById('interaction-close').click()");
 await wait("!document.getElementById('interaction-dialog').open");
 await wait('document.activeElement?.id==="world-canvas"');
 // A short E tap still takes the ordinary interaction path after the hold
 // semantics were added; only a hold near another human opens quick chat.
 await evaluate("document.getElementById('world-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await delay(60);
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',bubbles:true}))");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='DANGEROUS AREA'",5000);
 assert.equal(await evaluate('document.getElementById("quick-chat").hidden'),true,'a short E tap must not open quick chat');
 // Cancel first: no cave run may start without an explicit ENTER.
 await evaluate("[...document.querySelectorAll('#interaction-content button')].find(button=>button.textContent==='CANCEL').click()");
 await wait("!document.getElementById('interaction-dialog').open");
 assert.deepEqual(await evaluate("fetch('/api/world/cave').then(r=>r.json())"),{run:null},'cancelling the warning starts no run');
 // Enter for real. The cave owns its own read-only HUD and returns to the
 // exact exterior coordinate when the visitor leaves voluntarily.
 const caveExterior=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 await evaluate("document.getElementById('interact').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='DANGEROUS AREA'");
 await evaluate("[...document.querySelectorAll('#interaction-content button')].find(button=>button.textContent==='ENTER').click()");
 await waitCaveReady();
 await wait("document.getElementById('cave-health-text').textContent.includes('100 / 100')");
 assert.equal(await evaluate('document.getElementById("cave-canvas").width'),480,'cave keeps a bounded pixel canvas');
 assert.ok(await evaluate("fetch('/api/world/cave').then(r=>r.json()).then(s=>s.run&&s.run.monsters.length===4&&s.run.required===4&&s.run.weapon.id==='rusted')"),'the entrance level has its own authoritative monsters, floor target and starter weapon');
 assert.equal(await evaluate("fetch('/api/world/cave/config').then(r=>r.json()).then(c=>c.interact_radius)"),96,'the cave shares a wider interaction reach for passages and chests');
 assert.equal(await evaluate("document.getElementById('cave-monsters').textContent"),'MONSTERS 0 / 4','the cave HUD shows the floor objective');
 assert.equal(await evaluate("document.getElementById('cave-weapon').textContent"),'RUSTED BLADE','the cave HUD names the cave-only weapon');
 assert.equal(await evaluate("getComputedStyle(document.getElementById('cave-joystick')).display"),'none','desktop hides the mobile joystick');
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.cave-buttons')).display"),'none','desktop hides the large touch buttons');
 assert.ok(await evaluate("document.getElementById('cave-hint').textContent.includes('E')&&document.getElementById('cave-hint').textContent.includes('click')"),'desktop hint teaches WASD/click/E');
 await screenshot('cave-level-1');
 // Cave lighting and controls must survive the two required mobile sizes.
 for(const [width,height] of [[390,844],[430,932]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await send('Page.reload');
  await waitCaveReady();
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=${width}`),true,`${width}px cave must not overflow horizontally`);
  assert.ok(await evaluate(`(()=>{const a=document.getElementById('cave-attack').getBoundingClientRect(),c=document.getElementById('cave-canvas').getBoundingClientRect();return c.width>0&&c.height>0&&a.width>=44&&a.height>=44&&a.right<=${width}&&a.bottom<=${height}})()`),'cave controls stay usable at touch sizes');
  assert.notEqual(await evaluate("getComputedStyle(document.getElementById('cave-joystick')).display"),'none',`${width}px cave keeps the joystick`);
  assert.notEqual(await evaluate("getComputedStyle(document.querySelector('.cave-buttons')).display"),'none',`${width}px cave keeps compact touch buttons`);
  assert.ok(await evaluate(`(()=>{const h=document.getElementById('cave-monsters').getBoundingClientRect();return h.width>0&&h.right<=${width}&&h.bottom<=${height}})()`),'the floor objective stays inside the mobile viewport');
  await screenshot(`cave-mobile-${width}`);
 }
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Page.reload');
 await waitCaveReady();
 const holdCaveKey=async(key,ms)=>{
  await evaluate(`document.getElementById('cave-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true}))`);
  await delay(ms);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{key:${JSON.stringify(key)},bubbles:true}))`);
 };
 const caveHpTotal=()=>evaluate("fetch('/api/world/cave').then(r=>r.json()).then(s=>s.run.monsters.reduce((total,monster)=>total+Math.max(0,monster.hp),0))");
 const beforeStrike=await caveHpTotal();
 await holdCaveKey('d',1100);
 await holdCaveKey('w',900);
 await wait("fetch('/api/world/cave').then(r=>r.json()).then(s=>s.run.monsters.some(monster=>monster.alive&&Math.hypot(monster.x-s.run.player.x,monster.y-s.run.player.y)<=s.run.weapon.range))",8000);
 for(let attempt=0;attempt<4;attempt++){
  await evaluate("document.getElementById('cave-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
  await delay(80);
  await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',bubbles:true}))");
  await delay(520);
  if(await evaluate("fetch('/api/world/cave').then(r=>r.json()).then(s=>s.run.kills>=1)"))break;
 }
 assert.ok(await caveHpTotal()<beforeStrike,'desktop E strikes a nearby monster');
 assert.ok(await evaluate("fetch('/api/world/cave').then(r=>r.json()).then(s=>s.run.kills>=1)"),'the E strike advances the floor kill count');
 await wait("document.getElementById('cave-monsters').textContent.startsWith('MONSTERS 1 / 4')",5000);
 assert.ok((await evaluate("document.getElementById('cave-monsters').textContent")).startsWith('MONSTERS 1 / 4'),'the HUD follows the authoritative kill count');
 await holdCaveKey('a',1500);
 await holdCaveKey('w',420);
 await wait("fetch('/api/world/cave').then(r=>r.json()).then(s=>Math.hypot(s.run.player.x-112,s.run.player.y-168)<64)",8000);
 await evaluate("document.getElementById('cave-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await delay(80);
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',bubbles:true}))");
 await wait("location.pathname==='/world'",10000);
 await wait('document.getElementById("character-dialog").open');
 await evaluate('document.getElementById("enter-world").click()');
 await wait('!document.getElementById("character-dialog").open');
 const caveReturn=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 assert.ok(Math.hypot(caveReturn.x-caveExterior.x,caveReturn.y-caveExterior.y)<1,'a normal cave exit returns to the exact saved exterior position');
 // Return to the lab view for the remaining deterministic movement probes.
 await send('Page.navigate',{url:base+'/labs/world'});
 await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
 await wait('document.getElementById("character-dialog").open');
 await evaluate('document.getElementById("enter-world").click()');
 await wait('!document.getElementById("character-dialog").open');
 await wait('document.activeElement?.id==="world-canvas"');
 await delay(180);
 const caveMarkerBefore=await evaluate("document.getElementById('minimap-canvas').dataset.player");
 await holdWorldKey('s',480);
 await wait(`JSON.parse(document.querySelector('#world-lab pre').textContent).player.y>${caveStart.player.y+12}`);
 await wait(`document.getElementById('minimap-canvas').dataset.player!==${JSON.stringify(caveMarkerBefore)}`);
 assert.equal(await evaluate('document.activeElement?.id'),'world-canvas','discovery feedback must return keyboard focus to the world for WASD movement');
 await evaluate("document.getElementById('minimap-journal').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='DISCOVERIES'");
 const journalText=await evaluate("document.getElementById('interaction-content').textContent");
 assert.ok(journalText.includes('CAVES')&&journalText.includes('Northern cave')&&journalText.includes('???')&&journalText.includes('PASSES')&&journalText.includes('CAMPS'),'discovery journal must group found and unknown landmarks');
 assert.ok(journalText.includes('saved in this browser only'),'the visitor-local persistence limitation must be documented in the journal');
 assert.ok(await evaluate("document.querySelectorAll('.discovery-group').length===5&&document.querySelector('.discovery-group[data-kind=cave]').dataset.count==='1/5'"),'journal keeps one compact group per landmark kind');
 await screenshot('discovery-journal');
 await evaluate("document.getElementById('interaction-close').click()");
 await wait("!document.getElementById('interaction-dialog').open");
 await wait('document.activeElement?.id==="world-canvas"');
 // Seeded camps use the same discovery layer and an action-oriented prompt.
 await teleportProbe('campNorth',OUTER_CAMPS[0].x,OUTER_CAMPS[0].y+64,'north-camp');
 await wait("!document.getElementById('interact').disabled&&document.getElementById('world-hint').textContent.includes('REST AT CAMP')");
 await evaluate("document.getElementById('interact').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='North overlook camp'");
 await wait("(()=>{const s=JSON.parse(document.querySelector('#world-lab pre').textContent);return s.discovered.includes('camp-north-1')&&s.minimap.outer>=2})()");
 await evaluate("document.getElementById('interaction-close').click()");
 await wait("!document.getElementById('interaction-dialog').open");
 const eastGuest=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:'visitor_atlas',position:{x:1300,y:460}})}).then(async r=>({status:r.status,...await r.json()}))");
 assert.equal(eastGuest.status,201,'a second visitor can enter the east road');
 await delay(80);
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({position:{x:1312,y:460},direction:'right',animation_state:'walk'})}).then(r=>r.status)"),200,'second visitor moves on the same east road');
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.some(p=>p.player_id===${JSON.stringify(eastGuest.presence_id)}&&p.position.x===1312))`);
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)"),200);
 await teleportProbe('market',820,1320,'south-market');
 const westGuest=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:'visitor_atlas',position:{x:-120,y:430}})}).then(async r=>({status:r.status,...await r.json()}))");
 assert.equal(westGuest.status,201,'a second visitor can enter the west extension');
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.some(p=>p.player_id===${JSON.stringify(westGuest.presence_id)}&&p.position.x===-120))`);
 await delay(80);
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({position:{x:-108,y:430},direction:'right',animation_state:'walk'})}).then(r=>r.status)"),200,'second visitor moves beyond the former west boundary');
 assert.equal(await secondBrowser.evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)"),200);
 // The far-north pass is a real threshold: it records a discovery, then opens
 // a separate snow destination with its own landmarks and return path.
 await teleportProbe('frostgate',576,-2320,'frostgate-pass');
 await wait("JSON.parse(document.querySelector('#world-lab pre').textContent).region==='FROSTLINE PASS'");
 await wait("document.getElementById('world-hint').textContent.includes('CROSS THE PASS')");
 await evaluate("document.getElementById('interact').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='FROSTGATE PASS'&&document.getElementById('interaction-content').textContent.includes('CROSS THE PASS')");
 await evaluate("[...document.querySelectorAll('#interaction-content button')].find(button=>button.textContent==='CROSS THE PASS').click()");
 await wait("location.pathname==='/snow'",10000);
 await wait("document.body.dataset.snowReady==='1'",10000);
 assert.equal(await evaluate('document.getElementById("snow-canvas").width'),480,'the snow destination keeps a bounded pixel canvas');
 assert.equal(await evaluate("document.getElementById('snow-landmarks').textContent"),'LANDMARKS 0 / 3','snow landmarks start unrecorded');
 assert.equal(await evaluate("document.getElementById('snow-canvas').dataset.snow"),'frostgate');
 assert.ok(await evaluate("document.getElementById('snow-canvas').dataset.appearance.length>0"),'the snow destination keeps the saved visitor appearance');
 // Walk north to the watch beacon and inspect it with the same E interaction.
 await evaluate("document.getElementById('snow-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'w',bubbles:true}))");
 await wait("document.getElementById('snow-canvas').dataset.nearest==='watch-beacon'",10000);
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'w',bubbles:true}))");
 await evaluate("document.getElementById('snow-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'e',bubbles:true}))");
 await delay(80);
 await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'e',bubbles:true}))");
 await wait("document.getElementById('snow-canvas').dataset.landmarks.includes('watch-beacon')");
 assert.equal(await evaluate("document.getElementById('snow-landmarks').textContent"),'LANDMARKS 1 / 3','snow landmark counts update after inspection');
 await screenshot('snow-destination');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await delay(220);
 assert.ok(await evaluate('document.documentElement.scrollWidth<=390'),'the snow destination must fit a 390px viewport');
 assert.ok(await evaluate('(()=>{const c=document.getElementById("snow-canvas").getBoundingClientRect(),a=document.getElementById("snow-action").getBoundingClientRect();return c.width>0&&a.width>=44&&a.height>=44&&a.right<=390})()'),'snow touch controls stay usable at 390px');
 assert.notEqual(await evaluate("getComputedStyle(document.getElementById('snow-joystick')).display"),'none','the snow destination keeps its joystick on touch sizes');
 await screenshot('snow-mobile');
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await evaluate("document.getElementById('snow-return').click()");
 await wait("location.pathname==='/world'",10000);
 await wait('document.getElementById("character-dialog").open');
 await evaluate('document.getElementById("enter-world").click()');
 await wait('!document.getElementById("character-dialog").open');
 const passReturn=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 assert.ok(Math.hypot(passReturn.x-576,passReturn.y-(-2320))<1,'returning from the snow restores the Frostgate position');
 await send('Page.navigate',{url:base+'/labs/world'});
 await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
 await wait('document.getElementById("character-dialog").open');await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 // The lab teleport intentionally bypasses movement rules. Rejoin from the
 // persisted location before testing client movement against server speed limits.
 const releasedPresence=await evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)");assert.equal(releasedPresence,200,'test player should leave cleanly before reconnecting at its teleported lab position');
 await send('Page.reload');await wait('document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden&&document.getElementById("connection").textContent.includes("WORLD ONLINE")');
 await wait('document.getElementById("character-dialog").open');await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 localPlayerId=await evaluate("window.__presenceRequests.findLast(value=>value.presence_id)?.presence_id");assert.ok(localPlayerId);
 assert.deepEqual(await evaluate(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>s.players.find(p=>p.player_id===${JSON.stringify(localPlayerId)})?.appearance)`),await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).appearance'),'a refresh keeps the saved appearance');
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 assert.ok(await evaluate('document.documentElement.scrollWidth<=390'));

 assert.ok(await evaluate('(()=>{const m=document.getElementById("world-minimap"),r=m.getBoundingClientRect(),v=document.querySelector(".world-viewport").getBoundingClientRect(),c=document.getElementById("minimap-canvas").getBoundingClientRect(),s=getComputedStyle(m);return r.width<=112&&r.right<=390&&r.left>=0&&c.width>=90&&c.height>45&&s.left==="6px"&&s.bottom==="118px"&&r.left-v.left<=12&&v.bottom-r.bottom<=124})()'),'mobile minimap stays compact at the bottom-left of the viewport above touch controls');
 await wait('document.querySelectorAll(".world-minimap__label").length===6');
 assert.ok(await evaluate('(()=>{const m=document.getElementById("world-minimap").getBoundingClientRect();return [...document.querySelectorAll(".world-minimap__label")].every(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.left>=m.left-1&&r.right<=m.right+1&&r.top>=m.top-1&&r.bottom<=m.bottom+1&&parseFloat(getComputedStyle(node).fontSize)>=5})})()'),'all six labels stay inside a 390px compact map');
 await evaluate("document.getElementById('avatar-change').click()");await wait("document.getElementById('character-dialog').open");
 assert.ok(await evaluate('(()=>{const d=document.getElementById("character-dialog");return d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=390})()'),'the character creator must not overflow a 390px viewport');
 assert.ok(await evaluate('(()=>{const b=document.querySelector("#character-body-swatches button");const r=b.getBoundingClientRect();return r.width>=28&&r.height>=28})()'),'mobile swatches must stay tappable');
 await screenshot('mobile-creator');await evaluate("document.getElementById('character-close').click()");await wait("!document.getElementById('character-dialog').open");
 await delay(3100);const before=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');
 const pad=await evaluate('(()=>{const r=document.getElementById("joystick").getBoundingClientRect();return {x:r.x+r.width/2+32,y:r.y+r.height/2}})()');
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pad.x,y:pad.y}]});await delay(450);await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(3100);
 assert.ok(await evaluate(`JSON.parse(localStorage.getItem('agent-world-settings-v1')).position.x>${before+15}`),'touch joystick must move the player');
 const released=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x');await delay(3100);
 assert.ok(Math.abs((await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position.x'))-released)<1,'released joystick must stop movement');
 await wait(`fetch('/api/worlds/main/presence').then(r=>r.json()).then(s=>{const p=s.players.find(v=>v.player_id===${JSON.stringify(localPlayerId)}),local=JSON.parse(localStorage.getItem('agent-world-settings-v1')).position;window.__lastPresenceState={server:p,local};return !!p&&Math.abs(p.position.x-local.x)<2&&p.animation_state==='idle'})`);
 await screenshot('mobile');
 // Touch gets a contextual CHAT control instead of a hold gesture. The four
 // options stay large, and tap-outside/cancel closes without sending.
 const mobilePosition=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 const mobileGuest=await secondBrowser.evaluate(`fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:'visitor_ember',position:{x:${mobilePosition.x+36},y:${mobilePosition.y}},direction:'left',activity:'Exploring'})}).then(async response=>({status:response.status,...await response.json()}))`);
 assert.equal(mobileGuest.status,201,'a nearby guest can join the mobile visitor');
 await wait('!document.getElementById("quick-chat-open").hidden',8000);
 assert.ok(await evaluate('(()=>{const b=document.getElementById("quick-chat-open"),r=b.getBoundingClientRect();return getComputedStyle(b).display!=="none"&&r.width>=44&&r.height>=40})()'),'mobile exposes a usable CHAT control');
 await evaluate('document.getElementById("quick-chat-open").click()');
 await wait('!document.getElementById("quick-chat").hidden');
 assert.equal(await evaluate('document.querySelectorAll(".quick-chat__option").length'),4);
 assert.ok(await evaluate('(()=>{const options=[...document.querySelectorAll(".quick-chat__option")],wheel=document.getElementById("quick-chat-wheel").getBoundingClientRect();return options.every(option=>{const r=option.getBoundingClientRect();return r.width>=44&&r.height>=44})&&wheel.left>=0&&wheel.right<=390&&wheel.top>=0&&wheel.bottom<=844})()'),'mobile quick-chat options are large and stay inside a 390px viewport');
 await evaluate('document.getElementById("quick-chat-cancel").click()');
 await wait('document.getElementById("quick-chat").hidden');
 await evaluate('document.getElementById("quick-chat-open").click()');
 await wait('!document.getElementById("quick-chat").hidden');
 await evaluate('document.querySelector(".quick-chat__option[data-phrase=follow]").click()');
 await wait('document.getElementById("quick-chat").hidden&&document.getElementById("quick-chat-bubbles").textContent.includes("follow me")',5000);
 // Mobile CHAT → selector → challenge phrase, with the guest declining over HTTP.
 await delay(1600);
 await evaluate('document.getElementById("quick-chat-open").click()');
 await wait('!document.getElementById("quick-chat").hidden');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".quick-chat__option")].map(option=>option.dataset.phrase)'),['hi','follow','nice','wait']);
 assert.equal(await evaluate('document.getElementById("quick-chat-page").textContent'),'SOCIAL ▸');
 await evaluate('document.getElementById("quick-chat-page").click()');
 await wait('document.querySelector(".quick-chat__option[data-phrase=ttt]")');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".quick-chat__option")].map(option=>option.dataset.phrase)'),['ttt','rps','arena','explore']);
 assert.equal(await evaluate('document.getElementById("quick-chat-page").textContent'),'GAME ▸');
 await evaluate('document.querySelector(".quick-chat__option[data-phrase=ttt]").click()');
 await wait('!document.getElementById("challenge-outgoing").hidden',5000);
 const mobileChallengeId=await evaluate('document.getElementById("challenge-outgoing").dataset.challengeId');
 assert.match(mobileChallengeId,/^chal-[a-f0-9-]{36}$/);
 const mobileDecline=await secondBrowser.evaluate(`fetch('/api/worlds/main/presence/challenges/${mobileChallengeId}/decline',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(async response=>({status:response.status,...await response.json()}))`);
 assert.equal(mobileDecline.status,200);
 await wait('document.getElementById("challenge-outgoing").hidden',5000);
 // The guest challenges the mobile visitor; the compact prompt must fit and stay tappable.
 const mobileChallenge=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/quick-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase_id:'ttt'})}).then(async response=>({status:response.status,...await response.json()}))");
 assert.equal(mobileChallenge.status,200);
 await wait('!document.getElementById("challenge-prompt").hidden&&document.getElementById("challenge-game").textContent.includes("TIC-TAC-TOE")',8000);
 assert.ok(await evaluate('(()=>{const p=document.getElementById("challenge-prompt").getBoundingClientRect(),a=document.getElementById("challenge-accept").getBoundingClientRect(),d=document.getElementById("challenge-decline").getBoundingClientRect();return p.left>=0&&p.right<=390&&p.top>=0&&p.bottom<=844&&a.height>=44&&d.height>=44})()'),'mobile challenge prompt fits 390×844 with touch targets');
 await evaluate('document.getElementById("challenge-decline").click()');
 await wait('document.getElementById("challenge-prompt").hidden',5000);
 await secondBrowser.evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)");
 await wait('document.getElementById("quick-chat-open").hidden&&document.getElementById("quick-chat-prompt").hidden',8000);
 await evaluate("document.getElementById('minimap-journal').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='DISCOVERIES'");
 assert.ok(await evaluate('(()=>{const d=document.getElementById("interaction-dialog"),r=d.getBoundingClientRect(),c=document.getElementById("interaction-content");return r.width<=390&&r.right<=390&&r.left>=0&&c.scrollWidth<=c.clientWidth+1&&document.documentElement.scrollWidth<=390})()'),'discovery journal must fit a 390px bottom sheet without horizontal overflow');
 assert.ok((await evaluate("document.getElementById('interaction-content').textContent")).includes('Northern cave'),'mobile journal keeps the discovered cave');
 await evaluate("document.getElementById('interaction-close').click()");
 await wait("!document.getElementById('interaction-dialog').open");
 await send('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
 await delay(240);
 assert.ok(await evaluate('document.documentElement.scrollWidth<=430'),'the exploration UI must fit a 430px viewport');
 assert.ok(await evaluate('(()=>{const m=document.getElementById("world-minimap").getBoundingClientRect(),h=document.getElementById("world-hint").getBoundingClientRect();return m.right<=430&&m.left>=0&&m.bottom<=932&&h.right<=430})()'),'minimap and contextual hint stay inside a 430×932 viewport');
 assert.deepEqual(await evaluate('[...document.querySelectorAll(".world-minimap__label")].map(node=>node.textContent)'),['ARENA','CMPD','MKT','LAB','AGY','VLT'],'the 430px map keeps every public destination label');
 assert.ok(await evaluate('(()=>{const m=document.getElementById("world-minimap").getBoundingClientRect();return [...document.querySelectorAll(".world-minimap__label")].every(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.left>=m.left-1&&r.right<=m.right+1&&r.top>=m.top-1&&r.bottom<=m.bottom+1})})()'),'no label escapes the 430px compact map');
 const position430=await evaluate('JSON.parse(localStorage.getItem("agent-world-settings-v1")).position');
 const guest430=await secondBrowser.evaluate(`fetch('/api/worlds/main/presence/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({avatar:'visitor_ember',position:{x:${position430.x+36},y:${position430.y}},direction:'left',activity:'Exploring'})}).then(async response=>({status:response.status,...await response.json()}))`);
 assert.equal(guest430.status,201);
 await wait('!document.getElementById("quick-chat-prompt").hidden',8000);
 await delay(4200);
 const challenge430=await secondBrowser.evaluate("fetch('/api/worlds/main/presence/quick-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase_id:'ttt'})}).then(async response=>({status:response.status,...await response.json()}))");
 assert.equal(challenge430.status,200);
 await wait('!document.getElementById("challenge-prompt").hidden&&document.getElementById("challenge-game").textContent.includes("TIC-TAC-TOE")',8000);
 assert.ok(await evaluate('(()=>{const p=document.getElementById("challenge-prompt").getBoundingClientRect(),a=document.getElementById("challenge-accept").getBoundingClientRect(),d=document.getElementById("challenge-decline").getBoundingClientRect();return p.left>=0&&p.right<=430&&p.top>=0&&p.bottom<=932&&a.height>=44&&d.height>=44})()'),'mobile challenge prompt fits 430×932 with touch targets');
 await evaluate('document.getElementById("challenge-decline").click()');
 await wait('document.getElementById("challenge-prompt").hidden',5000);
 await secondBrowser.evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)");
 await evaluate("document.getElementById('minimap-journal').click()");
 await wait("document.getElementById('interaction-dialog').open&&document.getElementById('interaction-title').textContent==='DISCOVERIES'");
 assert.ok(await evaluate('(()=>{const d=document.getElementById("interaction-dialog"),r=d.getBoundingClientRect();return r.width<=430&&r.right<=430&&document.documentElement.scrollWidth<=430})()'),'430×932 discovery bottom sheet must not overflow');
 await evaluate("document.getElementById('interaction-close').click()");
 await wait("!document.getElementById('interaction-dialog').open");
 await send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await send('Emulation.setDeviceMetricsOverride',{width:360,height:780,deviceScaleFactor:1,mobile:true});
 await send('Page.navigate',{url:base});await wait("document.querySelector('a[href=\"/world\"]')");
 assert.ok(await evaluate('document.documentElement.scrollWidth<=360'),'original Last Seat page must fit a 360px viewport');
 assert.ok(await evaluate("document.querySelector('a[href=\"/world\"]').getBoundingClientRect().width>0"),'world entry must remain visible on mobile');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:base+'/labs/world'});await wait('location.pathname==="/labs/world"&&document.getElementById("world-lab")&&!document.getElementById("world-lab").hidden');
 await wait('document.getElementById("character-dialog").open');await evaluate('document.getElementById("enter-world").click()');await wait('!document.getElementById("character-dialog").open');
 await evaluate("[...document.querySelectorAll('#world-lab button')].find(b=>b.textContent==='Teleport: Enter detention compound').click()");
 await waitPosition(-220,994);
 await wait('!document.getElementById("interact").disabled');
 await evaluate('document.getElementById("interact").click()');
 await wait('location.pathname==="/compound"&&document.getElementById("compound-map")');
 await wait("fetch('/api/compound').then(r=>r.json()).then(s=>s.phase==='lobby')");
 await evaluate("fetch('/api/compound/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Browser Compound'})}).then(r=>r.json())");
 await secondBrowser.send('Page.navigate',{url:base+'/compound'});await secondBrowser.wait('location.pathname==="/compound"&&document.getElementById("compound-map")');
 await secondBrowser.evaluate("fetch('/api/compound/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Second Browser'})}).then(r=>r.json())");
 await wait("fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.filter(p=>p.type==='human').length===2)");
 await wait("document.getElementById('compound-lobby').textContent.includes('Start round')");
 await evaluate("[...document.querySelectorAll('#compound-lobby button')].find(b=>b.textContent==='Start round').click()");
 await wait("document.getElementById('compound-status').textContent.includes('ROUND')&&fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.length===8&&s.phase==='active')");
 await secondBrowser.wait("document.body.classList.contains('compound-playing')&&document.getElementById('compound-status').textContent.includes('ROUND')&&fetch('/api/compound').then(r=>r.json()).then(s=>s.phase==='active'&&s.participants.length===8&&!!s.you)");
 assert.equal(await secondBrowser.evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.some(p=>p.id!==s.you&&p.role))"),false,'second browser must not see another participant secret role');
 const secondPosition=await secondBrowser.evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>{const p=s.participants.find(v=>v.id===s.you);return {id:p.id,x:p.position.x,y:p.position.y}})");
 await secondBrowser.send('Page.bringToFront');await secondBrowser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68,nativeVirtualKeyCode:68});await delay(650);await secondBrowser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68,nativeVirtualKeyCode:68});
 await wait(`fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.find(p=>p.id===${JSON.stringify(secondPosition.id)})?.position.x>${secondPosition.x+.5})`);
 assert.ok(await evaluate("document.getElementById('compound-you').textContent.includes('DISCOVERED')"),'compound owner should see only its discovered objective');
 assert.ok(await evaluate("document.getElementById('compound-you').textContent.includes('STAMINA')&&document.getElementById('compound-you').textContent.includes('STR')"),'compound HUD should expose runtime stats');
 assert.equal(await evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.some(p=>p.id!==s.you&&p.role))"),false,'other compound participants must not expose secret roles');
 assert.ok(await evaluate("document.getElementById('compound-map') instanceof HTMLCanvasElement&&document.getElementById('compound-map').width===640"),'compound should render a player-following pixel viewport');
 assert.ok(await evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>s.map.rooms.some(room=>room.id==='gym')&&s.map.escape_routes.length<=1&&s.security==='normal')"),'compound map should expose the Gym without leaking undiscovered escape routes');
 const searched=await evaluate("fetch('/api/compound/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'search',container_id:'locker-2'})}).then(r=>r.json())");
 assert.ok(searched.participants.find(value=>value.id===searched.you).inventory_count>1,'human should search a physical cell locker');
 const compoundBefore=await evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>{const p=s.participants.find(v=>v.id===s.you);return {x:p.position.x,y:p.position.y,agents:s.participants.filter(v=>v.type==='agent').map(v=>v.position)}})");
 const holdStart=await evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.find(v=>v.id===s.you).position.x)");
 const concurrentSecondStart=await secondBrowser.evaluate("fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.find(v=>v.id===s.you).position.x)");
 await secondBrowser.send('Page.bringToFront');await secondBrowser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});await send('Page.bringToFront');
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'d',code:'KeyD',windowsVirtualKeyCode:68,nativeVirtualKeyCode:68});await delay(750);await send('Input.dispatchKeyEvent',{type:'keyUp',key:'d',code:'KeyD',windowsVirtualKeyCode:68,nativeVirtualKeyCode:68});
 await secondBrowser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});
 await wait(`fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.find(v=>v.id===s.you).position.x>=${holdStart+2})`);
 await secondBrowser.wait(`fetch('/api/compound').then(r=>r.json()).then(s=>s.participants.find(v=>v.id===s.you).position.x<${concurrentSecondStart-.5})`);
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
finally{secondBrowser?.close();for(const request of pending.values())clearTimeout(request.timer);socket.close();process.exit(failed?1:0);}
