const STORAGE_FAILURES=new Set(['EACCES','EBUSY','EIO','EMFILE','ENFILE','ENOSPC','EPERM','EROFS']);
const SERVICE_FAILURES=new Set(['rpc_unavailable','storage_failure']);

/** Preserve client/domain statuses while reporting local storage faults as service failures. */
export function requestErrorStatus(error){
  if(Number.isInteger(error?.status))return error.status;
  if(error?.code==='ENOENT')return 404;
  if(STORAGE_FAILURES.has(error?.code)||SERVICE_FAILURES.has(error?.code))return 503;
  return 400;
}

/** Tag filesystem failures at write sites so ENOENT cannot be mistaken for a missing route. */
export async function withStorageFailure(label,operation){
  try{return await operation();}
  catch(cause){
    const code=typeof cause?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(cause.code)?cause.code:'STORAGE_FAILURE';
    throw Object.assign(new Error(`Persistent ${label} could not be saved`),{name:'StorageError',status:503,code,cause});
  }
}
