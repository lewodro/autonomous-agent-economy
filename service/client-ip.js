import {isIP} from 'node:net';

function firstAddress(value){return String(value||'').split(',')[0].trim();}

/** Use proxy identity only when the deployment explicitly trusts its ingress. */
export function clientRateKey(req,{trustProxy=false}={}){
  if(trustProxy){
    const realIp=firstAddress(req.headers['x-real-ip']);
    if(isIP(realIp))return realIp;
    const forwarded=firstAddress(req.headers['x-forwarded-for']);
    if(isIP(forwarded))return forwarded;
  }
  const peer=req.socket?.remoteAddress||'';
  return isIP(peer)?peer:'unknown';
}
