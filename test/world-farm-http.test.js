import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { FARM_SCARCITY } from '../service/world-farm.js';
import { accountCookie } from '../service/world-identity.js';

const BASE58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);let output='';while(value>0n){output=BASE58[Number(value%58n)]+output;value/=58n;}for(const byte of bytes){if(byte===0)output=`1${output}`;else break;}return output||'1';}

function start(environment) {
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  return { child, errors: () => errors };
}

test('farm HTTP routes drive the same server-authoritative loop the world renders', { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'world-farm-http-'));
  const { child, errors } = start({ ...process.env, PORT: '0', MATCHES_DIR: directory });
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup failed: ${errors()}`)), 8_000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error(errors())); });
      child.stdout.on('data', chunk => {
        const port = chunk.toString().match(/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); }
      });
    });

    const html = await (await fetch(base + '/')).text();
    for (const id of ['world-hud', 'hud-account', 'hud-xp-bar', 'hud-bag', 'farm-notices']) assert.match(html, new RegExp(`id="${id}"`));
    assert.equal((await fetch(base + '/web/dist/world/farm.js')).status, 200);
    const auth = await (await fetch(base + '/api/world/auth')).json();
    assert.deepEqual(auth, { provider: 'clerk', configured: false, publishable_key: null });
    const treasuryPage=await fetch(base+'/treasury');assert.equal(treasuryPage.status,200);assert.match(await treasuryPage.text(),/LAST SEAT TREASURY/);
    const treasury=await (await fetch(base+'/api/treasury/public')).json();assert.equal(treasury.status,'not_funded');assert.equal(treasury.payouts_enabled,false);assert.equal(treasury.public_address,null);assert.equal(treasury.reserves,null);assert.equal('private_key' in treasury,false);

    const snapshotResponse = await fetch(base + '/api/world/farm');
    const cookie = snapshotResponse.headers.get('set-cookie')?.split(';')[0];
    const snapshot = await snapshotResponse.json();
    assert.ok(cookie);
    assert.equal(snapshot.mode, 'farm_v1');
    assert.equal(snapshot.tiles.length, FARM_SCARCITY.startingTiles);
    assert.equal(snapshot.auth.signed_in, false);
    assert.equal(snapshot.account.credits, 0);
    assert.equal(snapshot.account.signed_in, false);
    assert.equal(snapshot.bazaar.prices.wheat, 4);
    assert.deepEqual(Object.fromEntries(Object.entries(snapshot.crops).map(([kind,crop])=>[kind,crop.production_grow_ms])),{wheat:180_000,carrot:360_000,pumpkin:540_000});

    const tile = snapshot.tiles[0];
    await fetch(base + '/api/worlds/main/presence/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ position: tile.position }) });

    const post = async (action, body) => {
      const response = await fetch(`${base}/api/world/farm/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };

    const planted = await post('plant', { tile_id: tile.id, crop: 'wheat', request_id: 'http-plant-001' });
    assert.equal(planted.status, 200);
    assert.equal(planted.body.tile.stage, 'growing');
    assert.equal(planted.body.grow_ms, 180_000);
    const replayedPlant = await post('plant', { tile_id: tile.id, crop: 'wheat', request_id: 'http-plant-001' });
    assert.equal(replayedPlant.status, 200);
    assert.equal(replayedPlant.body.event_id, planted.body.event_id);

    const growing=await post('harvest', { tile_id: tile.id });assert.equal(growing.status,409);assert.equal(growing.body.code,'CROP_NOT_READY');
    const remoteSale=await post('sell', { crop: 'wheat', quantity: 1 });assert.equal(remoteSale.status,409);assert.equal(remoteSale.body.code,'MARKET_REQUIRED');

    const heartbeat = await post('heartbeat', { seconds: 30 });
    assert.equal(heartbeat.status, 200);
    assert.equal(heartbeat.body.accepted_seconds, 30);
    assert.equal(heartbeat.body.account.seconds_played, 30);

    const savedProfile = await post('profile', { avatar: 'visitor_atlas', position: { x: 560, y: 480 } });
    assert.equal(savedProfile.status, 200);
    assert.equal(savedProfile.body.account.profile.avatar, 'visitor_atlas');
    assert.deepEqual(savedProfile.body.account.profile.position, { x: 560, y: 480 });
    assert.equal((await post('profile', { avatar: 'visitor_debug' })).status, 400);

    const wallet = await post('wallet-challenge', { wallet_address: '11111111111111111111111111111111' });
    assert.equal(wallet.status, 403, 'guest wallet claims are never accepted');
    const accountA=accountCookie('clerk:user_http_a',process.env,Date.now()-2_000).split(';')[0];
    const secondSessionA=accountCookie('clerk:user_http_a',process.env,Date.now()-1_000).split(';')[0];
    const loginAgainA=accountCookie('clerk:user_http_a').split(';')[0];
    assert.notEqual(accountA,secondSessionA);
    const accountB=accountCookie('clerk:user_http_b').split(';')[0];
    const addressA='11111111111111111111111111111111';
    const {publicKey}=generateKeyPairSync('ed25519');
    const addressB=base58(Buffer.from(publicKey.export({format:'jwk'}).x,'base64url'));
    const accountGet=async cookieValue=>(await (await fetch(base+'/api/world/farm',{headers:{Cookie:cookieValue}})).json()).account;
    const accountPost=async(cookieValue,body)=>{
      const response=await fetch(base+'/api/world/farm/wallet-address',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookieValue},body:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    };
    assert.equal((await accountPost(cookie,{wallet_address:addressA})).status,403,'guests cannot link addresses');
    assert.equal((await accountPost(accountA,{wallet_address:addressA,account_id:'clerk:user_http_b'})).body.account.wallet.status,'unverified');
    assert.equal((await accountPost(accountB,{wallet_address:addressA})).status,200,'unverified duplicates are allowed');
    assert.equal((await accountPost(accountB,{wallet_address:addressB})).status,200);
    assert.equal((await accountGet(accountA)).wallet.address,addressA);
    assert.equal((await accountGet(secondSessionA)).wallet.address,addressA,'a second signed session sees the same account wallet');
    assert.equal((await accountGet(accountB)).wallet.address,addressB);
    assert.equal((await (await fetch(base+'/api/world/farm?account_id=clerk:user_http_a',{headers:{Cookie:accountB}})).json()).account.wallet.address,addressB,'query IDs cannot select another account');
    assert.equal((await accountGet(cookie)).wallet.address,null,'guest cannot read signed-in wallet');
    assert.equal((await accountGet(accountB)).wallet.address===addressA,false,'B cannot select A with a supplied ID');
    const signedOut=await fetch(base+'/api/world/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:accountA},body:'{}'});
    assert.equal(signedOut.status,200,await signedOut.text());
    assert.match(signedOut.headers.get('set-cookie')||'',/Max-Age=0/);
    const clearedCookie=(signedOut.headers.get('set-cookie')||'').split(';')[0];
    assert.equal((await accountGet(clearedCookie)).wallet.address,null,'logout returns the guest account');
    assert.equal((await accountGet(loginAgainA)).wallet.address,addressA,'a new signed session for the same Clerk account sees its wallet');
    assert.equal((await accountPost(loginAgainA,{wallet_address:null})).body.account.wallet.address,null);
    assert.equal((await accountGet(loginAgainA)).wallet.address,null,'removal clears the profile projection');
    assert.equal((await accountGet(accountB)).wallet.address,addressB,'removal does not affect B');
    assert.equal((await post('payout', { amount_credits: 500 })).status, 403, 'guests cannot request payouts');

    assert.equal((await post('plant', { tile_id: 'plot_missing', crop: 'wheat' })).status, 404);
    assert.equal((await post('plant', { tile_id: tile.id, crop: 'banana' })).status, 400);

    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.world_farm.status, 'ok');
    assert.equal(health.world_farm.storage, 'json');
    assert.equal(health.world_farm.tiles, FARM_SCARCITY.startingTiles);
    assert.equal(health.world_farm.payouts_enabled, false);
    assert.equal(health.treasury.payouts_enabled,false);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(directory, { recursive: true, force: true });
  }
});
