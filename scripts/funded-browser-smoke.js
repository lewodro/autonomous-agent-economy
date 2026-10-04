import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const base=process.env.GAME_URL||'http://localhost:3001';
const targets=await fetch((process.env.CHROME_DEBUG_URL||'http://127.0.0.1:9322')+'/json').then(r=>r.json());
const target=targets.find(t=>t.type==='page');assert.ok(target,'Start Chrome with remote debugging enabled');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let id=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);msg.error?p.reject(msg.error):p.resolve(msg.result);}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const wait=async expression=>{for(let i=0;i<600;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);};
try{
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base});await wait("document.querySelectorAll('.agent-tab').length>0");
 await evaluate("document.getElementById('new').click();document.getElementById('economy-mode').value='local';document.getElementById('economy-entry').value='0.02';");
 // Configure through the real dialog using the server's authoritative defaults.
 await evaluate("(async()=>{const r=await fetch('/api/config?agents=4');if(!r.ok)throw Error(await r.text());const config=await r.json();config.seed=42;config.max_turns=5;document.getElementById('config-json').value=JSON.stringify(config);document.getElementById('config-form').requestSubmit();})()");
 await wait("!document.getElementById('economy-hud').hidden&&document.querySelector('.pot-label').textContent.includes('0 / 0.08')");
 const session=await evaluate("new URL(location.href).searchParams.get('watch')");assert.ok(session);
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(os.tmpdir(),'last-seat-funding.png'),Buffer.from(r.data,'base64')));
 await evaluate("document.querySelector('#economy-hud button').click();document.getElementById('speed').value='4';document.getElementById('speed').dispatchEvent(new Event('change'))");
 await wait("document.querySelector('.pot-label').textContent.startsWith('PAID')");
 assert.equal(await evaluate("document.querySelector('.economy-presentation').textContent.includes('HOST COMPLETE')"),true);
 const first=await fetch(`${base}/api/funded-matches/${session}`).then(r=>r.json());assert.equal(first.economy.settlement.payout_amount,'80000000');assert.equal(first.economy.settlement.status,'confirmed');assert.equal(first.economy.attestation.claims.winner_id,first.replay.winner);
 await wait("document.querySelectorAll('.agent-tab[data-funding=\"✓\"]').length===4");
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(os.tmpdir(),'last-seat-funded-desktop.png'),Buffer.from(r.data,'base64')));
 for(const width of [360,390,430]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate(`document.documentElement.scrollWidth<=${width}`),true);}
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(os.tmpdir(),'last-seat-funded-mobile.png'),Buffer.from(r.data,'base64')));
 await send('Page.reload');await wait("document.querySelector('.pot-label')?.textContent.startsWith('PAID')");
 const again=await fetch(`${base}/api/funded-matches/${session}/settle`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());assert.deepEqual(again.economy.operations,first.economy.operations);assert.deepEqual(again.economy.wallets,first.economy.wallets);
 await send('Page.navigate',{url:base+'/labs/funded'});await wait("document.querySelectorAll('#sessions option').length>0");
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',session,pot_lamports:'80000000',winner:first.replay.winner,transaction:first.economy.settlement.transaction_reference,desktop:true,mobile_widths:[360,390,430],duplicate_payout_prevented:true}));
}finally{ws.close();}
