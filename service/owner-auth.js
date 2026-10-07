import {createHmac,timingSafeEqual} from 'node:crypto';

const COOKIE='aae_owner';
const lifetimeSeconds=30*24*60*60;
function secret(env){
 const value=env.HOST_SESSION_SECRET;
 if(value&&value.length>=32)return value;
 if(env.NODE_ENV==='production')throw new Error('HOST_SESSION_SECRET must contain at least 32 characters in production.');
 return 'autonomous-agent-economy-local-owner-session-only';
}
function mac(payload,env){return createHmac('sha256',secret(env)).update(`aae-owner-v1:${payload}`).digest('base64url');}
export function ownerCookie(ownerId,env=process.env,now=Date.now()){
 if(!/^[a-f0-9-]{36}$/.test(ownerId))throw new Error('Invalid owner ID');
 const expiry=Math.floor(now/1000)+lifetimeSeconds,payload=`${ownerId}.${expiry}`;
 return `${COOKIE}=${payload}.${mac(payload,env)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${lifetimeSeconds}${env.NODE_ENV==='production'?'; Secure':''}`;
}
export function ownerCookieClear(env=process.env){return `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${env.NODE_ENV==='production'?'; Secure':''}`;}
export function ownerIdFromRequest(req,env=process.env,now=Date.now()){
 const raw=String(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(`${COOKIE}=`));
 if(!raw||raw.length>256)return null;
 const value=raw.slice(COOKIE.length+1),[ownerId,expiry,signature,extra]=value.split('.');
 if(extra||!/^[a-f0-9-]{36}$/.test(ownerId||'')||!/^[0-9]{10}$/.test(expiry||'')||!signature)return null;
 const seconds=Number(expiry),current=Math.floor(now/1000);
 if(seconds<current||seconds>current+lifetimeSeconds)return null;
 const expected=Buffer.from(mac(`${ownerId}.${expiry}`,env)),actual=Buffer.from(signature);
 return actual.length===expected.length&&timingSafeEqual(actual,expected)?ownerId:null;
}
