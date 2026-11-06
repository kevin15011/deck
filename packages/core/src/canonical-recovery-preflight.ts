import { lstatSync, readFileSync } from 'node:fs';
import { assertPrivateStatePath } from './runner-history';

/** Read a fixed adapter journal, never a journal-selected path. No effects. */
export function inspectRecoveryJournal(path: string): { value: any; unchanged(): void } | undefined {
  assertPrivateStatePath(path);
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 8 * 1024 * 1024 || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('runner-recovery-journal-unsafe');
    text = readFileSync(path, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const value = JSON.parse(text);
  return { value, unchanged() {
    assertPrivateStatePath(path);
    if (readFileSync(path, 'utf8') !== text) throw new Error('runner-recovery-journal-changed');
  } };
}
export const recoveryHash = (value: unknown): boolean => value === 'absent' || typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
