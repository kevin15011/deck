import { expect, test, spyOn } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { existsSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { spawn } from 'node:child_process';
import { runCodexMcpDetailExperiment } from './codex-mcp-detail-experiment';

function fixture(mode: 'failed-spawn' | 'normal' | 'no-close') {
  const roots = new Set<string>();
  const children: EventEmitter[] = [];
  const spawnProcess = ((_command: unknown, _args: unknown, options: { cwd: string }) => {
    roots.add(dirname(options.cwd));
    const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null,
      stdout: new PassThrough(), stderr: new PassThrough(), stdin: undefined as unknown as Writable });
    children.push(child);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const message = JSON.parse(chunk.toString());
      queueMicrotask(() => {
        if (mode !== 'normal') return;
        let result: unknown = {};
        if (message.method === 'thread/start') result = { thread: { id: 'fixture-thread' } };
        if (message.method === 'mcpServerStatus/list') result = { data: ['managed', 'personal', 'suppressed'].map(name => ({
          name, runtimeStatus: name === 'suppressed' || (options.cwd.includes('readonly') && name === 'personal') ? 'disabled' : 'connected',
          tools: { 'query-docs': {} }, authStatus: 'unsupported', resources: [{}], resourceTemplates: [{}],
        })) };
        if (message.id !== undefined) child.stdout.emit('data', JSON.stringify({ id: message.id, result }) + '\n');
      });
      done();
    }, final(done) {
      if (mode === 'normal') queueMicrotask(() => {
        child.emit('exit', 0, null); child.emit('close', 0, null);
      });
      done();
    } });
    queueMicrotask(() => {
      if (mode === 'normal') child.emit('spawn');
      else {
        child.emit('error', Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' }));
        if (mode === 'failed-spawn') child.emit('close', -1, null); // Node does not emit exit on spawn failure.
      }
    });
    return child;
  }) as unknown as typeof spawn;
  return { roots, children, spawnProcess };
}

async function bounded<T>(work: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Test watchdog: experiment hung')), 100); })]); }
  finally { clearTimeout(timer!); }
}

// Protects Q3: a failed spawn must reject and remove its private root even without exit.
// Oracle: Node child_process error/close lifecycle and experiment cleanup contract.
test('failed spawn without exit completes and removes private temporary directory', async () => {
  const f = fixture('failed-spawn');
  try {
    await expect(bounded(runCodexMcpDetailExperiment('fake-codex', 'fixture', { spawnProcess: f.spawnProcess, cleanupTimeoutMs: 20 }))).rejects.toThrow('Experiment process failed');
  } catch (error) { for (const root of f.roots) rmSync(root, { recursive: true, force: true }); throw error; }
  expect(f.children).toHaveLength(1);
  for (const root of f.roots) expect(existsSync(root)).toBe(false);
}, 500);

test('normal protocol and exit/close complete all samples and remove private directories', async () => {
  const f = fixture('normal');
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    await runCodexMcpDetailExperiment('fake-codex', 'fixture', { spawnProcess: f.spawnProcess, cleanupTimeoutMs: 20 });
    expect(f.children).toHaveLength(8);
    for (const root of f.roots) expect(existsSync(root)).toBe(false);
  } finally { log.mockRestore(); }
});

// A missing close must not prevent the outer finally from removing private state.
test('missing close has bounded cleanup and preserves both errors', async () => {
  const f = fixture('no-close');
  let failure: unknown;
  try { await bounded(runCodexMcpDetailExperiment('fake-codex', 'fixture', { spawnProcess: f.spawnProcess, cleanupTimeoutMs: 20 })); }
  catch (error) { failure = error; }
  if (!(failure instanceof AggregateError)) for (const root of f.roots) rmSync(root, { recursive: true, force: true });
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors.map((e: Error) => e.message)).toEqual(['Experiment process failed', 'Experiment process cleanup timed out']);
  for (const root of f.roots) expect(existsSync(root)).toBe(false);
}, 500);
