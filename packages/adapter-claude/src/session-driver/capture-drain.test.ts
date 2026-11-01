import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { drainClaudeCapture } from './capture-drain';

// Protects exact native-message correlation: stale or foreign markers never
// release a current turn. The oracle is the pinned plugin's post-add write order.
test('capture drain requires a new exact assistant UUID and saved state', async () => {
  const home=mkdtempSync(join(tmpdir(),'claude-drain-'));
  const session=crypto.randomUUID(), previous=crypto.randomUUID(), current=crypto.randomUUID();
  const tracker=join(home,'.supermemory-claude','trackers',`${session}.json`);
  const status=join(home,'.supermemory-claude','statusline','statusline-state',createHash('sha256').update(session).digest('hex'),'capture.json');
  for(const path of [tracker,status])mkdirSync(join(path,'..'),{recursive:true,mode:0o700});
  const write=(uuid:string,state:string)=>{writeFileSync(tracker,JSON.stringify({lastUuid:uuid,pendingReplies:[]}),{mode:0o600});writeFileSync(status,JSON.stringify({version:1,event:'capture',status:state}),{mode:0o600});};
  const signal=new AbortController().signal;
  try {
    write(previous,'saved');
    expect((await drainClaudeCapture(home,session,current,previous,signal,5)).lifecycle).toBe('pending');
    expect((await drainClaudeCapture(home,session,previous,previous,signal,5)).reason).toBe('capture-message-unconfirmed');
    write(current,'saving');
    expect((await drainClaudeCapture(home,session,current,previous,signal,5)).lifecycle).toBe('pending');
    write(current,'saved');
    expect(await drainClaudeCapture(home,session,current,previous,signal,5)).toEqual({lifecycle:'unknown',acceptance:'unknown',reason:'official-capture-marker-observed'});
    rmSync(tracker);symlinkSync(status,tracker);
    expect((await drainClaudeCapture(home,session,current,previous,signal,5)).lifecycle).toBe('pending');
    const abort=new AbortController();abort.abort();
    expect((await drainClaudeCapture(home,session,current,previous,abort.signal,5000)).reason).toBe('capture-interrupted');
    const during=new AbortController();
    const pending=drainClaudeCapture(home,session,current,previous,during.signal,5000);
    during.abort();
    expect((await pending).reason).toBe('capture-interrupted');
  } finally {rmSync(home,{recursive:true,force:true});}
});

// Protects cancellation/deadline against FIFO opens using an externally bounded
// child, so a regression cannot hang the fast suite's own process.
test('special marker files cannot block the drain deadline', async () => {
  const home=mkdtempSync(join(tmpdir(),'claude-fifo-'));
  try {
    const session=crypto.randomUUID(),current=crypto.randomUUID();
    const path=join(home,'.supermemory-claude','trackers',`${session}.json`);
    mkdirSync(join(path,'..'),{recursive:true,mode:0o700});
    expect(Bun.spawnSync(['mkfifo','-m','600',path]).exitCode).toBe(0);
    const code=`import {drainClaudeCapture} from ${JSON.stringify(join(import.meta.dir,'capture-drain.ts'))}; console.log(JSON.stringify(await drainClaudeCapture(${JSON.stringify(home)},${JSON.stringify(session)},${JSON.stringify(current)},undefined,new AbortController().signal,10)));`;
    const child=Bun.spawn([process.execPath,'-e',code],{stdout:'pipe',stderr:'pipe'});
    const timer=setTimeout(()=>child.kill('SIGKILL'),500);
    try {expect(await child.exited).toBe(0);expect(JSON.parse(await new Response(child.stdout).text()).lifecycle).toBe('pending');}
    finally {clearTimeout(timer);}
  } finally {rmSync(home,{recursive:true,force:true});}
});
