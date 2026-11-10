import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeSessionDriver } from './driver';
import type { DriverEvent, DriverTaskInput, SupervisedChildExit } from '@deck/core/session/driver';

// Protects cold startup without relaxing admission or creating a session before initialization.
// Oracle: slow native initialization has its own bound; admission is still short and failure drains the child.
// MCP transport/process failures must report failed readiness, never user cancellation, with zero admissions.
for (const resumed of [false, true]) for (const failure of [undefined, 'preparation', 'admission', 'mcp', 'mcp-json', 'mcp-exit', 'cancelled'] as const) test(`native dependencies precede short admission (${failure ?? 'success'}, resume=${resumed})`, async () => {
 const home = mkdtempSync(join(tmpdir(), 'deck-cold-start-')), originalFetch = globalThis.fetch;
 let env: Record<string, string> = {}, killed = false, initialized = false, session = false, agents = 0;
 let exit!: (v: SupervisedChildExit) => void;
 const exited = new Promise<SupervisedChildExit>(resolve => { exit = resolve; });
 const diagnostics: string[] = [];
 const timings: DriverEvent[] = [];
 const mcpTimings: DriverEvent[] = [];
 const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
 });
 globalThis.fetch = (async (url: any, init: any) => {
  const path = new URL(String(url)).pathname;
  if (!String(url).startsWith('http://127.0.0.1:12345/')) throw new Error('external I/O forbidden');
  if (path === '/agent') {
   agents++;
   if (!initialized) { await wait(failure === 'preparation' ? 500 : 55, init.signal); initialized = true; }
   return Response.json([{ name: 'build', permission: [] }]);
  }
  if (path === '/config') {
   expect(initialized).toBe(true);
   if (failure === 'admission') await wait(500, init.signal);
   return Response.json(JSON.parse(env.OPENCODE_CONFIG_CONTENT!));
  }
  if (path === '/mcp') {
   if (failure === 'mcp') await wait(500, init.signal);
   if (failure === 'mcp-json') return new Response('{invalid');
   if (failure === 'mcp-exit') {
    queueMicrotask(() => exit({ ok: false, code: 1, signal: null, drained: true, anchorLost: false }));
    await wait(500, init.signal);
   }
   return Response.json({});
  }
  if (path === '/session/native') { session = true; expect(agents).toBe(2); return Response.json({ id: 'native' }); }
  if (path === '/session') { session = true; expect(agents).toBe(2); return Response.json({ id: 'native' }); }
  if (path === '/session/native/message') return Response.json({ info: { id: 'answer', role: 'assistant', parentID: JSON.parse(init.body).messageID, sessionID: 'native' }, parts: [] });
  if (path === '/event') return new Response(new ReadableStream({ start(c) { init.signal.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true }); } }));
  return Response.json([]);
 }) as any;
 try {
  const input: DriverTaskInput = { ...(resumed ? { resume: { nativeSessionId: 'native' } } : {}), runnerVersion: '1.18.31', taskId: 't', memberId: 'apply-deep', cwd: home, assignment: { runnerId: 'opencode', modelId: 'fake/model' }, rolePrompt: 'role', prompt: 'input', mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: 'runner-default', credentialFile: join(home, 'credential'), disableNativeDelegation: true };
  const starting = createOpenCodeSessionDriver({ baseEnv: { HOME: home, XDG_CONFIG_HOME: home }, readinessMs: 30, dependencyPreparationMs: 120 }).startTask(input, {
   claimInput: () => failure !== 'cancelled',
   emit(event) { if (event.data.code === 'turn.startup-timing') timings.push(event); if (event.data.code === 'turn.mcp-readiness-timing') mcpTimings.push(event); if (event.kind === 'diagnostic') diagnostics.push(String(event.data.code)); }, approval: async () => ({ decision: 'deny' }),
   writePrivateFile(name, content) { const path = join(home, name); writeFileSync(path, content); return path; },
   async spawn(_command, _args, options) {
    env = options!.env!;
    return { ready: Promise.resolve({ workerPid: process.pid }), exited, writeStdin() {}, endStdin() {}, onStdout(fn) { queueMicrotask(() => fn('http://127.0.0.1:12345')); }, onStderr() {}, interrupt: () => true,
     async terminateGroup() { killed = true; exit({ ok: true, code: 0, signal: null, drained: true, anchorLost: false }); } };
   },
  });
  if (failure && failure !== 'cancelled') {
   await expect(starting).rejects.toThrow(failure === 'preparation' ? 'dependency preparation timed out' : failure === 'mcp-json' ? 'opencode-http-invalid-body' : failure === 'mcp-exit' ? 'aborted' : 'readiness timed out');
   expect(session).toBe(false); expect(killed).toBe(true);
  } else {
   const handle = await starting;
   expect(await handle.done).toMatchObject({ status: failure === 'cancelled' ? 'interrupted' : 'completed' });
   expect(diagnostics).toContain('opencode-dependencies-prepared');
   await handle.close(); expect(killed).toBe(true);
  }
  const mcpFailed = failure === 'mcp' || failure === 'mcp-json' || failure === 'mcp-exit';
  if (!failure || failure === 'cancelled' || mcpFailed) {
   expect(mcpTimings).toHaveLength(1);
   expect(mcpTimings[0]!.data).toMatchObject({ outcome: mcpFailed ? 'failed' : 'completed', statusCallCount: 1, statusPageCount: mcpFailed ? 0 : 1, pollCount: 1, sleepCount: 0 });
   expect(JSON.stringify(mcpTimings)).not.toContain(home);
   expect(JSON.stringify(mcpTimings)).not.toContain(env.OPENCODE_SERVER_PASSWORD!);
  } else expect(mcpTimings).toHaveLength(0);
  expect(timings).toHaveLength(1);
  expect(timings[0]!.data).toMatchObject({ runner: 'opencode', version: '1.18.31', continuity: resumed ? 'resume' : 'new', outcome: failure === 'cancelled' ? 'cancelled' : failure ? 'failed' : 'completed' });
  const steps = timings[0]!.data.steps as { step: string; durationMs: number }[];
  expect(steps.map(s => s.step)).toContain('dependencies');
  if (!failure) expect(steps.map(s => s.step)).toEqual(expect.arrayContaining(['endpoint-ready', 'mcp-wait', 'config-attestation', resumed ? 'session-resume' : 'session-start', 'event-subscribe', 'turn-send']));
  expect(steps.every(s => Number.isFinite(s.durationMs) && s.durationMs >= 0)).toBe(true);
  expect(JSON.stringify(timings)).not.toContain(home);
  expect(JSON.stringify(timings)).not.toContain(env.OPENCODE_SERVER_PASSWORD!);
 } finally { globalThis.fetch = originalFetch; rmSync(home, { recursive: true, force: true }); }
});
