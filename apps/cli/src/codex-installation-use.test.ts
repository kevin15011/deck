// Protects native CLI composition: the installation lease spans preparation through child exit,
// and deferred refresh still launches the installed generation with a warning.
import { expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultDeckConfig, type RunnerAdapter } from '@deck/core';
import { withCodexInstallationUse, trackCodexInstallationProcess, CodexInstallationBusyError } from '../../../packages/adapter-codex/src/installation-use';
import { runRunnerLaunch, createNodeRunnerProcessEffects } from './runner-launch-command';
import { _resetDeckPathCache } from './runtime/paths';

for (const deferred of [false, true]) test(`native Codex lease spans launch (deferred=${deferred})`, async () => {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'deck-native-lease-')), codexHome = join(home, '.codex');
  const leases = () => readdirSync(join(codexHome, 'deck/installation-use'));
  let spawns = 0, tracked = 0;
  const processEffects = createNodeRunnerProcessEffects();
  const messages: string[] = [];
  const adapter = {
    runnerId: 'codex', displayName: 'Codex', environmentIds: ['codex-development'],
    withNativeInstallationUse: <T>(effect: () => Promise<T>) => withCodexInstallationUse(codexHome, effect),
    trackNativeInstallationProcess: (pid: number) => {
      const release = trackCodexInstallationProcess(codexHome, pid);
      expect(leases().length).toBe(2); tracked++; return release;
    },
    buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
    readThinkingAssignments: () => ({}), readModelAssignments: () => ({}),
    applyDeveloperTeamInstall: async () => {
      expect(leases().length).toBe(1);
      if (deferred) throw new CodexInstallationBusyError();
      return { results: [], changedCount: 0, unchangedCount: 0 };
    },
    verifyDeveloperTeamInstall: () => { expect(deferred).toBe(false); return { valid: true, diagnostics: [] }; },
    backupDeveloperTeamFiles: () => ({ payload: undefined, diagnostics: [] }),
    buildLaunchPlan: () => ({ status: 'ready', diagnostics: [], plan: { command: process.execPath, args: ['-e', 'process.exit(0)'], cwd: home, stdio: 'pipe', stdin: 'closed' } }),
  } as unknown as RunnerAdapter;
  const config = getDefaultDeckConfig();
  const previousStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(home, 'state');
  _resetDeckPathCache();
  try {
    const result = await runRunnerLaunch({ adapter, yes: true, interactive: false,
      launch: { projectRoot: home, teamId: 'developer-team', mode: 'interactive', deckConfig: config },
      presentPreview: async message => { messages.push(message); },
      processEffects: { inheritedEnv: { HOME: home, CODEX_HOME: codexHome, XDG_CONFIG_HOME: join(home, 'config') }, spawn: async (command, args, options) => {
        expect(leases().length).toBe(1); spawns++; return processEffects.spawn(command, args, options);
      } },
    });
    expect(result).toMatchObject({ status: 'launched' });
    expect(spawns).toBe(1);
    expect(tracked).toBe(1);
    expect(leases()).toEqual([]);
    if (deferred) expect(messages.some(message => message.includes('deferred'))).toBe(true);
  } finally {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
    _resetDeckPathCache();
    rmSync(home, { recursive: true, force: true });
  }
});

// R3: no installation access is allowed before child protection succeeds.
test('native executable cannot start before its lease is registered', async () => {
  const { existsSync } = await import('node:fs');
  const home = mkdtempSync('/tmp/deck-gated-child-'), marker = join(home, 'started');
  try {
    let startedBeforeLease = false;
    const result = await createNodeRunnerProcessEffects().spawn('/bin/sh', ['-c', 'echo started > "$1"', 'fixture', marker], {
      cwd: home, env: {}, stdio: 'pipe', stdin: 'closed', onSpawn: () => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        startedBeforeLease = existsSync(marker);
        throw new Error('lease registration failed');
      },
    });
    expect(result.exitCode).toBe(1);
    expect(startedBeforeLease).toBe(false);
    expect(existsSync(marker)).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
