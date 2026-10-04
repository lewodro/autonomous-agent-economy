import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const targets=await fetch((process.env.CHROME_DEBUG_URL||'http://127.0.0.1:9322')+'/json').then(r=>r.json());
const target=targets.find(t=>t.type==='page');if(!target)throw Error('Start Chrome with --remote-debugging-port=9322');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
let sequence=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
async function wait(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression);}
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:(process.env.ECONOMY_URL||'http://localhost:3001')+'/labs/economy'});
 await wait("document.querySelector('[data-action=reset]')");
 const click=async action=>{await evaluate(`document.querySelector('[data-action=${action}]').click()`);await wait("!document.querySelector('[data-action=reset]').disabled");};
 await click('reset');await wait("document.getElementById('agent').options.length===4");
 for(let n=1;n<=4;n++){await evaluate(`document.getElementById('agent').value='agent-${n}'`);await click('fund');}
 assert.match(await evaluate("document.getElementById('status').textContent"),/FUNDED.*80000000/);
 await click('lock');await click('finish');await click('settle');
 assert.match(await evaluate("document.getElementById('status').textContent"),/SETTLED.*winner agent-3/);
 await evaluate("document.querySelector('details').open=true");
 const first=await evaluate("document.getElementById('output').textContent");await click('settle');assert.equal(await evaluate("document.getElementById('output').textContent"),first);
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(os.tmpdir(),'last-seat-economy-lab.png'),Buffer.from(r.data,'base64')));
 for(const width of [360,390,430]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate(`document.documentElement.scrollWidth<=${width}`),true);}
 await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(path.join(os.tmpdir(),'last-seat-economy-lab-mobile.png'),Buffer.from(r.data,'base64')));
 assert.deepEqual(errors,[]);console.log('PASS: mock lab funding, locked pot, Rust winner, repeated payout, public projection, desktop and 360/390/430px mobile');
}finally{ws.close();}
