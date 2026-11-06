import { realpathSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, dirname } from 'node:path';
import { OWNED_RTK_VERSION, inspectOwnedRtk, installOwnedRtk, pinnedOwnedRtkRelease, recordOwnedRunnerArtifactTree, resolveDefaultDeckDataRoot, PIN_RTK_REWRITE_SOURCE, type RtkReleaseArtifact } from '@deck/core';
import { withInstallationMutation } from '../../core/src/installation-use';
import { assertTrustedAncestors, ensurePrivatePath } from './codebase-private-path';
import { planOpenCodeRefresh, applyOpenCodeRefresh } from './content-refresh';

export type OpenCodeRtkOptions = {
  homeDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  dataRoot?: string;
  release?: RtkReleaseArtifact;
  artifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
};

/** The runner loads this generated bridge, which authenticates the native leaf before invoking it. */
export function renderOpenCodeRtkPlugin(binary: string, hash: string): string {
  return `import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
${PIN_RTK_REWRITE_SOURCE}
export default async () => ({
  'tool.execute.before': async (input, output) => {
    if (input.tool !== 'bash' || typeof output.args?.command !== 'string') return;
    try {
      const binary = ${JSON.stringify(binary)};
      if (realpathSync(binary) !== binary || !lstatSync(binary).isFile()) return;
      if (createHash('sha256').update(readFileSync(binary)).digest('hex') !== ${JSON.stringify(hash)}) return;
      const result = spawnSync(binary, ['hook', 'claude'], {
        input: JSON.stringify({tool_name: 'Bash', tool_input: {command: output.args.command}}),
        encoding: 'utf8', timeout: 3000, maxBuffer: 512 * 1024, stdio: ['pipe', 'pipe', 'ignore']
      });
      if (result.status !== 0 || result.error) return;
      const hook = JSON.parse(result.stdout).hookSpecificOutput;
      if (hook?.hookEventName !== 'PreToolUse' || typeof hook.updatedInput?.command !== 'string') return;
      const command = pinRtkRewrite(hook.updatedInput.command, binary);
      if (command !== undefined) output.args.command = command;
    } catch { /* Preserve the original command when verified optimization is unavailable. */ }
  }
});
`;
}

/** Public RTK acquisition never runs an upstream shell installer or an existing PATH executable. */
export function createOpenCodeRtkTools(options: OpenCodeRtkOptions = {}) {
  const env = options.environment ?? process.env;
  const input = options.homeDirectory ?? env.HOME;
  if (!input || !isAbsolute(input)) throw new Error('OpenCode RTK requires absolute HOME.');
  const home = realpathSync(input), data = resolve(options.dataRoot ?? resolveDefaultDeckDataRoot(env, home));
  if (basename(data) !== 'deck' || data === home) throw new Error('OpenCode RTK requires the dedicated Deck data root.');
  const root = join(data, 'opencode', 'tools', `rtk-v${OWNED_RTK_VERSION}`, `${process.platform}-${process.arch}`);
  const configRoot = env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode');
  const release = options.release ?? pinnedOwnedRtkRelease();
  const binary = join(root, 'rtk');
  const desired = () => [{path: 'plugins/rtk.ts', content: renderOpenCodeRtkPlugin(binary, release!.binarySha256), kind: 'other' as const}];
  const state = () => {
    if (!release) return 'unsupported';
    try { assertTrustedAncestors(root, home); return inspectOwnedRtk(root, release); }
    catch { return 'conflict'; }
  };
  const ready = () => {
    if (state() !== 'ready') return false;
    try { const plan = planOpenCodeRefresh(configRoot, desired(), {}); return !plan.drift && !plan.writes.length && !plan.findings.length; } catch { return false; }
  };
  return { root, configRoot, state, ready, command: () => ready() ? binary : undefined,
    async install(signal?: AbortSignal) {
      return withInstallationMutation(configRoot, async () => {
        signal?.throwIfAborted();
        if (!release) throw new Error('No pinned RTK release exists for this platform.');
        const plan = planOpenCodeRefresh(configRoot, desired(), {});
        if (plan.findings.length) throw new Error('RTK plugin conflicts with unrecognized shared content.');
        await ensurePrivatePath(dirname(root), home);
        signal?.throwIfAborted();
        await installOwnedRtk(root, release, options.artifactEffects);
        signal?.throwIfAborted();
        // Artifact receipts are issued only after canonical acquisition; plugin CAS uses the prior envelope.
        applyOpenCodeRefresh(configRoot, plan);
        recordOwnedRunnerArtifactTree({ runnerId: 'opencode', root: configRoot, manifestPath: join(configRoot, 'deck/manifest.json'), artifactRoot: root, sourceItemId: 'package:rtk' });
        if (!ready()) throw new Error('RTK installation postimage mismatch.');
      });
    }
  };
}
export type OpenCodeRtkTools = ReturnType<typeof createOpenCodeRtkTools>;
