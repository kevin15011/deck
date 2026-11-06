import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeSessionDriver } from './driver';
import type { DriverTaskInput, SupervisedChildExit } from '@deck/core/session/driver';

// Protects cold startup without relaxing admission or creating a session before initialization.
// Oracle: slow native initialization has its own bound; admission is still short and failure drains the child.
for (const failure of [undefined, 'preparation', 'admission'] as const) test(`native dependencies precede short admission (${failure ?? 'success'})`, async () => {
 const home = mkdtempSync(join(tmpdir(), 'deck-cold-start-')), originalFetch = globalThis.fetch;
 let env: Record<string, string> = {}, killed = false, initialized = false, session = false, agents = 0;
 let exit!: (v: SupervisedChildExit) => void;
 const exited = new Promise<SupervisedChildExit>(resolve => { exit = resolve; });
 const diagnostics: string[] = [];
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
  if (path === '/mcp') return Response.json({});
  if (path === '/session') { session = true; expect(agents).toBe(2); return Response.json({ id: 'native' }); }
  if (path === '/session/native/message') return Response.json({ info: { id: 'answer', role: 'assistant', parentID: JSON.parse(init.body).messageID, sessionID: 'native' }, parts: [] });
  if (path === '/event') return new Response(new ReadableStream({ start(c) { init.signal.addEventListener('abort', () => { try { c.close(); } catch {} }, { once: true }); } }));
  return Response.json([]);
 }) as any;
 try {
  const input: DriverTaskInput = { taskId: 't', memberId: 'apply-deep', cwd: home, assignment: { runnerId: 'opencode', modelId: 'fake/model' }, rolePrompt: 'role', prompt: 'input', mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, approvals: 'runner-default', credentialFile: join(home, 'credential'), disableNativeDelegation: true };
  const starting = createOpenCodeSessionDriver({ baseEnv: { HOME: home, XDG_CONFIG_HOME: home }, readinessMs: 30, dependencyPreparationMs: 120 }).startTask(input, {
   emit(event) { if (event.kind === 'diagnostic') diagnostics.push(String(event.data.code)); }, approval: async () => ({ decision: 'deny' }),
   writePrivateFile(name, content) { const path = join(home, name); writeFileSync(path, content); return path; },
   async spawn(_command, _args, options) {
    env = options!.env!;
    return { ready: Promise.resolve({ workerPid: process.pid }), exited, writeStdin() {}, endStdin() {}, onStdout(fn) { queueMicrotask(() => fn('http://127.0.0.1:12345')); }, onStderr() {}, interrupt: () => true,
     async terminateGroup() { killed = true; exit({ ok: true, code: 0, signal: null, drained: true, anchorLost: false }); } };
   },
  });
  if (failure) {
   await expect(starting).rejects.toThrow(failure === 'preparation' ? 'dependency preparation timed out' : 'readiness timed out');
   expect(session).toBe(false); expect(killed).toBe(true);
  } else {
   const handle = await starting;
   expect(await handle.done).toMatchObject({ status: 'completed' });
   expect(diagnostics).toContain('opencode-dependencies-prepared');
   await handle.close(); expect(killed).toBe(true);
  }
 } finally { globalThis.fetch = originalFetch; rmSync(home, { recursive: true, force: true }); }
});
