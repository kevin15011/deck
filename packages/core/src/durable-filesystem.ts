import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** A completed barrier is required before publishing a child or releasing its binding.
 * This is process-crash ordering; it is not a portable power-loss guarantee. */
export function syncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try {
    if (!fstatSync(fd).isDirectory()) throw new Error('runner-directory-unsafe');
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/** Never follows symlinks or changes permissions of an existing directory. */
export function ensureDurableDir(path: string, mode: number): void {
  const missing: string[] = [];
  let nearest: string | undefined;
  for (let cursor = resolve(path);; cursor = dirname(cursor)) {
    try {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('runner-directory-unsafe');
      nearest ??= cursor;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (nearest) throw new Error('runner-directory-changed');
      missing.push(cursor);
    }
    if (dirname(cursor) === cursor) break;
  }
  // Also completes the barrier when a previous attempt stopped just after mkdir.
  syncDirectory(dirname(nearest!));
  for (const directory of missing.reverse()) {
    try { mkdirSync(directory, { mode }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('runner-directory-unsafe');
    syncDirectory(dirname(directory));
  }
}
