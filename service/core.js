import {WorkerError} from './worker-error.js';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export class Core {
  constructor({ worker } = {}) {
    this.pending = []; this.closed = false;
    this.worker = worker ?? spawn(path.join(root, 'rust/target/debug/table-core'), ['--serve'], { cwd: root, env: {...process.env,ECONOMY_DIR:process.env.ECONOMY_DIR||path.join(process.env.MATCHES_DIR||path.join(root,'matches'),'economy')}, stdio: ['pipe', 'pipe', 'inherit'] });
    const fail = error => { this.closed = true; for (const p of this.pending.splice(0)) p.reject(error); };
    const protocolFailure = error => { fail(error); this.worker.kill(); };
    readline.createInterface({ input: this.worker.stdout }).on('line', line => {
      if (this.closed) return;
      let value;
      try {
        value = JSON.parse(line);
        if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean'
          || (value.ok && (!Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error')))
          || (!value.ok && (typeof value.error !== 'string' || Object.hasOwn(value, 'result')))) {
          throw new Error('Invalid response envelope');
        }
      } catch { protocolFailure(new Error('Rust worker protocol violation; restart the local service')); return; }
      const item = this.pending.shift(); if (!item) return;
      value.ok ? item.resolve(value.result) : item.reject(new WorkerError(value.error));
    });
    this.worker.stdout.on('end', () => {
      if (!this.closed) protocolFailure(new Error('Rust worker response stream closed; restart the local service'));
    });
    this.worker.stdout.on('error', protocolFailure);
    this.worker.stdin.on('error', fail);
    this.worker.on('error', fail); this.worker.on('exit', () => fail(new Error('Rust worker stopped. Restart the local service.')));
  }
  request(input) {
    if (this.closed) return Promise.reject(new Error('Rust worker is unavailable'));
    let message;
    try { message = JSON.stringify(input) + '\n'; }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.worker.stdin.write(message);
    });
  }
  stop() { this.worker.kill(); }
}
