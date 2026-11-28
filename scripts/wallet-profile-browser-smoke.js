import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { listChromeTargets } from './chrome-debug.js';
import { accountCookie } from '../service/world-identity.js';

const base=process.env.GAME_URL;
const debug=process.env.CHROME_DEBUG_URL;
if(!base||!debug)throw new Error('Wallet browser smoke requires GAME_URL and CHROME_DEBUG_URL');
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const unsafeJsCharMap={'<':'\\u003C','>':'\\u003E','/':'\\u002F','\\':'\\\\','\b':'\\b','\f':'\\f','\n':'\\n','\r':'\\r','\t':'\\t','\0':'\\0','\u2028':'\\u2028','\u2029':'\\u2029'};
const unsafeJsChars=/[<>/\\\b\f\n\r\t\0\u2028\u2029]/g;
function escapeForEmbeddedJsStringLiteral(value){return JSON.stringify(value).replace(unsafeJsChars,char=>unsafeJsCharMap[char]);}
function base58(bytes){let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);let output='';while(value>0n){output=alphabet[Number(value%58n)]+output;value/=58n;}for(const byte of bytes){if(byte===0)output=`1${output}`;else break;}return output||'1';}
function address(){const {publicKey}=generateKeyPairSync('ed25519');return base58(Buffer.from(publicKey.export({format:'jwk'}).x,'base64url'));}
const first=address(),second=address(),short=value=>`${value.slice(0,6)}...${value.slice(-5)}`;
const target=(await listChromeTargets(debug)).find(value=>value.type==='page');
if(!target)throw new Error('Chrome page target unavailable');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
let nextId=0;const pending=new Map();
socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const request=pending.get(message.id);if(!request)return;clearTimeout(request.timer);pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);});
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser command timed out: ${method}`));},20_000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function wait(expression){for(let attempt=0;attempt<150;attempt++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Browser condition timed out: ${expression}`);}
async function openAccount(){await wait("typeof document.getElementById('hud-account')?.onclick==='function'");await evaluate("if(document.getElementById('character-dialog').open)document.getElementById('enter-world').click()");await evaluate("document.getElementById('hud-account').click()");await wait("document.getElementById('interaction-title')?.textContent==='WORLD ACCOUNT'&&document.getElementById('interaction-content')?.textContent.includes('YOUR SOLANA WALLET')");}

try{
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedWalletAddress=value}}})"});
  const [nameValue]=accountCookie('clerk:wallet_browser_smoke').split(';');
  const [name,value]=nameValue.split('=');
  await send('Network.setCookie',{name,value,url:`${base}/world`,httpOnly:true,sameSite:'Strict'});
  await send('Page.navigate',{url:`${base}/world`});
  await openAccount();
  assert.ok((await evaluate("document.getElementById('interaction-content').textContent")).includes('No linked wallet'));
  await evaluate(`(()=>{const form=document.querySelector('#interaction-content .wallet-link-form');form.querySelector('input').value=${escapeForEmbeddedJsStringLiteral(first)};form.requestSubmit()})()`);
  await wait(`document.getElementById('interaction-content')?.textContent.includes(${JSON.stringify(short(first))})`);
  assert.equal(await evaluate("fetch('/api/world/farm').then(response=>response.json()).then(snapshot=>snapshot.account.wallet.status)"),'unverified');
  const profileText=await evaluate("document.getElementById('interaction-content').textContent");
  assert.ok(profileText.includes(short(first)));assert.ok(profileText.includes('UNVERIFIED'));
  assert.equal(profileText.includes(first),false,'normal profile text must not reveal the full address');
  assert.equal(await evaluate("[...document.querySelectorAll('#interaction-content a')].find(link=>link.textContent==='VIEW ON SOLSCAN')?.href"),`https://solscan.io/account/${first}`);
  await evaluate("[...document.querySelectorAll('#interaction-content button')].find(button=>button.textContent==='COPY ADDRESS').click()");
  await wait('window.__copiedWalletAddress');
  assert.equal(await evaluate('window.__copiedWalletAddress'),first);
  await send('Page.reload',{ignoreCache:true});
  await openAccount();
  assert.ok((await evaluate("document.getElementById('interaction-content').textContent")).includes(short(first)),'refresh restores the linked wallet from the server');
  await evaluate(`(()=>{const form=document.querySelector('#interaction-content .wallet-link-form');form.querySelector('input').value=${escapeForEmbeddedJsStringLiteral(second)};form.requestSubmit()})()`);
  await wait(`document.getElementById('interaction-content')?.textContent.includes(${JSON.stringify(short(second))})`);
  assert.equal((await evaluate("document.getElementById('interaction-content').textContent")).includes(first),false);
  await evaluate("[...document.querySelectorAll('#interaction-content button')].find(button=>button.textContent==='REMOVE WALLET').click()");
  await wait("document.getElementById('interaction-content')?.textContent.includes('No linked wallet')");
  assert.equal(await evaluate("!![...document.querySelectorAll('#interaction-content a')].find(link=>link.textContent==='VIEW ON SOLSCAN')"),false);
  console.log('PASS wallet profile: shortened display, full copy and explorer, refresh, change, removal');
}finally{await evaluate("fetch('/api/worlds/main/presence/leave',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(response=>response.status)").catch(()=>{});await send('Network.clearBrowserCookies').catch(()=>{});for(const request of pending.values())clearTimeout(request.timer);socket.close();}
