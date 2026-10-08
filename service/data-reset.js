import { lstat, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

export async function resetDataDirectory(target, { production = false, confirmed = false, protectedRoot, now = new Date(), pid = process.pid } = {}) {
  if (production) throw new Error('Refusing to reset data in production.');
  if (!confirmed) throw new Error('Pass --confirm to move the data directory to a dated backup.');
  target = path.resolve(target);
  if (target === path.parse(target).root) throw new Error('Refusing to reset an unsafe data directory.');
  if (protectedRoot) {
    const protectedPath = path.resolve(protectedRoot);
    if (target === protectedPath || protectedPath.startsWith(target + path.sep)) throw new Error('Data directory cannot contain the project files.');
  }
  const suffix = now.toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '');
  const backupRoot = path.join(path.dirname(target), `.${path.basename(target)}.reset-backups`);
  const backup = path.join(backupRoot, `${suffix}-${pid}`, path.basename(target));
  let exists = false;
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Data directory must be a real directory, not a symlink.');
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists) {
    await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
    await rename(target, backup);
  }
  try { await mkdir(target, { mode: 0o700 }); }
  catch (error) { if (exists) await rename(backup, target).catch(() => {}); throw error; }
  return { directory: target, backup: exists ? backup : null };
}
