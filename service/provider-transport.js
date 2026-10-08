import {isIP} from 'node:net';

export function validateProviderTransport(value,{production=process.env.NODE_ENV==='production'}={}){
  let url;
  try{url=new URL(value);}catch{throw new Error('Model provider endpoint must be an absolute URL');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Model provider endpoint must use HTTP(S) without embedded credentials');
  const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  const loopback=host==='localhost'||(isIP(host)===4&&host.startsWith('127.'))||(isIP(host)===6&&host==='::1');
  if(production&&url.protocol!=='https:'&&!loopback)throw new Error('Production model providers require HTTPS');
  return url;
}
