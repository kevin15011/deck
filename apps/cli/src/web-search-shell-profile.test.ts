import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DECK_WEB_SEARCH_PROFILE_START as start, DECK_WEB_SEARCH_PROFILE_END as end, readOwnedTavilyCredential, writeTavilyCredentialToActiveShellProfileTransaction } from './web-search-shell-profile';
// Protects duplicate generated spans, exact foreign bytes, rollback, and secret-free persistent recovery.
// Oracle: only well-formed owned spans collapse; secrets stay in memory for rollback.
test('collapses well-formed Tavily spans without persistent credential backups', () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-profile-managed-')));
 try {
  const profile = join(home, '.zshrc'), options = { home, shell: '/bin/zsh' };
  const block = (key: string) => `${start}\nexport TAVILY_API_KEY='${key}'\n${end}`;
  const before = `# before\n${block('old-a')}\n# between\n${block('old-b')}\n# after\n`;
  writeFileSync(profile, before, { mode: 0o600 });
  const transaction = writeTavilyCredentialToActiveShellProfileTransaction('new-value', options);
  expect(transaction.result.ok).toBe(true);
  const after = readFileSync(profile, 'utf8');
  expect(after.split(start)).toHaveLength(2);
  expect(after).toContain('# between\n'); expect(after).toContain('# before\n'); expect(after).toContain('# after\n');
  expect(readOwnedTavilyCredential(options)).toBe('new-value');
  expect(JSON.stringify(transaction.result)).not.toContain('new-value');
  expect(readdirSync(home)).toEqual(['.zshrc']);
  expect(transaction.rollback().ok).toBe(true);
  expect(readFileSync(profile, 'utf8')).toBe(before);
 } finally { rmSync(home, { recursive: true, force: true }); }
});
