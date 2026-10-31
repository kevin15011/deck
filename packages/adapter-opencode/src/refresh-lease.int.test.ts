import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { contributionHash, getDefaultDeckConfig } from '@deck/core';
import { createOpenCodeRunnerAdapter } from './runner-adapter';

// Protects independent invocations from refresh, through the adapter's real preparation path.
test('another invocation defers refresh, warns, and leaves installed content unchanged', async () => {
  const home = mkdtempSync('/tmp/deck-s4-lease-'), root = join(home, 'opencode');
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = home;
  let release!: () => void;
  try {
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root });
    const config = getDefaultDeckConfig();
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: 'opencode-development', deckConfig: config, standaloneSkills: [] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: 'opencode-development', plan });
    const path = join(root, 'prompts/deck-team/deck-quality.md'), receiptPath = join(root, 'deck/manifest.json');
    writeFileSync(path, 'previous owned prompt');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.contributions.find((e: any) => e.path === path).hash = contributionHash('previous owned prompt');
    writeFileSync(receiptPath, JSON.stringify(receipt));
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const running = adapter.withNativeInstallationUse!(async () => { enter(); await held; });
    await entered;
    const role = await adapter.prepareSessionNativeRole!('deck-quality', config);
    expect(role.instructions).toBe('previous owned prompt');
    expect(role.preparation?.some(f => f.code === 'opencode-refresh-deferred')).toBe(true);
    expect(readFileSync(receiptPath, 'utf8')).toBe(JSON.stringify(receipt));
    release(); await running;
  } finally {
    release?.();
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(home, { recursive: true, force: true });
  }
});
