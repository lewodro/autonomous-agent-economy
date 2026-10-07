import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetDataDirectory } from '../service/data-reset.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.resolve(process.env.MATCHES_DIR || path.join(root, 'matches'));
const result = await resetDataDirectory(target, { production: process.env.NODE_ENV === 'production', confirmed: process.argv.includes('--confirm'), protectedRoot: root });
console.log(JSON.stringify({ status: 'reset', ...result,
  message: 'A fresh data directory is ready. Previous data remains in the backup; restore it only while the app is stopped.' }));
