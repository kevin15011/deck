import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createCodexRunnerAdapter } from '../../../packages/adapter-codex/src/runner-adapter';
import { createNodeCodexFileEffects } from '../../../packages/adapter-codex/src/node-effects';
import { getDefaultDeckConfig } from '@deck/core';
import { previewExplicitCodexRecovery } from './explicit-codex-recovery';
const root = process.argv[2]!;
const effects = createNodeCodexFileEffects({ journalRoot: join(root, 'journals') });
const adapter = createCodexRunnerAdapter({ userHome: root, codexHome: join(root, '.codex'), journalRoot: join(root, 'journals'),
 fileEffects: { ...effects, writeAtomic: async (...args) => { await effects.writeAtomic(...args); process.kill(process.pid, 'SIGKILL'); } },
 tools: { homeDir: root, dataRoot: join(root, 'deck'), resolveCommand: () => undefined, nodeCommand: process.execPath, verifyNodeRuntime: () => true } });
// Seed unrelated content before the controlled real target rename. The pending
// operation still lacks config.toml; only its recovery writes are crash-injected.
const input = { projectRoot: root, environmentId: 'codex-development', deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
for (const file of adapter.buildDeveloperTeamInstallPlan(input).files) {
 const target = join(root, file.path);
 if (target === join(root, '.codex/config.toml')) continue;
 mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, file.content, {mode: 0o644});
}
const preview = await previewExplicitCodexRecovery(adapter, input,
 { path: join(root, 'state/fence.json'), self: { semver: '0.14.0', commit: 'recovery', channel: 'canary' }, stateSchema: 1 }, async effect => effect());
await preview.apply();
