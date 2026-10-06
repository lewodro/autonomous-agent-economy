import test from 'node:test';
import assert from 'node:assert/strict';
import { requestErrorStatus } from '../service/http-error.js';

test('HTTP error mapping separates client errors from unavailable local storage',()=>{
  assert.equal(requestErrorStatus(Object.assign(new Error('malformed request'),{status:409})),409);
  assert.equal(requestErrorStatus(Object.assign(new Error('record missing'),{code:'ENOENT'})),404);
  for(const code of ['EACCES','EBUSY','EIO','EMFILE','ENFILE','ENOSPC','EPERM','EROFS'])
    assert.equal(requestErrorStatus(Object.assign(new Error('private filesystem path'),{code})),503,code);
  assert.equal(requestErrorStatus(new Error('invalid action')),400);
});
