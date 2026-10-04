/** Retain typed Rust economy codes while preserving existing human-readable error text. */
export class WorkerError extends Error {
 constructor(message){
  super(typeof message==='string'?message:'Malformed Rust worker error');this.name='WorkerError';
  if(typeof message==='string')try{const value=JSON.parse(message);if(value&&typeof value.code==='string'&&/^[a-z_]+$/.test(value.code)){this.code=value.code;if(typeof value.detail==='string')this.detail=value.detail;}}catch{}
 }
}
