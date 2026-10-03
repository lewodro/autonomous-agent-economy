import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export class Core {
  constructor({ worker } = {}) {
    this.pending = []; this.closed = false;
    this.worker = worker ?? spawn(path.join(root, 'rust/target/debug/table-core'), ['--serve'], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
    readline.createInterface({ input: this.worker.stdout }).on('line', line => {
      const item = this.pending.shift(); if (!item) return;
      try { const value = JSON.parse(line); value.ok ? item.resolve(value.result) : item.reject(new Error(value.error)); }
      catch (error) { item.reject(error); }
    });
    const fail = error => { this.closed = true; for (const p of this.pending.splice(0)) p.reject(error); };
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
