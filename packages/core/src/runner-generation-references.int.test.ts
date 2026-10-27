import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { contributionHash } from './runner-contributions';
import { acquireRunnerGenerationReference, guardRunnerGenerationRetirement, inspectRunnerGenerationReferences } from './runner-generation-references';

test('replacement selection, active launch receipts and collection use one exclusion gate', () => {
  const parent = mkdtempSync(join(tmpdir(), 'deck-generation-refs-'));
  try {
    const root = join(parent, 'developer-team-v2-abcdef'), replacement = join(parent, 'developer-team-v2-fedcba'), selectionPath = join(parent, 'model-assignments.json');
    mkdirSync(root); mkdirSync(replacement);
    writeFileSync(selectionPath, JSON.stringify({ plugin: 'developer-team-v2-abcdef' }));
    const reference = { root, selectionPath, selectionHash: contributionHash(readFileSync(selectionPath)) };
    expect(inspectRunnerGenerationReferences(root, selectionPath).join(' ')).toContain('replacement');
    const release = acquireRunnerGenerationReference(reference);
    writeFileSync(selectionPath, JSON.stringify({ plugin: 'developer-team-v2-fedcba' }));
    expect(() => guardRunnerGenerationRetirement(root, selectionPath)).toThrow('reference');
    release();
    if (process.platform === 'linux') {
      expect(inspectRunnerGenerationReferences(root, selectionPath)).toEqual([]);
      const finish = guardRunnerGenerationRetirement(root, selectionPath);
      expect(() => acquireRunnerGenerationReference(reference)).toThrow('retired'); finish();
      expect(() => acquireRunnerGenerationReference(reference)).toThrow('changed');
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('native process references cover multiple and relative plugin paths', async () => {
  if (process.platform !== 'linux') return;
  const parent = mkdtempSync(join(tmpdir(), 'deck-native-generation-ref-'));
  const root = join(parent, 'developer-team-v2-abcdef'); mkdirSync(root);
  const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000); process.stdout.write("ready\\n")', '--', '--plugin-dir', 'other-plugin', 'developer-team-v2-abcdef'], { cwd: parent, stdout: 'pipe', stderr: 'ignore' });
  try {
    // spawn may return before exec has published the child's argv/cwd in /proc.
    const reader = child.stdout.getReader();
    try {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      expect(new TextDecoder().decode(value)).toBe('ready\n');
    } finally { reader.releaseLock(); }
    expect(inspectRunnerGenerationReferences(root, join(parent, 'model-assignments.json')).join(' ')).toContain(`Native process ${child.pid}`);
  } finally { child.kill(); await child.exited; rmSync(parent, { recursive: true, force: true }); }
});
