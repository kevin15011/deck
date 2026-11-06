import { spyOn } from 'bun:test';
import * as asyncFs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPiRunnerAdapter } from '../../../packages/adapter-pi/src/runner-adapter';
import { createNodePiFileIO } from '../../../packages/adapter-pi/src/pi-global-install';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { guardRunnerAdapter } from './runner-mutation-admission';
import { getDefaultDeckConfig } from '@deck/core';
const [root, runner, boundary, scope] = process.argv.slice(2);
const agent = join(root!, 'agent'), project = scope === 'global' ? agent : join(root!, 'project');
mkdirSync(project, { recursive: true });
const kill = () => process.kill(process.pid, 'SIGKILL');
const io = createNodePiFileIO(), write = io.writeText;
io.writeText = (path, content, mode) => {
  write(path, content, mode);
  if (boundary === 'journal' && path.endsWith('transaction.pending.json') || boundary === 'target' && path.endsWith('role-policy.json')) kill();
};
if (runner === 'claude') {
  const original = asyncFs.writeFile;
  spyOn(asyncFs, 'writeFile').mockImplementation((async (...args: Parameters<typeof original>) => {
    await original(...args);
    if (boundary === 'target' && String(args[0]).includes('/agents/deck-quality.md') && !String(args[0]).includes('.deck-claude-stage-')) kill();
  }) as typeof original);
}
const raw = runner === 'pi' ? createPiRunnerAdapter({ homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: agent }, piFileIO: io, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) }) : createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root!, 'deck') });
if (boundary === 'archive' || boundary === 'verify') {
 const prepare = raw.prepareCanonicalRecovery!.bind(raw);
 raw.prepareCanonicalRecovery = async (...args) => {
  const recovery = await prepare(...args);
  const effect = recovery[boundary];
  recovery[boundary] = (async () => { const result = await effect(); kill(); return result; }) as never;
  return recovery;
 };
}
const guarded = guardRunnerAdapter(raw, async effect => effect(), undefined, { path: join(root!, 'fence.json'), self: { semver: '0.14.0', commit: 'fixture', channel: 'stable' }, stateSchema: 1 });
const input = { projectRoot: project, environmentId: `${runner}-development`, deckConfig: getDefaultDeckConfig(), capabilityIds: [] };
await guarded.applyDeveloperTeamInstall({ ...input, plan: guarded.buildDeveloperTeamInstallPlan(input) });
throw new Error('Crash boundary not reached');
