import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {readBoundedJson} from '../service/safe-json.js';

test('bounded JSON reader parses valid data within its limit',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-safe-json-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'record.json');await writeFile(file,JSON.stringify({state:'ready'}),{mode:0o600});
 assert.deepEqual(await readBoundedJson(file,{maxBytes:128,label:'test record'}),{state:'ready'});
});

test('bounded JSON reader rejects oversized files before parsing',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-safe-json-large-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'record.json');await writeFile(file,' '.repeat(129));
 await assert.rejects(readBoundedJson(file,{maxBytes:128,label:'test record'}),{status:503,code:'PERSISTED_JSON_TOO_LARGE'});
});

test('bounded JSON reader refuses symlinked checkpoint paths',async t=>{
 if(!process.platform.startsWith('linux')&&!process.platform.startsWith('darwin'))return t.skip('O_NOFOLLOW behavior is platform-specific');
 const dir=await mkdtemp(path.join(os.tmpdir(),'aae-safe-json-link-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const target=path.join(dir,'target.json'),link=path.join(dir,'record.json');await writeFile(target,'{}');await symlink(target,link);
 await assert.rejects(readBoundedJson(link,{maxBytes:128}),error=>error.code==='ELOOP');
 assert.equal((await readFile(target,'utf8')),'{}');
});
