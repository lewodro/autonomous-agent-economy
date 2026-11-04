const STORAGE_FAILURES=new Set(['EACCES','EBUSY','EIO','EMFILE','ENFILE','ENOSPC','EPERM','EROFS']);
const SERVICE_FAILURES=new Set(['rpc_unavailable','storage_failure']);
const PUBLIC_DOMAIN_ERRORS=new Map([
  ['NOT_ENOUGH_CREDITS','You need more credits for that action.'],
  ['TOO_FAR','Walk closer and try again.'],
  ['PLOT_OCCUPIED','Another visitor claimed this plot first.'],
  ['PLOT_LIMIT','You are already tending the maximum number of plots.'],
  ['CROP_NOT_READY','This crop is still growing.'],
  ['NOT_OWNER','This crop belongs to another visitor.'],
  ['INVENTORY_TOO_LOW','You do not carry enough of that resource.'],
  ['MARKET_REQUIRED','Carry your produce to the Market before selling.'],
  ['LEVEL_REQUIRED','Raise your farming level to unlock this crop.'],
]);

/** Preserve client/domain statuses while reporting local storage faults as service failures. */
export function requestErrorStatus(error){
  if(Number.isInteger(error?.status))return error.status;
  if(error?.code==='ENOENT')return 404;
  if(STORAGE_FAILURES.has(error?.code)||SERVICE_FAILURES.has(error?.code))return 503;
  return 400;
}

/** Expose only reviewed domain copy in production; unexpected details stay private. */
export function publicRequestError(error,{production=false}={}){
  const status=requestErrorStatus(error);
  let detail;try{detail=JSON.parse(error?.message);}catch{}
  const code=error?.code||detail?.code;
  if(!production)return {status,code,error:error?.message||'Request failed'};
  const domainMessage=typeof code==='string'?PUBLIC_DOMAIN_ERRORS.get(code):undefined;
  const message=domainMessage||(status===404?'Not found':status===413?'Request too large':status===429?'Too many requests':status<500?'Request rejected':'Service temporarily unavailable');
  return {status,code,error:message};
}

/** Tag filesystem failures at write sites so ENOENT cannot be mistaken for a missing route. */
export async function withStorageFailure(label,operation){
  try{return await operation();}
  catch(cause){
    const code=typeof cause?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(cause.code)?cause.code:'STORAGE_FAILURE';
    throw Object.assign(new Error(`Persistent ${label} could not be saved`),{name:'StorageError',status:503,code,cause});
  }
}
