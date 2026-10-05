import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COOKIE = /^last_seat_host=([0-9a-f-]{36})\.(\d{10})\.([A-Za-z0-9_-]{40,50})$/;
const MAX_SESSIONS = 100;

export function sessionCookie(setCookie, session) {
  if (!SESSION_ID.test(session) || typeof setCookie !== 'string') return null;
  const value = setCookie.split(';', 1)[0];
  const match = value.match(COOKIE);
  return match?.[1] === session ? value : null;
}

export class HostCookieStore {
  constructor(file = path.resolve('matches/mcp/host-sessions.json')) {
    this.file = file;
    this.sessions = new Map();
  }

  async load() {
    try {
      const entries = JSON.parse(await readFile(this.file, 'utf8'));
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('invalid host session store');
      this.sessions.clear();
      for (const [session, cookie] of Object.entries(entries).slice(-MAX_SESSIONS)) {
        if (sessionCookie(cookie, session)) this.sessions.set(session, cookie);
      }
      await chmod(this.file, 0o600);
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
    await chmod(path.dirname(this.file), 0o700);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 });
      await rename(temporary, this.file);
      await chmod(this.file, 0o600);
    } catch (error) {
      throw new Error(`Cannot save the local MCP host-session store: ${error.message}`);
    }
  }
}
