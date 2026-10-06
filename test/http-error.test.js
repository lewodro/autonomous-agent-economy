import test from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorStatus, withStorageFailure } from '../service/http-error.js';

test('HTTP error mapping separates client errors from unavailable local storage',()=>{
  assert.equal(requestErrorStatus(Object.assign(new Error('malformed request'),{status:409})),409);
  assert.equal(requestErrorStatus(Object.assign(new Error('record missing'),{code:'ENOENT'})),404);
  for(const code of ['EACCES','EBUSY','EIO','EMFILE','ENFILE','ENOSPC','EPERM','EROFS'])
    assert.equal(requestErrorStatus(Object.assign(new Error('private filesystem path'),{code})),503,code);
  assert.equal(requestErrorStatus(new Error('invalid action')),400);
});

test('persistence ENOENT remains a service failure while missing reads remain 404',async()=>{
  const failure=Object.assign(new Error('missing parent /private/data'),{code:'ENOENT'});
  await assert.rejects(()=>withStorageFailure('world table',async()=>{throw failure;}),error=>{
    assert.equal(error.name,'StorageError');assert.equal(error.status,503);assert.equal(error.code,'ENOENT');
    assert.equal(error.message,'Persistent world table could not be saved');
    assert.equal(requestErrorStatus(error),503);return true;
  });
  assert.equal(requestErrorStatus(failure),404);
});
