// Protects lease mutual exclusion, cleanup and async-scope lifetime, independently of adapter refresh.
import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withCodexInstallationUse, withCodexInstallationMutation } from './installation-use';

test('native use excludes unrelated writes and writes exclude new native use', async () => {
  const root = mkdtempSync('/tmp/deck-codex-lease-');
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  try {
    const running = withCodexInstallationUse(root, async () => {
      await withCodexInstallationMutation(root, async () => {}); // own preparation
      enter(); await held;
    });
    await entered;
    await expect(withCodexInstallationMutation(root, async () => {})).rejects.toThrow('refresh deferred');
    release(); await running;
    await withCodexInstallationMutation(root, async () => {
      await expect(withCodexInstallationUse(root, async () => {})).rejects.toThrow('refresh deferred');
    });
    await expect(withCodexInstallationUse(root, async () => { throw new Error('spawn failed'); })).rejects.toThrow('spawn failed');
    expect(readdirSync(join(root, 'deck/installation-use'))).toEqual([]);
  } finally { release(); rmSync(root, { recursive: true, force: true }); }
});

// R2: a live PID with a different birth identity is not the lease owner.
test('reused PID and stale writer leases do not block native use', async () => {
  const root = mkdtempSync('/tmp/deck-stale-lease-');
  const dir = join(root, 'deck/installation-use'); mkdirSync(dir, { recursive: true });
  try {
    for (const kind of ['use', 'write']) writeFileSync(join(dir, `${process.pid}-00000000-0000-0000-0000-000000000000.${kind}`), JSON.stringify({ identity: 'previous-boot:previous-process' }));
    await withCodexInstallationUse(root, async () => {
      await withCodexInstallationMutation(root, async () => {});
    });
    expect(readdirSync(dir)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
