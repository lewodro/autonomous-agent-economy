import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HostCookieStore, sessionCookie } from '../mcp/host-cookie-store.js';

const session = '8d5c778d-64ee-40e1-a392-13cb3992f2da';
const expires = Math.floor(Date.now() / 1000) + 86_400;
const cookie = `last_seat_host=${session}.${expires}.${'a'.repeat(43)}; Path=/api/matches/${session}/; HttpOnly; SameSite=Strict`;

test('scoped host cookies are accepted only for their matching arena and never include cookie attributes', () => {
  assert.equal(sessionCookie(cookie, session), cookie.split(';', 1)[0]);
  assert.equal(sessionCookie(cookie, '9d5c778d-64ee-40e1-a392-13cb3992f2da'), null);
  assert.equal(sessionCookie('last_seat_host=not-a-session; HttpOnly', session), null);
  assert.equal(sessionCookie(`last_seat_host=${session}.${Math.floor(Date.now() / 1000) - 1}.${'a'.repeat(43)}`, session), null);
  assert.equal(sessionCookie(`last_seat_host=${session}.${Math.floor(Date.now() / 1000) + 3_000_000}.${'a'.repeat(43)}`, session), null);
});

test('host cookie storage survives reload with owner-only local permissions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-seat-mcp-'));
  const file = path.join(directory, 'sessions.json');
  try {
    const store = new HostCookieStore(file);
    await store.load();
    await store.set(session, cookie);
    assert.equal(store.get(session), cookie.split(';', 1)[0]);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { [session]: cookie.split(';', 1)[0] });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    const recovered = await new HostCookieStore(file).load();
    assert.equal(recovered.get(session), cookie.split(';', 1)[0]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('host cookie persistence flushes the directory and recovers after a sync error',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'last-seat-mcp-sync-')),file=path.join(directory,'sessions.json');let failSync=true;
  try{
    const store=new HostCookieStore(file,{syncFolder:async()=>{if(failSync){failSync=false;throw new Error('simulated directory sync failure');}}});await store.load();
    await assert.rejects(store.set(session,cookie),/simulated directory sync failure/);
    assert.equal(store.get(session),cookie.split(';',1)[0]);
    assert.deepEqual(await readdir(directory),['sessions.json']);
    const recovered=await new HostCookieStore(file).load();assert.equal(recovered.get(session),cookie.split(';',1)[0]);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('unknown arena sessions fail clearly instead of fabricating host authority', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'last-seat-mcp-'));
  try {
    const store = await new HostCookieStore(path.join(directory, 'sessions.json')).load();
    assert.throws(() => store.get(session), /no saved control session/);
    await assert.rejects(store.set(session, 'invalid'), /did not return a valid host-session cookie/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
