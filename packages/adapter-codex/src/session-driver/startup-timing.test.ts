import { expect, test } from 'bun:test';
import type { DriverTaskInput } from '@deck/core/session/driver';
import { createCodexSessionDriver } from './driver';
import { ISOLATION_FEATURES } from './launch';
import { harness } from './test-support';

// Protects the actual production startup composition, including failure and
// cancelled input. Timing metadata must never copy native errors or task input.
for (const mode of ['new', 'resume', 'failed', 'cancelled'] as const) test(`Codex startup summary: ${mode}`, async () => {
  const h = harness((child, _, m) => {
    const result = m.method === 'config/read' ? { config: { features: Object.fromEntries(ISOLATION_FEATURES.map(id => [id, false])) } }
      : m.method === 'thread/start' || m.method === 'thread/resume' ? { thread: { id: 'thread' } }
      : m.method === 'mcpServerStatus/list' ? { data: [] }
      : m.method === 'turn/start' ? { turn: { id: 'turn' } } : {};
    if (m.id !== undefined) child.stdout(mode === 'failed' && m.method === 'config/read'
      ? { id: m.id, error: { code: -1, message: 'NATIVE_SECRET' } } : { id: m.id, result });
  });
  if (mode === 'cancelled') h.io.claimInput = () => false;
  const input: DriverTaskInput = { taskId: 't', memberId: 'lead', cwd: '/work', assignment: { runnerId: 'codex', modelId: 'fake' },
    runnerVersion: '0.162.1', rolePrompt: 'ROLE_SECRET', prompt: 'PROMPT_SECRET', credentialFile: '/private/TOKEN_SECRET',
    mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: 'relay', disableNativeDelegation: true,
    ...(mode === 'resume' ? { resume: { nativeSessionId: 'thread' } } : {}) };
  const task = await createCodexSessionDriver().startTask(input, h.io);
  if (mode === 'new' || mode === 'resume') {
    await task.nativeSessionId;
    // Wait for the native turn reply without wall-clock sleeps.
    for (let i = 0; i < 30 && !h.events.some(e => e.data.code === 'turn.startup-timing'); i++) await Promise.resolve();
    h.children[0]!.stdout({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
  }
  await task.done; await task.close();
  const summaries = h.events.filter(e => e.data.code === 'turn.startup-timing');
  expect(summaries).toHaveLength(1);
  expect(summaries[0]!.data).toMatchObject({ scope: 'adapter', runner: 'codex', version: '0.162.1', continuity: mode === 'resume' ? 'resume' : 'new', outcome: mode === 'failed' ? 'failed' : mode === 'cancelled' ? 'cancelled' : 'completed' });
  expect(JSON.stringify(summaries)).not.toContain('SECRET');
  const steps = (summaries[0]!.data.steps as { step: string; durationMs: number }[]);
  expect(steps.every(s => Number.isFinite(s.durationMs) && s.durationMs >= 0)).toBe(true);
  if (mode === 'new' || mode === 'resume') expect(steps.map(s => s.step)).toEqual(expect.arrayContaining(['inventory-process', 'inventory-config', mode === 'resume' ? 'thread-resume' : 'thread-start', 'mcp-wait', 'turn-send']));
});

// Exercises the second native process with a real, privately installed role
// descriptor. Native hook inventory still gates admission; timing cannot bypass it.
for (const invalidHooks of [false, true]) test(`Codex attested second-process timing (invalid hooks=${invalidHooks})`, async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { prepareCodexNativeRole } = await import('../native-role');
  const root = mkdtempSync(join(tmpdir(), 'deck-codex-timing-'));
  const role = 'name = "deck-apply-deep"\ndeveloper_instructions = "PRIVATE_ROLE_SECRET"\n';
  mkdirSync(join(root, 'agents')); mkdirSync(join(root, 'deck'));
  writeFileSync(join(root, 'agents/deck-apply-deep.toml'), role, { mode: 0o600 });
  writeFileSync(join(root, 'config.toml'), '', { mode: 0o600 });
  writeFileSync(join(root, 'deck/manifest.json'), JSON.stringify({ version: 1, files: { '.codex/agents/deck-apply-deep.toml': createHash('sha256').update(role).digest('hex') } }), { mode: 0o600 });
  const h = harness((child, index, m) => {
    const result = m.method === 'config/read' ? { config: { features: Object.fromEntries(ISOLATION_FEATURES.map(id => [id, false])) } }
      : m.method === 'hooks/list' ? { data: [{ cwd: root, hooks: [], errors: invalidHooks && index === 2 ? ['NATIVE_SECRET'] : [] }] }
      : m.method === 'thread/start' ? { thread: { id: 'thread' } }
      : m.method === 'mcpServerStatus/list' ? { data: [] }
      : m.method === 'turn/start' ? { turn: { id: 'turn' } } : {};
    if (m.id !== undefined) child.stdout({ id: m.id, result });
  });
  try {
    const input: DriverTaskInput = { taskId: 't', memberId: 'apply-deep', cwd: root, assignment: { runnerId: 'codex', modelId: 'fake' }, nativeRoleDescriptor: prepareCodexNativeRole(root, 'deck-apply-deep'), rolePrompt: '', prompt: '', credentialFile: '/private/credential', mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: 'relay', disableNativeDelegation: true };
    const task = await createCodexSessionDriver().startTask(input, h.io);
    if (!invalidHooks) {
      await task.nativeSessionId;
      for (let i = 0; i < 30 && !h.events.some(e => e.data.code === 'turn.startup-timing'); i++) await Promise.resolve();
      h.children[1]!.stdout({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'completed' } } });
    }
    expect((await task.done).status).toBe(invalidHooks ? 'failed' : 'completed'); await task.close();
    expect(h.children).toHaveLength(2);
    const summaries = h.events.filter(e => e.data.code === 'turn.startup-timing');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.data.outcome).toBe(invalidHooks ? 'failed' : 'completed');
    expect((summaries[0]!.data.steps as { step: string }[]).map(s => s.step)).toEqual(expect.arrayContaining(['inventory-hooks', 'inventory-stop', 'runtime-process', 'runtime-config', 'runtime-hooks']));
    expect(JSON.stringify(summaries)).not.toContain('SECRET');
    expect(h.children.every(c => c.terminations === 1)).toBe(true);
    if (invalidHooks) expect(h.children.flatMap(c => c.writes).some(m => m.method === 'turn/start')).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects production pagination/poll attribution and unchanged admission:
// starting runtime requires another pass; an invalid page still blocks input.
for (const invalid of [false, true]) test(`Codex MCP timing preserves polling and rejection (invalid=${invalid})`, async () => {
  let calls = 0;
  const h = harness((child, _, m) => {
    let result: unknown = {};
    if (m.method === 'config/read') result = { config: { features: Object.fromEntries(ISOLATION_FEATURES.map(id => [id, false])) } };
    if (m.method === 'thread/start') result = { thread: { id: 'thread' } };
    if (m.method === 'mcpServerStatus/list') {
      calls++;
      result = calls === 1 ? { data: [{ name: 'deck-session-t-context7', runtimeStatus: 'starting' }], nextCursor: 'SECRET_CURSOR' }
        : calls === 2 ? { data: [] } : invalid ? { data: 'SECRET_INVALID' }
        : { data: [{ name: 'deck-session-t-context7', runtimeStatus: 'connected', tools: {} }] };
    }
    if (m.id !== undefined) child.stdout({ id: m.id, result });
  });
  h.io.claimInput = () => false;
  const input: DriverTaskInput = { taskId: 't', memberId: 'lead', cwd: '/work', assignment: { runnerId: 'codex', modelId: 'fake' }, rolePrompt: '', prompt: '',
    mcp: { servers: ['context7'], sessionTools: [] }, mcpServerSpecs: { context7: { command: 'fixture', args: [], env: {} } }, credentialFile: '/private/credential', approvals: 'relay', disableNativeDelegation: true };
  const task = await createCodexSessionDriver().startTask(input, h.io);
  expect((await task.done).status).toBe(invalid ? 'failed' : 'interrupted'); await task.close();
  const summaries = h.events.filter(e => e.data.code === 'turn.mcp-readiness-timing');
  expect(summaries).toHaveLength(1);
  expect(summaries[0]!.data).toMatchObject({ outcome: invalid ? 'failed' : 'completed', statusCallCount: 3, statusPageCount: 3, pollCount: 2, sleepCount: 1 });
  expect(JSON.stringify(summaries)).not.toContain('SECRET');
  expect(h.children.flatMap(c => c.writes).some(m => m.method === 'turn/start')).toBe(false);
});
