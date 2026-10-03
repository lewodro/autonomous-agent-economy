import { readFile } from 'node:fs/promises';
import { validateState } from '../src/storage.js';
const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/verify-audit.js path/to/run.json');
const state = await validateState(JSON.parse(await readFile(file, 'utf8')));
console.log(`Verified ${state.matches.length} settlements, ${state.events.length} ledger events, and all bankroll/statistics records. Local simulation evidence only.`);
