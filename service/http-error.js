const STORAGE_FAILURES=new Set(['EACCES','EBUSY','EIO','EMFILE','ENFILE','ENOSPC','EPERM','EROFS']);

/** Preserve client/domain statuses while reporting local storage faults as service failures. */
export function requestErrorStatus(error){
  if(Number.isInteger(error?.status))return error.status;
  if(error?.code==='ENOENT')return 404;
  if(STORAGE_FAILURES.has(error?.code))return 503;
  return 400;
}
