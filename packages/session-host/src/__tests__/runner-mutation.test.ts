import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ControlClient } from '../control-client';
import { startDaemon, type RunningDaemon } from '../daemon';
import { ensureStateLayout, resolveStatePaths } from '../paths';
import { cleanupTempDirs, tempDir, waitFor } from './test-helpers';
import { acquireRunnerMutationMarker, releaseRunnerMutationMarker, runnerMutationActive, withIdleRunnerMutation, RunnerMutationDeferredError, RunnerMutationCleanupError } from '../runner-mutation';
const daemons: RunningDaemon[] = [];
afterEach(async () => { await Promise.all(daemons.splice(0).map(d => d.stop('test'))); cleanupTempDirs(); });
async function fixture(work = () => false, execute = async (): Promise<{ok:true}> => ({ok:true})) {
  const home = tempDir(), paths = resolveStatePaths({env:{HOME:home},tmpdir:home});
  const result = await startDaemon({paths,version:'test',anchorCommand:[process.execPath],recoverOnStart:false,createService:()=>({execute,openLog:()=>undefined,hasActiveSessions:()=>false,hasRunningWork:work})});
  if (!result.ok) throw Error('daemon'); daemons.push(result.daemon); return paths;
}
test('busy migration defers without effects; retry reacquires and revalidates after idle', async () => {
  let busy = true, writes = 0;
  const paths = await fixture(()=>busy);
  await expect(withIdleRunnerMutation(()=>{writes++;}, {paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
  expect(writes).toBe(0); busy = false;
  await withIdleRunnerMutation(()=>{writes++;}, {paths}); expect(writes).toBe(1);
});
test('admitted asynchronous work closes the check-to-mutation race', async () => {
  let entered = false, finish!:()=>void;
  const barrier = new Promise<void>(r=>{finish=r;});
  const paths = await fixture(()=>false,async()=>{entered=true;await barrier;return {ok:true};});
  const client = await ControlClient.connect(paths.socket.path);
  const command = client.command({v:1,commandId:randomUUID(),type:'session.create',projectRoot:'/tmp'});
  try { await waitFor(()=>entered); await expect(withIdleRunnerMutation(()=>{throw Error('effect');},{paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError); }
  finally {finish();await command;client.close();}
});
test('new work and daemon restart cannot cross a held migration, including nested effects', async () => {
  let calls=0;
  const paths=await fixture(()=>false,async()=>{calls++;return {ok:true};});
  const client=await ControlClient.connect(paths.socket.path);
  try { await withIdleRunnerMutation(async()=>{
    expect(await client.command({v:1,commandId:randomUUID(),type:'session.create',projectRoot:'/tmp'})).toMatchObject({outcome:{ok:false,code:'runner-mutation-active'}});
    expect(await client.request({t:'daemon.restart'})).toMatchObject({outcome:{ok:false,code:'busy'}});
    await withIdleRunnerMutation(()=>{}, {paths});
  },{paths});
  expect((await client.command({v:1,commandId:randomUUID(),type:'session.create',projectRoot:'/tmp'})).outcome.ok).toBe(true);
  expect(calls).toBe(1);
  } finally {client.close();}
});
test('offline mutation blocks competing daemon startup until completion', async()=>{
  const home=tempDir(), paths=resolveStatePaths({env:{HOME:home},tmpdir:home});
  await withIdleRunnerMutation(async()=>{
    const result=await startDaemon({paths,version:'test',anchorCommand:[process.execPath],recoverOnStart:false});
    expect(result.ok).toBe(false); if(result.ok) {daemons.push(result.daemon);throw Error('concurrent daemon');}
  },{paths});
  const result=await startDaemon({paths,version:'test',anchorCommand:[process.execPath],recoverOnStart:false});
  expect(result.ok).toBe(true);if(result.ok)daemons.push(result.daemon);
});
test('unknown activity and corrupt reservations defer without executing effects',async()=>{
 const {writeFileSync}=await import('node:fs'),{join}=await import('node:path');
 const paths=await fixture(()=>false);
 writeFileSync(join(paths.daemonDir,'runner-mutation.json'),'invalid',{mode:0o600});
 await expect(withIdleRunnerMutation(()=>{throw Error('must not execute');},{paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
});
test('a session between turns also prevents migration and missing activity support is unknown',async()=>{
 for(const active of [true,undefined]){
  const home=tempDir(),paths=resolveStatePaths({env:{HOME:home},tmpdir:home});
  const result=await startDaemon({paths,version:'test',anchorCommand:[process.execPath],recoverOnStart:false,createService:()=>({execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>false,...(active===true?{hasActiveSessions:()=>true}:{})})});
  if(!result.ok)throw Error('daemon');daemons.push(result.daemon);
  await expect(withIdleRunnerMutation(()=>{throw Error('must not execute');},{paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
 }
});
test('reservation survives a lost control connection while its owner is alive',async()=>{
 const {acquireRunnerMutationMarker,releaseRunnerMutationMarker}=await import('../runner-mutation');
 const paths=await fixture(()=>false),identity={pid:process.pid,token:randomUUID()};
 expect(acquireRunnerMutationMarker(paths,identity)).toBe(true);
 await expect(withIdleRunnerMutation(()=>{throw Error('must not execute');},{paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
 expect(releaseRunnerMutationMarker(paths,identity)).toBe(true);
 await withIdleRunnerMutation(()=>{}, {paths});
});
test('an asynchronous descendant cannot reuse admission after the reservation is released',async()=>{
 let busy=false,start!:()=>void,child!:Promise<void>;
 const paths=await fixture(()=>busy),barrier=new Promise<void>(resolve=>{start=resolve;});
 await withIdleRunnerMutation(()=>{
  child=barrier.then(()=>withIdleRunnerMutation(()=>{throw Error('effect escaped its admission');},{paths}));
 },{paths});
 busy=true;start();await expect(child).rejects.toBeInstanceOf(RunnerMutationDeferredError);
});

test('offline history is unknown until an authoritative daemon can inspect it',async()=>{
 const {mkdirSync}=await import('node:fs'),{join}=await import('node:path'),{ensureStateLayout}=await import('../paths');
 const home=tempDir(),paths=resolveStatePaths({env:{HOME:home},tmpdir:home});ensureStateLayout(paths);mkdirSync(join(paths.sessionsDir,'historical'));
 await expect(withIdleRunnerMutation(()=>{throw Error('unknown history effect');},{paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
});

test('a paused production starter cannot delete a newer live maintenance reservation', async () => {
  const home = tempDir(), paths = resolveStatePaths({ env: { HOME: home }, tmpdir: home });
  ensureStateLayout(paths);
  const marker = join(paths.daemonDir, 'runner-mutation.json');
  writeFileSync(marker, JSON.stringify({ pid: 2147483647, token: randomUUID() }));
  const child = Bun.spawn([process.execPath, 'run', join(import.meta.dir, 'fixtures/stale-mutation-startup.ts'), home], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' },
  });
  let client: ControlClient | undefined;
  try {
    await waitFor(() => existsSync(join(home, 'paused')));
    let calls = 0;
    const newer = await startDaemon({ paths, version: 'new-startup', anchorCommand: [process.execPath], recoverOnStart: false,
      createService: () => ({ execute: async () => { calls++; return { ok: true }; }, openLog: () => undefined, hasRunningWork: () => false, hasActiveSessions: () => false }) });
    if (!newer.ok) throw Error('newer startup must acquire while old reader is paused');
    daemons.push(newer.daemon);
    client = await ControlClient.connect(paths.socket.path);
    const connected = client;
    const newWork = () => connected.command({ v: 1, commandId: randomUUID(), type: 'session.create', projectRoot: home });
    await withIdleRunnerMutation(async () => {
      const reservation = readFileSync(marker, 'utf8');
      writeFileSync(join(home, 'resume'), 'continue stale reader');
      expect(await child.exited).toBe(0);
      expect(readFileSync(marker, 'utf8')).toBe(reservation);
      expect((await newWork()).outcome).toMatchObject({ ok: false, code: 'runner-mutation-active' });
      expect((await newWork()).outcome.ok).toBe(false);
      expect(calls).toBe(0);
    }, { paths });
    expect(existsSync(marker)).toBe(false);
    expect((await newWork()).outcome.ok).toBe(true);
    expect(calls).toBe(1);
    await withIdleRunnerMutation(() => {}, { paths });
  } finally {
    writeFileSync(join(home, 'resume'), 'cleanup');
    await child.exited;
    client?.close();
  }
}, 15000);

test('marker lifecycle fails closed on guard contention and recovers after it ends', async () => {
  const paths = await fixture();
  const marker = join(paths.daemonDir, 'runner-mutation.json'), gate = `${marker}.gate`;
  const identity = { pid: process.pid, token: randomUUID() };
  mkdirSync(gate, { mode: 0o700 });
  const old = new Date(Date.now() - 60000);
  utimesSync(gate, old, old); // An old guard may still belong to a paused process.
  try {
    expect(runnerMutationActive(paths)).toBe(true);
    expect(acquireRunnerMutationMarker(paths, identity)).toBe(false);
    expect(releaseRunnerMutationMarker(paths, identity)).toBe(false);
    await expect(withIdleRunnerMutation(() => { throw Error('contended effect'); }, { paths })).rejects.toBeInstanceOf(RunnerMutationDeferredError);
  } finally { rmdirSync(gate); }
  await withIdleRunnerMutation(() => {}, { paths });
  expect(acquireRunnerMutationMarker(paths, identity)).toBe(true);
  expect(releaseRunnerMutationMarker(paths, { ...identity, token: randomUUID() })).toBe(false);
  expect(runnerMutationActive(paths)).toBe(true);
  expect(releaseRunnerMutationMarker(paths, identity)).toBe(true);
  expect(runnerMutationActive(paths)).toBe(false);
});

test('a production starter paused inside stale validation excludes other processes until it resumes', async () => {
  const home = tempDir(), paths = resolveStatePaths({ env: { HOME: home }, tmpdir: home });
  ensureStateLayout(paths);
  const marker = join(paths.daemonDir, 'runner-mutation.json');
  const dead = JSON.stringify({ pid: 2147483647, token: randomUUID() });
  writeFileSync(marker, dead);
  const child = Bun.spawn([process.execPath, 'run', join(import.meta.dir, 'fixtures/stale-mutation-startup.ts'), home, 'guarded'], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' },
  });
  try {
    await waitFor(() => existsSync(join(home, 'paused')));
    const competing = await startDaemon({ paths, version: 'competitor', anchorCommand: [process.execPath], recoverOnStart: false });
    if (competing.ok) daemons.push(competing.daemon);
    expect(competing.ok).toBe(false);
    await expect(withIdleRunnerMutation(() => { throw Error('must not execute'); }, { paths })).rejects.toBeInstanceOf(RunnerMutationDeferredError);
    expect(readFileSync(marker, 'utf8')).toBe(dead);
  } finally {
    writeFileSync(join(home, 'resume'), 'finish guarded validation');
    await child.exited;
  }
  expect(existsSync(`${marker}.gate`)).toBe(false);
  await withIdleRunnerMutation(() => {}, { paths });
  const next = await startDaemon({ paths, version: 'next', anchorCommand: [process.execPath], recoverOnStart: false });
  expect(next.ok).toBe(true);
  if (next.ok) daemons.push(next.daemon);
}, 15000);

test('dead markers recover but unknown owners remain reserved', () => {
  const home = tempDir(), paths = resolveStatePaths({ env: { HOME: home }, tmpdir: home });
  ensureStateLayout(paths);
  const marker = join(paths.daemonDir, 'runner-mutation.json');
  const dead = { pid: 2147483647, token: randomUUID() };
  writeFileSync(marker, JSON.stringify(dead));
  expect(runnerMutationActive(paths, { presence: () => 'unknown' })).toBe(true);
  expect(readFileSync(marker, 'utf8')).toBe(JSON.stringify(dead));
  expect(runnerMutationActive(paths)).toBe(false);
  const identity = { pid: process.pid, token: randomUUID() };
  expect(acquireRunnerMutationMarker(paths, identity)).toBe(true);
  expect(releaseRunnerMutationMarker(paths, identity)).toBe(true);
});

test('stale ownership validation and deletion exclude replacement acquisition and release', () => {
  const home = tempDir(), paths = resolveStatePaths({ env: { HOME: home }, tmpdir: home });
  ensureStateLayout(paths);
  const dead = { pid: 2147483647, token: randomUUID() };
  const live = { pid: process.pid, token: randomUUID() };
  writeFileSync(join(paths.daemonDir, 'runner-mutation.json'), JSON.stringify(dead));
  let probes = 0;
  expect(runnerMutationActive(paths, { presence: () => {
    if (++probes === 2) {
      // Reenter precisely between the guarded read and delete. Every competing
      // lifecycle operation must refuse while ownership validation is in flight.
      expect(acquireRunnerMutationMarker(paths, live)).toBe(false);
      expect(releaseRunnerMutationMarker(paths, dead)).toBe(false);
      expect(runnerMutationActive(paths)).toBe(true);
    }
    return 'absent';
  } })).toBe(false);
  expect(probes).toBe(2);
  expect(acquireRunnerMutationMarker(paths, live)).toBe(true);
  expect(releaseRunnerMutationMarker(paths, dead)).toBe(false);
  expect(releaseRunnerMutationMarker(paths, live)).toBe(true);
});

test('reservation cleanup waits through transient guard contention before returning', async () => {
  const paths = await fixture();
  const marker = join(paths.daemonDir, 'runner-mutation.json'), gate = `${marker}.gate`;
  let released = false;
  await withIdleRunnerMutation(() => {
    mkdirSync(gate, { mode: 0o700 });
    setTimeout(() => { rmdirSync(gate); released = true; }, 30);
  }, { paths });
  expect(released).toBe(true);
  expect(existsSync(marker)).toBe(false);
  await withIdleRunnerMutation(() => {}, { paths });
});

test('persistent guard contention bounds cleanup and preserves exclusion for explicit recovery', async () => {
  const paths = await fixture();
  const marker = join(paths.daemonDir, 'runner-mutation.json'), gate = `${marker}.gate`;
  let identity!: { pid: number; token: string };
  try {
    await expect(withIdleRunnerMutation(() => {
      identity = JSON.parse(readFileSync(marker, 'utf8'));
      mkdirSync(gate, { mode: 0o700 });
    }, { paths })).rejects.toMatchObject({ code: 'runner-mutation-cleanup-failed' });
    expect(JSON.parse(readFileSync(marker, 'utf8'))).toEqual(identity);
    const client = await ControlClient.connect(paths.socket.path);
    try {
      expect((await client.command({ v: 1, commandId: randomUUID(), type: 'session.create', projectRoot: '/tmp' })).outcome.ok).toBe(false);
    } finally { client.close(); }
  } finally { rmdirSync(gate); }
  expect(releaseRunnerMutationMarker(paths, identity)).toBe(true);
  await withIdleRunnerMutation(() => {}, { paths });
});

for (const online of [false, true]) for (const fails of [false, true]) {
  test(`cleanup failure preserves ${fails ? 'original callback error' : 'completed result'} ${online ? 'with daemon' : 'offline'} without replay`, async () => {
    const home = tempDir();
    const paths = online ? await fixture() : resolveStatePaths({env:{HOME:home},tmpdir:home});
    const marker = join(paths.daemonDir, 'runner-mutation.json'), gate = `${marker}.gate`;
    const value = {backup: 'retained', filesWritten: ['completed']}, original = Error('original callback failure');
    let calls = 0, failure: unknown;
    try {
      await withIdleRunnerMutation(() => {
        calls++;
        mkdirSync(gate);
        if (fails) throw original;
        return value;
      }, {paths});
    } catch (error) { failure = error; }
    try {
      expect(calls).toBe(1);
      expect(failure).not.toBeInstanceOf(RunnerMutationDeferredError);
      expect(failure).toMatchObject({code:'runner-mutation-cleanup-failed', markerPath:marker, guardPath:gate});
      if (!(failure instanceof RunnerMutationCleanupError)) throw failure;
      if (fails) {
        expect(failure.operation.status).toBe('rejected');
        if (failure.operation.status === 'rejected') expect(failure.operation.reason).toBe(original);
        expect(failure.cause).toBe(original);
      } else {
        expect(failure.operation.status).toBe('fulfilled');
        if (failure.operation.status === 'fulfilled') expect(failure.operation.value).toBe(value);
      }
      expect(existsSync(marker)).toBe(true);
      await expect(withIdleRunnerMutation(() => { calls++; }, {paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
      expect(calls).toBe(1);
    } finally { rmdirSync(gate); }
  });
}
