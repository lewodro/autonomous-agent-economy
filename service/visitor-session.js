import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

const name='aae_visitor';
const lifetimeSeconds=90*24*60*60;
const identifier=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function secret(env){
  if(env.HOST_SESSION_SECRET?.length>=32)return env.HOST_SESSION_SECRET;
  if(env.NODE_ENV==='production')throw new Error('HOST_SESSION_SECRET must contain at least 32 characters in production.');
  return 'local-visitor-session-signing-key-only';
}
function sign(id,expiry,env){return createHmac('sha256',secret(env)).update(`aae-visitor-v1:${id}.${expiry}`).digest('base64url');}

/** A browser receives only a signed, HttpOnly cookie; supplied IDs are never trusted. */
export function visitorSession(req,env=process.env,now=Date.now()){
  const raw=String(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(`${name}=`));
  if(raw&&raw.length<256){
    const [id,expiry,mac,extra]=raw.slice(name.length+1).split('.');
    const current=Math.floor(now/1000),until=Number(expiry);
    if(!extra&&identifier.test(id||'')&&/^\d{10}$/.test(expiry||'')&&until>=current&&until<=current+lifetimeSeconds&&mac){
      const expected=Buffer.from(sign(id,expiry,env)),actual=Buffer.from(mac);
      if(actual.length===expected.length&&timingSafeEqual(actual,expected))return {id,cookie:null};
    }
  }
  const id=randomUUID(),expiry=String(Math.floor(now/1000)+lifetimeSeconds);
  const secure=env.NODE_ENV==='production'?'; Secure':'';
  return {id,cookie:`${name}=${id}.${expiry}.${sign(id,expiry,env)}; Path=/api/experiments; HttpOnly; SameSite=Strict; Max-Age=${lifetimeSeconds}${secure}`};
}
