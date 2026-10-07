import {constants} from 'node:fs';
import {open} from 'node:fs/promises';

/** Read local persisted JSON without following symlinks or buffering past its bound. */
export async function readBoundedJson(file,{maxBytes,label='Persisted JSON'}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Invalid persisted JSON size limit');
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const metadata=await handle.stat();
    if(!metadata.isFile())throw new Error(`${label} is not a regular file`);
    if(metadata.size>maxBytes)throw Object.assign(new Error(`${label} exceeds its ${maxBytes}-byte limit`),{status:503,code:'PERSISTED_JSON_TOO_LARGE'});
    const buffer=Buffer.alloc(maxBytes+1);let length=0;
    while(length<buffer.length){
      const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);
      if(bytesRead===0)break;
      length+=bytesRead;
    }
    if(length>maxBytes)throw Object.assign(new Error(`${label} exceeds its ${maxBytes}-byte limit`),{status:503,code:'PERSISTED_JSON_TOO_LARGE'});
    return JSON.parse(buffer.subarray(0,length).toString('utf8'));
  }finally{await handle.close();}
}
