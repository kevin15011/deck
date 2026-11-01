import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createCaptureTicket, drainNativeCapture } from './capture-drain';

// Protects cancellation, no retries, missing/misattributed receipts and no
// false provider acceptance. The native lifecycle is the sole observed effect.
test('drain is bounded, cancellable and rejects foreign or unsafe evidence', async () => {
  const home=mkdtempSync(join(tmpdir(),'deck-capture-drain-'));
  try {
    const ticket=createCaptureTicket('t',{writePrivateFile:(n,c)=>{const p=join(home,n);writeFileSync(p,c,{mode:0o600});return p;}});
    const binding=JSON.parse(readFileSync(ticket.path,'utf8'));
    let calls=0;const dispose=async()=>{calls++;};
    expect(await drainNativeCapture(ticket,'s',dispose,new AbortController().signal,1)).toMatchObject({lifecycle:'pending',acceptance:'unknown'});
    expect(calls).toBe(1);
    writeFileSync(ticket.path,JSON.stringify({...binding,lifecycle:'completed',nativeSessionIds:['foreign'],acceptance:'unknown'}));
    expect(await drainNativeCapture(ticket,'s',dispose,new AbortController().signal,1)).toMatchObject({lifecycle:'pending'});
    const controller=new AbortController();controller.abort();
    expect(await drainNativeCapture(ticket,'s',dispose,controller.signal)).toMatchObject({lifecycle:'unknown'});expect(calls).toBe(2);
    const later=new AbortController();const waiting=drainNativeCapture(ticket,'s',dispose,later.signal);later.abort();
    expect(await waiting).toMatchObject({lifecycle:'unknown'});
    const foreign=join(home,'foreign');writeFileSync(foreign,JSON.stringify({...binding,lifecycle:'completed',nativeSessionIds:['s'],acceptance:'unknown'}),{mode:0o600});
    rmSync(ticket.path);symlinkSync(foreign,ticket.path);
    expect(await drainNativeCapture(ticket,'s',dispose,new AbortController().signal,1)).toMatchObject({lifecycle:'pending'});
    expect(await drainNativeCapture(ticket,'s',async()=>{throw Error('fault');},new AbortController().signal,1)).toMatchObject({lifecycle:'unknown',reason:'native-disposal-unconfirmed'});
  } finally {rmSync(home,{recursive:true,force:true});}
});

// Protects the close deadline and event-loop cancellation against a private FIFO
// with no writer. A separate process bounds the test even if openSync blocks.
test.each(['timeout', 'cancel'] as const)('FIFO receipt cannot block capture drain: %s', async boundary => {
  const home = mkdtempSync(join(tmpdir(), 'deck-capture-fifo-'));
  const path = join(home, 'receipt');
  const env = { HOME: home, TMPDIR: home, PATH: '/usr/bin:/bin' };
  try {
    const fifo = spawnSync('mkfifo', ['-m', '600', path], { env });
    expect(fifo.status).toBe(0);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '__fixtures__/capture-drain-fifo.ts')], {
      env: { ...env, DECK_TEST_FIFO_PATH: path, DECK_TEST_FIFO_BOUNDARY: boundary }, stdout: 'pipe', stderr: 'pipe',
    });
    let watchdogExpired = false;
    const watchdog = setTimeout(() => { watchdogExpired = true; child.kill('SIGKILL'); }, 750);
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect({ watchdogExpired, code, stderr }).toEqual({ watchdogExpired: false, code: 0, stderr: '' });
      expect(JSON.parse(stdout)).toEqual({
        lifecycle: boundary === 'timeout' ? 'pending' : 'unknown',
        acceptance: 'unknown',
        reason: boundary === 'timeout' ? 'capture-drain-timeout' : 'close-interrupted',
      });
    } finally {
      clearTimeout(watchdog);
      child.kill('SIGKILL');
      await child.exited;
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
