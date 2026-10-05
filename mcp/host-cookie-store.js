import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = /^last_seat_host=([0-9a-f-]{36})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;
const MAX_SESSIONS = 100;
const COOKIE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookie(setCookie, session) {
  if (!SESSION_ID.test(session) || typeof setCookie !== 'string') return null;
  const value = setCookie.split(';', 1)[0];
  const match = value.match(COOKIE);
  if (match?.[1] !== session) return null;
  const expires = Number(match[2]);
  const now = Math.floor(Date.now() / 1000);
  return expires >= now && expires <= now + COOKIE_LIFETIME_SECONDS + 60 ? value : null;
}

export class HostCookieStore {
  constructor(file = path.resolve('matches/mcp/host-sessions.json')) {
    this.file = file;
    this.sessions = new Map();
  }

  async load() {
    try {
      const handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let entries;
      try {
        if (!(await handle.stat()).isFile()) throw new Error('host session store is not a regular file');
        entries = JSON.parse(await handle.readFile('utf8'));
        await handle.chmod(0o600);
      } finally {
        await handle.close();
      }
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('invalid host session store');
      this.sessions.clear();
      for (const [session, cookie] of Object.entries(entries).slice(-MAX_SESSIONS)) {
        if (sessionCookie(cookie, session)) this.sessions.set(session, cookie);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load the local MCP host-session store: ${error.message}`);
    }
    return this;
  }

  async set(session, setCookie) {
    const cookie = sessionCookie(setCookie, session);
    if (!cookie) throw new Error('The local arena service did not return a valid host-session cookie.');
    this.sessions.delete(session);
    this.sessions.set(session, cookie);
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value);
    await this.persist();
  }

  get(session) {
    const cookie = this.sessions.get(session);
    if (!cookie) throw new Error('This MCP host has no saved control session for the arena. Create a new arena with this host.');
    return cookie;
  }

  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      await writeFile(temporary, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
      renamed = true;
    } catch (error) {
      throw new Error(`Cannot save the local MCP host-session store: ${error.message}`);
    } finally {
      if (!renamed) await unlink(temporary).catch(() => {});
    }
  }
}
