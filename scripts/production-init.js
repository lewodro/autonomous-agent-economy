import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureProductionStorage, productionBootstrapSummary } from '../service/production-storage.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.resolve(process.env.MATCHES_DIR || path.join(root, 'matches'));
const result = await ensureProductionStorage(directory, { production: true });
console.log(JSON.stringify({ ok: true, directory, initialized: result.initialized, ...productionBootstrapSummary(), note: 'No matches, users, balances, receipts, or private logs were seeded.' }));
