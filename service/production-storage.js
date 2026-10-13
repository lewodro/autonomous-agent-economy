import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BOOTSTRAP_FILE = '.production-bootstrap.json';
export const BOOTSTRAP_VERSION = 1;
const CANONICAL_AGENTS = Array.from({ length: 20 }, (_, index) => `agent-${index + 1}`);

const bootstrapRecord = () => ({
  version: BOOTSTRAP_VERSION,
  kind: 'autonomous-agent-economy-production',
  public_world_id: 'main',
  canonical_agent_ids: CANONICAL_AGENTS,
  runtime_history_starts_empty: true,
  private_experiments_start_empty: true,
});

async function readBootstrap(directory) {
  try {
    const record = JSON.parse(await readFile(path.join(directory, BOOTSTRAP_FILE), 'utf8'));
    if (record.version !== BOOTSTRAP_VERSION || record.kind !== 'autonomous-agent-economy-production'
      || record.public_world_id !== 'main' || JSON.stringify(record.canonical_agent_ids) !== JSON.stringify(CANONICAL_AGENTS)
      || record.runtime_history_starts_empty !== true || record.private_experiments_start_empty !== true) {
      throw new Error('Invalid production bootstrap marker');
    }
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('Invalid production bootstrap marker');
    throw error;
  }
}

/**
 * Production storage is a separate durable namespace from the source checkout.
 * An unmarked nonempty directory is rejected so local runtime history cannot
 * silently become public data. The marker contains configuration only; it does
 * not seed matches, users, balances, receipts, or private logs.
 */
export async function ensureProductionStorage(directory, { production = false } = {}) {
  await mkdir(directory, { recursive: true });
  if (!production) return { initialized: false, marker: null };
  const existing = await readBootstrap(directory);
  if (existing) return { initialized: false, marker: existing };
  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw new Error(`Production storage is not a clean initialized volume: ${directory}. Point MATCHES_DIR at a new persistent volume; local runtime data was not modified.`);
  }
  const marker = bootstrapRecord();
  await writeFile(path.join(directory, BOOTSTRAP_FILE), `${JSON.stringify(marker, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { initialized: true, marker };
}

export function productionBootstrapSummary() {
  return { public_world_id: 'main', canonical_agents: CANONICAL_AGENTS.length, private_experiments: 0, public_history: 0 };
}
