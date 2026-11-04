import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { getDefaultDeckConfig, type RunnerAdapter } from '@deck/core';
import { planOpenCodeRefresh } from '../../../packages/adapter-opencode/src/content-refresh';
import { runRunnerLaunch } from './runner-launch-command';

// Q2/L1: native orchestration checks delegated roles and returns a clean blocked result.
for (const rejected of ['deck-quality', 'deck-lead', 'planning', 'admission']) test('native launch reports security refusal for ' + rejected, async () => {
  const home = mkdtempSync('/tmp/deck-s4-native-');
  let spawns = 0;
  if (rejected === 'planning') {
    writeFileSync(home + '/target.js', 'user executable');
    symlinkSync(home + '/target.js', home + '/plugin.js');
  }
  const adapter = {
    runnerId: 'opencode', displayName: 'OpenCode', environmentIds: ['opencode-development'],
    readModelAssignments: () => ({}), readThinkingAssignments: () => ({}),
    buildDeveloperTeamInstallPlan: () => {
      if (rejected === 'planning') planOpenCodeRefresh(home, [{ path: 'plugin.js', content: 'owned', kind: 'other' }], {});
      return { files: [], mutationPreview: [] };
    },
    ...(rejected === 'admission' ? { withNativeInstallationUse: async () => { throw new Error('execution-plugin-untrusted: remove the conflicting plugin'); } } : {}),
    applyDeveloperTeamInstall: async () => ({ results: [], changedCount: 0, unchangedCount: 0 }),
    verifyDeveloperTeamInstall: () => ({ valid: true, diagnostics: [] }),
    backupDeveloperTeamFiles: () => ({ payload: undefined, diagnostics: [] }),
    prepareSessionNativeRole: async (role: string) => {
      if (role === rejected) throw new Error(role === 'deck-quality' ? 'deck-quality permission bash grants unsafe access; restore deny' : 'execution-plugin-untrusted: remove the conflicting plugin');
      return {};
    },
    buildLaunchPlan: () => ({ status: 'ready', diagnostics: [], plan: { command: 'never-run', args: [], cwd: home, stdio: 'pipe', stdin: 'closed' } }),
  } as unknown as RunnerAdapter;
  const config = getDefaultDeckConfig();
  try {
    const result = await runRunnerLaunch({ adapter, yes: true, interactive: false,
      launch: { projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config },
      presentPreview: async () => {}, processEffects: { inheritedEnv: { HOME: home }, spawn: async () => { spawns++; return { exitCode: 0, stdout: "", stderr: "" }; } },
    });
    expect(result).toMatchObject({ status: 'blocked', message: expect.stringContaining(rejected === 'planning' ? 'symlink boundary' : rejected === 'deck-quality' ? 'deck-quality permission bash' : 'remove the conflicting plugin') });
    expect(spawns).toBe(0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
