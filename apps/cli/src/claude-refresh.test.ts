import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core';
import { createClaudeRunnerAdapter } from '../../../packages/adapter-claude/src/runner-adapter';
import { claudeModelMetadata } from '../../../packages/adapter-claude/src/models';
import { prepareSessionNativeSkills } from './session-native-skills';
import { resolveSessionChildMcp } from './session-shared-services';

// Oracle: native and cross entry points both prepare before admission, without enabling disabled intent.
test('native and managed composition refresh stale disabled declarations and omit unavailable optional tools', async () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'claude-refresh-composition-'));
  try {
    const dataRoot = join(homeDir, 'deck'), parent = join(dataRoot, 'claude');
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    writeFileSync(join(parent, 'model-assignments.json'), claudeModelMetadata({}, ['codebase-memory', 'context7']), { mode: 0o600 });
    const adapter = createClaudeRunnerAdapter({ homeDir, dataRoot, resolveCommand: () => undefined });
    const config = getDefaultDeckConfig();
    const result = await adapter.buildLaunchPlan!({ mode: 'interactive', projectRoot: homeDir, deckConfig: config } as Parameters<NonNullable<typeof adapter.buildLaunchPlan>>[0]);
    expect(result.status).toBe('ready');
    const warnings: string[] = [];
    const nativeSkills = await prepareSessionNativeSkills(adapter, config, warning => warnings.push(warning));
    expect(warnings.length).toBeGreaterThan(0);
    expect(nativeSkills?.files['.mcp.json']).toBeUndefined();
    if (result.status === 'ready') expect(result.plan.generationReference?.root).toBe(nativeSkills?.root);
    const resolver = await resolveSessionChildMcp(adapter, config, { HOME: homeDir }, {
      nativeSkills,
      context: { projectRoot: homeDir, sessionId: 'session', taskId: 'task', signal: new AbortController().signal },
      readiness: { ensure: () => { throw new Error('disabled capability was checked'); } } as never,
    });
    expect(resolver.runnerPackages('claude')).toEqual([]);
    expect(resolver.resolveServer('codebase-memory')).toBeUndefined();
  } finally { rmSync(homeDir, { recursive: true, force: true }); }
});
