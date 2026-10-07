import {isIP} from 'node:net';

const isLoopback=hostname=>{
 const host=hostname.replace(/^\[|\]$/g,'').toLowerCase();
 if(host==='localhost')return true;
 const version=isIP(host);
 if(version===4)return Number(host.split('.')[0])===127;
 return version===6&&host==='::1';
};

/** Provider URLs are operator-controlled; production credentials still require TLS off-box. */
export function validateProviderTransport(value,{production=process.env.NODE_ENV==='production'}={}){
 let url;
 try{url=new URL(value);}catch{throw new Error('Model provider endpoint must be a valid absolute URL.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Model provider endpoint must use HTTP(S) without embedded credentials.');
 if(production&&url.protocol!=='https:'&&!isLoopback(url.hostname))throw new Error('Production model providers must use HTTPS unless they run on loopback.');
 return url;
}
