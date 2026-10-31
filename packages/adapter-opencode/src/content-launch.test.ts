import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createOpenCodeSessionDriver } from './session-driver/driver';
import { withInstallationMutation } from '../../core/src/installation-use';
import { setup, home, root, config, install } from './content-refresh.fixture';
setup();

// Protects launch-before-use ordering at the default driver boundary, with fake process effects.
test('cross launch registers the gated child before permitting installation use', async () => {
  const adapter = await install();
  const role = await adapter.prepareSessionNativeRole('deck-quality', config());
  const driver = createOpenCodeSessionDriver({ baseEnv: { HOME: home, XDG_CONFIG_HOME: home }, requireNativeRole: true });
  let resolveExit!: (value: any) => void;
  const exited = new Promise<any>(resolve => { resolveExit = resolve; });
  let gated = false;
  const input = { memberId: 'quality', nativeRoleDescriptor: role, cwd: home, mcp: { servers: [] }, mcpServerSpecs: {}, approvals: 'relay', projectConfigTrusted: false };
  await expect(driver.startTask(input as any, {
    writePrivateFile: (name: string) => join(home, name),
    spawn: async (command: string, args: string[]) => {
      expect(command).toBe('/bin/sh'); expect(args).toContain('deck-opencode-gate');
      await expect(withInstallationMutation(root, async () => {})).rejects.toThrow('refresh deferred');
      return {
        ready: Promise.resolve({ workerPid: process.pid }), exited,
        writeStdin: () => {
          expect(readdirSync(join(root, 'deck/installation-use')).filter(p => p.endsWith('.use')).length).toBe(2);
          gated = true; throw new Error('fake child stops before runner execution');
        },
        terminateGroup: async () => { resolveExit({ ok: false }); },
      };
    },
  } as any)).rejects.toThrow('fake child stops');
  expect(gated).toBe(true);
  await withInstallationMutation(root, async () => {});
});
// Protects minimum version admission independently of execution plugins.
test('newer OpenCode permits ordinary work with a version warning', async () => {
  const driver = createOpenCodeSessionDriver({ exec: async () => ({ code: 0, stdout: 'OpenCode 99.0.0' }) });
  const result = await driver.probe({ cwd: home } as any);
  expect(result.status).toBe('degraded'); expect(result.reasonCode).toBe('opencode-version-untested');
});
