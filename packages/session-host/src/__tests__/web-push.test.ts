import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH, randomBytes } from 'node:crypto';
import type { SessionEvent } from '@deck/core/session/events';
import {
  WebPush,
  validatePushSubscription,
  isPublicPushAddress,
  sendPushRequest,
} from '../web-push';
import { ensureStateLayout, resolveStatePaths } from '../paths';
const roots: string[] = [];
const hosts: WebPush[] = [];
afterEach(() => {
  hosts.splice(0).forEach((p) => p.close());
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
});
const subscription = (host = 'fcm.googleapis.com', token = 'one') => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return {
    endpoint: `https://${host}/fcm/send/${token}`,
    keys: {
      p256dh: e.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
};
const event = (
  seq: number,
  kind = 'turn.completed',
  data: Record<string, unknown> = { status: 'completed' },
  source = { taskId: 'lead', memberId: 'lead' },
): SessionEvent =>
  ({
    v: 1,
    sessionId: 's',
    seq,
    ts: new Date().toISOString(),
    kind,
    source,
    data,
  }) as SessionEvent;
function fixture(extra: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deck-push-'));
  roots.push(root);
  const paths = resolveStatePaths({ env: { XDG_STATE_HOME: root } });
  ensureStateLayout(paths);
  const sent: any[] = [];
  const p = new WebPush({
    paths,
    isDeviceActive: () => true,
    isCurrent: () => true,
    send: async (...args: any[]) => {
      sent.push(args);
      return 201;
    },
    ...extra,
  });
  hosts.push(p);
  p.subscribe('d', 'https://deck.test', subscription());
  return { p, paths, sent };
}
async function drain() {
  await Bun.sleep(40);
}
test('sustained presence wakes cannot postpone unrelated exactly-once delivery', async () => {
  let now = 0, nextTimer = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const deliveries: { seq: number; at: number }[] = [];
  const { p } = fixture({
    now: () => now,
    send: async (_request: unknown, payload: { seq: number }) => {
      deliveries.push({ seq: payload.seq, at: now });
      return 201;
    },
  });
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
    const id = ++nextTimer;
    timers.set(id, { at: now + delay, run: () => callback(...args) });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: unknown) => { timers.delete(Number(id)); }) as typeof clearTimeout;
  try {
    p.accept(event(1));
    p.accept(event(1));
    // Deliver timer callbacks before each next 10ms wake, for longer than the job TTL.
    for (let target = 10; target <= 31_000; target += 10) {
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].run();
        for (let turn = 0; turn < 8; turn++) await Promise.resolve();
      }
      now = target;
      p.presence('other-device', 'https://deck.test', 'other-tab', 'other-session', target);
      if (target === 1000) {
        p.accept(event(2));
        p.accept(event(2));
      }
    }
    expect(deliveries).toEqual([{ seq: 1, at: 20 }, { seq: 2, at: 1020 }]);
  } finally {
    p.close();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
test('only known browser HTTPS providers and valid key material are accepted', () => {
  for (const host of [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
  ])
    expect(validatePushSubscription(subscription(host)).endpoint).toContain(
      host,
    );
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://localhost/x',
    'https://fcm.googleapis.com.evil.test/x',
    'https://evil.push.apple.com.evil.test/x',
    'https://user@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8080/x',
    'https://example.com/x',
    'https://fcm.googleapis.com/x#fragment',
  ])
    expect(() =>
      validatePushSubscription({ ...subscription(), endpoint }),
    ).toThrow();
  expect(() =>
    validatePushSubscription({
      ...subscription(),
      keys: { p256dh: 'x', auth: 'y' },
    }),
  ).toThrow();
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:0db8::1',
    '2002:7f00:1::1',
    '2001:20::1',
  ])
    expect(isPublicPushAddress(ip)).toBe(false);
  expect(isPublicPushAddress('8.8.8.8')).toBe(true);
  expect(isPublicPushAddress('2606:4700:4700::1111')).toBe(true);
});
test('durable private identity and subscriptions, opt-out survives reload', () => {
  const { p, paths } = fixture();
  const key = p.status('d', 'https://deck.test').publicKey;
  expect(statSync(join(paths.webDir, 'push.json')).mode & 0o777).toBe(0o600);
  const again = new WebPush({
    paths,
    isDeviceActive: () => true,
    isCurrent: () => true,
  });
  hosts.push(again);
  expect(again.status('d', 'https://deck.test')).toMatchObject({
    enabled: true,
    publicKey: key,
  });
  again.unsubscribe('d', 'https://deck.test');
  const reload = new WebPush({
    paths,
    isDeviceActive: () => true,
    isCurrent: () => true,
  });
  hosts.push(reload);
  expect(reload.status('d', 'https://deck.test').enabled).toBe(false);
});
test('generic live attention only: any-agent questions/approvals, no delegated replies/completions, dedup', async () => {
  const { p, sent } = fixture();
  p.accept(
    event(
      1,
      'turn.completed',
      { status: 'completed' },
      { taskId: 'worker', memberId: 'reviewer' },
    ),
  );
  p.accept(event(2, 'message.completed', { text: 'secret' }));
  p.accept(
    event(
      3,
      'task.result',
      { summary: 'secret' },
      { taskId: 'worker', memberId: 'reviewer' },
    ),
  );
  p.accept(event(4));
  p.accept(event(4));
  p.accept(
    event(
      5,
      'question.requested',
      { questionId: 'q', text: 'secret' },
      { taskId: 'worker', memberId: 'reviewer' },
    ),
  );
  p.accept(
    event(
      6,
      'approval.requested',
      { approvalId: 'a', command: 'secret' },
      { taskId: 'worker', memberId: 'reviewer' },
    ),
  );
  await drain();
  expect(sent).toHaveLength(3);
  for (const call of sent) {
    expect(JSON.stringify(call[1])).not.toContain('secret');
    expect(call[1].sessionId).toBe('s');
    expect(Object.keys(call[1]).sort()).toEqual(call[1].kind==='approval'?['approvalId','kind','risk','seq','sessionId','tool']:['kind','seq','sessionId']);
    if(call[1].kind==='approval')expect(call[1]).toMatchObject({approvalId:'a',tool:'Tool',risk:'high'});
  }
});
test('stale queued attention, revoked/expired devices and active viewing are suppressed', async () => {
  let current = true;
  const { p, sent } = fixture({ isCurrent: () => current });
  p.accept(event(1, 'question.requested', { questionId: 'q' }));
  current = false;
  await drain();
  expect(sent).toHaveLength(0);
  current = true;
  p.presence('d', 'https://deck.test', 'tab-one', 's');
  p.accept(event(2));
  await drain();
  expect(sent).toHaveLength(0);
  p.presence('d', 'https://deck.test', 'tab-one', null);
  p.accept(event(3));
  p.revoke('d');
  await drain();
  expect(sent).toHaveLength(0);
  expect(p.status('d', 'https://deck.test').enabled).toBe(false);
});
test('410 and 404 remove subscriptions; redirects do not trigger another request', async () => {
  for (const status of [410, 404]) {
    const { p } = fixture({ send: async () => status });
    p.accept(event(1));
    await drain();
    expect(p.status('d', 'https://deck.test').enabled).toBe(false);
  }
});
test('bounded concurrent queue never blocks event acceptance and drops stale work', async () => {
  let release!: () => void;
  let calls = 0;
  const gate = new Promise<void>((r) => (release = r));
  const { p } = fixture({
    send: async () => {
      calls++;
      await gate;
      return 201;
    },
  });
  for (let i = 1; i < 2000; i++) p.accept(event(i));
  await drain();
  expect(calls).toBeLessThanOrEqual(4);
  release();
  await drain();
  expect(calls).toBeLessThanOrEqual(260);
});

test('outbound transport rejects private DNS, pins validated DNS, and does not follow redirects', async () => {
  const { EventEmitter } = await import('node:events');
  let requests = 0,
    pinned = '';
  const network: any = {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (_url: any, options: any, respond: any) => {
      requests++;
      options.lookup(
        'fcm.googleapis.com',
        {},
        (_error: any, address: string) => (pinned = address),
      );
      const req = new EventEmitter() as any;
      req.end = () =>
        respond({
          statusCode: 302,
          headers: { location: 'http://127.0.0.1/private' },
          destroy: () => {},
        });
      return req;
    },
  };
  const details: any = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/one',
    headers: {},
    body: Buffer.from('encrypted'),
  };
  expect(
    await sendPushRequest(details, new AbortController().signal, network),
  ).toBe(302);
  expect(requests).toBe(1);
  expect(pinned).toBe('8.8.8.8');
  network.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  await expect(
    sendPushRequest(details, new AbortController().signal, network),
  ).rejects.toThrow('push-destination-forbidden');
  expect(requests).toBe(1);
  await expect(
    sendPushRequest(
      { ...details, endpoint: 'https://evil.test/' },
      new AbortController().signal,
      network,
    ),
  ).rejects.toThrow('push-provider-unsupported');
  expect(requests).toBe(1);
});

test('late presence updates cannot clear the current tab; renewal cannot restore revoked opt-in', async () => {
  const { p, sent } = fixture();
  p.presence('d', 'https://deck.test', 'tab', 's', 2);
  p.presence('d', 'https://deck.test', 'tab', null, 1);
  p.accept(event(1));
  await drain();
  expect(sent).toHaveLength(0);
  p.unsubscribe('d', 'https://deck.test');
  expect(() =>
    p.subscribe('d', 'https://deck.test', subscription(), true),
  ).toThrow('push-not-enabled');
  expect(p.status('d', 'https://deck.test').enabled).toBe(false);
});

test('device revocation aborts already-started delivery and removes durable subscription', async () => {
  let signal: AbortSignal | undefined;
  const { p } = fixture({
    send: async (_details: any, _payload: any, s: AbortSignal) => {
      signal = s;
      await new Promise(() => {});
      return 201;
    },
  });
  p.accept(event(1));
  await drain();
  expect(signal?.aborted).toBe(false);
  p.revoke('d');
  expect(signal?.aborted).toBe(true);
  expect(p.status('d', 'https://deck.test').enabled).toBe(false);
});

test('distinct transmitted completions use occurrence-specific provider topics',async()=>{
 const {p,sent}=fixture();p.accept(event(1));await drain();p.accept(event(2));await drain();expect(sent).toHaveLength(2);expect(sent[0][0].headers.Topic).not.toBe(sent[1][0].headers.Topic);
});
test('expired device authorization removes its subscription before delivery',async()=>{
 let active=true;const {p,sent}=fixture({isDeviceActive:()=>active});active=false;p.accept(event(1));await drain();expect(sent).toHaveLength(0);expect(p.status('d','https://deck.test').enabled).toBe(false);
});

test('lost hidden-tab release cannot discard repeated new completions behind a stale lease',async()=>{
 let now=1000;const {p,sent}=fixture({now:()=>now});
 p.presence('d','https://deck.test','suspended-tab','s',1,0);
 p.accept(event(1));await drain();expect(sent).toHaveLength(0);
 now+=2100;await Bun.sleep(2100);expect(sent).toHaveLength(1);
 p.accept(event(2));now+=2100;await Bun.sleep(2100);expect(sent).toHaveLength(2);
});
test('a live foreground acknowledgement suppresses only the event actually received',async()=>{
 const {p,sent}=fixture();p.presence('d','https://deck.test','reading','s',1,0);p.accept(event(1));await drain();
 p.presence('d','https://deck.test','reading','s',2,1);await drain();expect(sent).toHaveLength(0);
 p.presence('d','https://deck.test','background',null,1,0);p.accept(event(2));await Bun.sleep(2150);expect(sent).toHaveLength(1);
 expect(p.status('d','https://deck.test').delivery).toMatchObject({suppressed:1,sent:1});
});

test('bounded diagnostics distinguish provider acceptance, rejection and network errors without sensitive details',async()=>{
 for(const status of [201,403]){const {p}=fixture({send:async()=>status});p.accept(event(1));await drain();const d=p.status('d','https://deck.test').delivery;expect(d.eligible).toBe(1);expect(d.lastStatus).toBe(status);expect(d.lastOutcome).toBe(status===201?'accepted':'rejected');}
 const {p}=fixture({send:async()=>{throw new Error('https://provider.test/private-endpoint secret-key raw-error');}});p.accept(event(1));await drain();const d=p.status('d','https://deck.test').delivery;expect(d.lastOutcome).toBe('transport-error');expect(JSON.stringify(d)).not.toMatch(/private-endpoint|secret-key|raw-error|provider\.test/);
});
test('multi-tab acknowledgement ordering cannot acknowledge future completions or let stale release clear a new view',async()=>{
 const {p,sent}=fixture();p.presence('d','https://deck.test','one','s',2,2);p.presence('d','https://deck.test','one',null,1,0);p.presence('d','https://deck.test','two',null,1,0);
 p.accept(event(2));await drain();expect(p.status('d','https://deck.test').delivery.suppressed).toBe(1);
 p.accept(event(3));await Bun.sleep(2100);expect(sent).toHaveLength(1);expect(sent[0][1].seq).toBe(3);
});

test('distinct decisions and results survive the same Lead attempt, unseen approvals and restart',async()=>{
  let items:any[]=[];
  const {p,paths,sent}=fixture({attentionItems:()=>items,attentionSessions:()=>['s']});
  const ts=Date.now();
  items=[{sessionId:'s',kind:'approval',key:'approval:a',revision:1,seq:1,ts}];p.evaluate();await drain();
  items.push(...['decision:a','decision:b','result:lead:1'].map((key,n)=>({sessionId:'s',kind:n<2?'decision':'result',key,revision:1,seq:2+n,ts,summary:n<2?`Choose ${n}.`:'Delivery repaired.',othersActive:true})));
  p.evaluate();await drain();expect(sent).toHaveLength(4);
  expect(sent.map(x=>x[1].attention)).toEqual(['approval','decision','decision','result']);
  expect(sent[3][1]).toMatchObject({kind:'finished',summary:'Delivery repaired.',othersActive:true});
  p.evaluate();await drain();expect(sent).toHaveLength(4);
  p.close();const replay:any[]=[];
  const reload=new WebPush({paths,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args)=>{replay.push(args);return 201;}});hosts.push(reload);await drain();await drain();expect(replay).toHaveLength(0);
  items[1]={...items[1],revision:2,seq:5};reload.evaluate();await drain();expect(replay).toHaveLength(1);expect(replay[0][1].tagId).toBe(sent[1][1].tagId);expect(replay[0][0].headers.Topic).not.toBe(sent[1][0].headers.Topic);
});
test('migration floors, recovery, durable per-device viewing and opt-out',async()=>{
  let now=100000;let items:any[]=[];
  const {p,paths,sent}=fixture({now:()=>now,attentionItems:()=>items,attentionSessions:()=>['s']});
  const item={sessionId:'s',kind:'decision',key:'decision:a',revision:1,seq:5,ts:now-1,summary:'Choose storage.'};
  items=[item];p.evaluate();await drain();expect(sent).toHaveLength(0);
  items=[{...item,ts:now}];p.presence('d','https://deck.test','tab','s',1,5);p.evaluate();await drain();expect(sent).toHaveLength(0);
  p.close();const replay:any[]=[];const reload=new WebPush({paths,now:()=>now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args)=>{replay.push(args);return 201;}});hosts.push(reload);await drain();expect(replay).toHaveLength(0);
  items=[{...item,ts:now,revision:2,seq:6}];reload.evaluate();await drain();expect(replay).toHaveLength(1);
  reload.unsubscribe('d');items=[{...items[0],seq:7,revision:3}];reload.evaluate();await drain();expect(replay).toHaveLength(1);
});
test('retry uses stable identity and rechecks relevance and device authorization with fake time',async()=>{
  let now=Date.now(),active=true,items:any[]=[];const calls:any[]=[];
  const {p}=fixture({now:()=>now,isDeviceActive:()=>active,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args:any[])=>{calls.push(args);return calls.length===1?503:201;}});
  items=[{sessionId:'s',kind:'decision',key:'decision:a',revision:1,seq:1,ts:now,summary:'Pick storage.'}];p.evaluate();await drain();expect(calls).toHaveLength(1);
  now+=5001;p.evaluate();await drain();expect(calls).toHaveLength(2);expect(calls[0][1]).toEqual(calls[1][1]);expect(calls[0][0].headers.Topic).toBe(calls[1][0].headers.Topic);
  expect(p.status('d','https://deck.test').delivery).toMatchObject({sent:1,retried:1});
  items=[{...items[0],key:'decision:b',seq:2}];active=false;p.evaluate();await drain();expect(calls).toHaveLength(2);expect(p.status('d','https://deck.test').enabled).toBe(false);
});

test('a resolved or revised occurrence cannot retry, and permanent rejection is durable',async()=>{
 let now=Date.now();let items:any[]=[];const calls:any[]=[];
 const {p,paths}=fixture({now:()=>now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args:any[])=>{calls.push(args);return 503;}});
 items=[{sessionId:'s',kind:'decision',key:'decision:a',revision:1,seq:1,ts:now,summary:'Approve?'}];p.evaluate();await drain();expect(calls).toHaveLength(1);
 items=[];now+=5001;p.evaluate('s');await drain();expect(calls).toHaveLength(1);
 items=[{sessionId:'s',kind:'decision',key:'decision:a',revision:2,seq:2,ts:now,summary:'Revised?'}];p.evaluate('s');await drain();expect(calls).toHaveLength(2);expect(calls[1][1].summary).toBe('Revised?');
 p.close();const rejected:any[]=[];const reload=new WebPush({paths,now:()=>now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args)=>{rejected.push(args);return 400;}});hosts.push(reload);await drain();await drain();expect(rejected).toHaveLength(1);
 reload.close();const again=new WebPush({paths,now:()=>now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['s'],send:async()=>{throw Error('unexpected resend');}});hosts.push(again);await drain();expect(again.status('d','https://deck.test').delivery.eligible).toBe(0);
});

test('acceptance before receipt persistence may replay with identical identity after crash',async()=>{
 const {readFileSync,writeFileSync}=await import('node:fs');let now=Date.now(),items:any[]=[];
 const {p,paths,sent}=fixture({now:()=>now,attentionItems:()=>items,attentionSessions:()=>['s']});
 const file=join(paths.webDir,'push-attention.json'),before=readFileSync(file,'utf8');
 items=[{sessionId:'s',kind:'decision',key:'decision:a',revision:1,seq:1,ts:now,summary:'Approve storage?'}];p.evaluate();await drain();expect(sent).toHaveLength(1);p.close();
 // Restore the last durable pre-acceptance receipt image to model that crash window.
 const {Database}=await import('bun:sqlite');const db=new Database(join(paths.webDir,'push-attention.sqlite'));db.exec('DELETE FROM outcomes');db.close();
 writeFileSync(file,before);const replay:any[]=[];const reload=new WebPush({paths,now:()=>now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args)=>{replay.push(args);return 201;}});hosts.push(reload);await drain();await drain();
 expect(replay).toHaveLength(1);expect(replay[0][1]).toEqual(sent[0][1]);expect(replay[0][0].headers.Topic).toBe(sent[0][0].headers.Topic);
});

test('formatted credentials and quoted code never reach fake-send summaries',async()=>{
 const {summarize}=await import('../push-attention');const now=Date.now();
 const {redactText}=await import('@deck/core/session/redaction');
 const texts=['**password**: DEMOPASSWORD42','**token:** DEMO_SECRET_42',redactText('**token:** DEMO_SECRET_42'),'> ```text\n> PRIVATE_CODE_42\n> ```\nDelivery fixed.'];
 let items:any[]=[];const {p,sent}=fixture({now:()=>now,attentionItems:()=>items,attentionSessions:()=>['s']});
 items=texts.map((text,n)=>({sessionId:'s',kind:'decision',key:`decision:${n}`,revision:1,seq:n+1,ts:now,summary:summarize(text)}));p.evaluate();await drain();
 expect(sent).toHaveLength(4);expect(JSON.stringify(sent.map(x=>x[1]))).not.toMatch(/DEMOPASSWORD42|DEMO_?SECRET_?42|PRIVATE_?CODE_?42/);
});
test('renewal retargets queued attention before first send without another trigger',async()=>{
 let items:any[]=[];const now=Date.now();const {p,sent}=fixture({now:()=>now,attentionItems:()=>items,attentionSessions:()=>['s']});await drain();
 items=[{sessionId:'s',kind:'decision',key:'decision:renew',revision:1,seq:1,ts:now,summary:'Approve?'}];p.evaluate();p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','renewed'),true);await drain();
 expect(sent).toHaveLength(1);expect(sent[0][0].endpoint).toEndWith('/renewed');expect(p.status('d','https://deck.test').delivery).toMatchObject({eligible:1,sent:1});
});

async function withPushClock(run:(clock:import('./test-helpers').FakeClock,advance:(ms:number)=>Promise<void>)=>Promise<void>){
 const {FakeClock}=await import('./test-helpers');const clock=new FakeClock();clock.advance(1000);
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 globalThis.setTimeout=clock.setTimeout as any;globalThis.clearTimeout=clock.clearTimeout as any;
 const advance=async(ms:number)=>{clock.advance(ms);for(let i=0;i<30;i++)await Promise.resolve();};
 try{await run(clock,advance);}finally{hosts.splice(0).forEach(p=>p.close());globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;}
}
test('renewal retains retry budget, topic and current authorization under fake timers',async()=>{
 await withPushClock(async(clock,advance)=>{
  let items:any[]=[],active=true;const calls:any[]=[];
  const {p}=fixture({now:clock.now,isDeviceActive:()=>active,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args:any[])=>{calls.push(args);return 503;}});
  await advance(40);items=[{sessionId:'s',kind:'decision',key:'decision:retry-renew',revision:1,seq:1,ts:clock.now(),summary:'Approve?'}];p.evaluate();await advance(40);expect(calls).toHaveLength(1);
  p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','renew-two'),true);await advance(4900);expect(calls).toHaveLength(1);await advance(140);expect(calls).toHaveLength(2);expect(calls[1][0].endpoint).toEndWith('/renew-two');
  p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','renew-three'),true);await advance(30020);expect(calls).toHaveLength(3);expect(calls[2][0].endpoint).toEndWith('/renew-three');
  expect(calls[0][0].headers.Topic).toBe(calls[2][0].headers.Topic);expect(p.status('d','https://deck.test').delivery).toMatchObject({eligible:1,retried:2,failed:1,sent:0});
  p.evaluate();await advance(40000);expect(calls).toHaveLength(3);
  items=[{...items[0],key:'decision:stale',seq:2}];p.evaluate();await advance(40);expect(calls).toHaveLength(4);p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','renew-stale'),true);items=[];await advance(5040);expect(calls).toHaveLength(4);
  items=[{sessionId:'s',kind:'decision',key:'decision:revoke',revision:1,seq:3,ts:clock.now()}];p.evaluate();await advance(40);expect(calls).toHaveLength(5);p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','renew-revoke'),true);active=false;await advance(5040);expect(calls).toHaveLength(5);expect(p.status('d','https://deck.test').enabled).toBe(false);
 });
});
test('durable outcomes beyond cache capacity keep independent unsent work eligible immediately',async()=>{
 for(const outcome of ['sent','failed'] as const)await withPushClock(async(clock,advance)=>{
  const {PushAttentionStore}=await import('../push-attention-store');
  let items:any[]=[];const {p,paths}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s']});p.close();
  const store=new PushAttentionStore(paths.webDir,clock.now),device=JSON.stringify(['d','https://deck.test']);
  const old=Array.from({length:512},(_,n)=>({sessionId:`s${Math.floor(n/16)}`,kind:'decision' as const,key:`decision:${n}`,revision:1,seq:n+1,ts:clock.now()}));
  for(const item of old)expect(store.record(device,item,outcome)).toBe(true);
  clock.advance(60000);const pending={sessionId:'independent',kind:'result' as const,key:'decision:pending',revision:1,seq:1,ts:clock.now(),summary:'Still waiting.'};items=[...old,pending];const calls:any[]=[];
  const opts={paths,now:clock.now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:(id:string)=>items.filter(i=>i.sessionId===id),attentionSessions:()=>[...new Set(items.map(i=>i.sessionId))],send:async(...args:any[])=>{calls.push(args);return 201;}};
  const first=new WebPush(opts);hosts.push(first);await advance(80);expect(calls).toHaveLength(1);expect(first.status('d','https://deck.test').delivery).toMatchObject({sent:1,deferred:0});first.close();
  const reload=new WebPush(opts);hosts.push(reload);await advance(80);expect(calls).toHaveLength(1);
  // Expiry cannot re-open any previously accounted outcome.
  await advance(1000+86400000+1-clock.now());await advance(60);expect(calls).toHaveLength(1);expect(calls[0][1]).toMatchObject({sessionId:'independent',summary:'Still waiting.'});
  reload.close();const last=new WebPush(opts);hosts.push(last);await advance(80);expect(calls).toHaveLength(1);
 });
});

test('concurrent independent transports do not compete for durable identity capacity',async()=>{
 await withPushClock(async(clock,advance)=>{
  const {PushAttentionStore}=await import('../push-attention-store');const {readFileSync}=await import('node:fs');
  const {p,paths}=fixture({now:clock.now});p.close();const device=JSON.stringify(['d','https://deck.test']),store=new PushAttentionStore(paths.webDir,clock.now);
  for(let n=0;n<510;n++)expect(store.record(device,{sessionId:'old',kind:'decision',key:`decision:${n}`,revision:1,seq:n+1,ts:clock.now()},'sent')).toBe(true);
  clock.advance(60000);const items=Array.from({length:4},(_,n)=>({sessionId:'new',kind:'decision' as const,key:`decision:new${n}`,revision:1,seq:n+1,ts:clock.now()}));const calls:any[]=[],finish:((status:number)=>void)[]=[];
  const opts={paths,now:clock.now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['new'],send:async(...args:any[])=>{calls.push(args);return new Promise<number>(resolve=>finish.push(resolve));}};
  const first=new WebPush(opts);hosts.push(first);await advance(80);expect(calls).toHaveLength(4);
  finish[0]!(201);finish[1]!(400);finish[2]!(201);finish[3]!(400);await advance(0);await advance(80);expect(calls).toHaveLength(4);
  expect(first.status('d','https://deck.test').delivery).toMatchObject({sent:2,failed:2});
  const {Database}=await import('bun:sqlite');const index=new Database(join(paths.webDir,'push-attention.sqlite'),{readonly:true});expect((index.query('SELECT COUNT(*) AS n FROM outcomes').get() as any).n).toBe(514);index.close();
  first.close();const reload=new WebPush({...opts,send:async(...args:any[])=>{calls.push(args);return 201;}});hosts.push(reload);await advance(80);expect(calls).toHaveLength(4);
  await advance(1000+86400000+1-clock.now());await advance(80);expect(calls).toHaveLength(4);
 });
});

test('active renewal preserves known acceptance and retry accounting across destination changes',async()=>{
 await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const calls:any[]=[],finish:((status:number)=>void)[]=[];
  const {p}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...args:any[])=>{calls.push(args);return new Promise<number>(r=>finish.push(r));}});await advance(60);
  items=[{sessionId:'s',kind:'decision',key:'decision:active',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(40);
  p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','new-1'),true);finish[0]!(503);await advance(0);await advance(80);expect(calls).toHaveLength(1);expect(p.status('d','https://deck.test').delivery.retried).toBe(1);
  await advance(5000);expect(calls).toHaveLength(2);expect(calls[1][0].endpoint).toEndWith('/new-1');
  p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','new-2'),true);finish[1]!(201);await advance(0);await advance(80);expect(calls).toHaveLength(2);expect(p.status('d','https://deck.test').delivery).toMatchObject({sent:1,retried:1,eligible:1});
 });
});
test('512 still-relevant terminal outcomes never delay an independent 30-minute result',async()=>{
 for(const outcome of ['sent','failed'] as const)await withPushClock(async(clock,advance)=>{
  const {PushAttentionStore}=await import('../push-attention-store');let items:any[]=[];
  const {p,paths}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>[]});p.close();
  const store=new PushAttentionStore(paths.webDir,clock.now),device=JSON.stringify(['d','https://deck.test']);
  const current=Array.from({length:512},(_,n)=>({sessionId:'s'+Math.floor(n/16),kind:'decision' as const,key:'decision:'+n,revision:1,seq:n+1,ts:clock.now()}));for(const a of current)store.record(device,a,outcome);
  clock.advance(60000);items=[...current,{sessionId:'new',kind:'result',key:'result:lead:2',revision:1,seq:999,ts:clock.now(),summary:'Independent result.'}];const sent:any[]=[];
  const opts={paths,now:clock.now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:(id:string)=>items.filter(i=>i.sessionId===id),attentionSessions:()=>[...new Set(items.map(i=>i.sessionId))],send:async(...a:any[])=>{sent.push(a);return 201;}};
  const first=new WebPush(opts);hosts.push(first);await advance(80);expect(sent).toHaveLength(1);expect(sent[0][1]).toMatchObject({attention:'result',summary:'Independent result.'});first.close();
  const reload=new WebPush(opts);hosts.push(reload);await advance(80);expect(sent).toHaveLength(1);
 });
});

test('known 201 survives active same-endpoint renewal and restart',async()=>{
 await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const calls:any[]=[],finish:((s:number)=>void)[]=[];
  const {p,paths}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...a:any[])=>{calls.push(a);return new Promise<number>(r=>finish.push(r));}});await advance(60);
  items=[{sessionId:'s',kind:'decision',key:'decision:201',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(40);
  p.subscribe('d','https://deck.test',subscription(),true);finish[0]!(201);await advance(0);await advance(200);expect(calls).toHaveLength(1);expect(p.status('d','https://deck.test').delivery).toMatchObject({sent:1,eligible:1});p.close();
  const next=new WebPush({paths,now:clock.now,isDeviceActive:()=>true,isCurrent:()=>false,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...a)=>{calls.push(a);return 201;}});hosts.push(next);await advance(80);expect(calls).toHaveLength(1);
 });
});
test('renewing every active 503 never resets three attempts or 5s/30s backoff',async()=>{
 await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const calls:any[]=[],finish:((s:number)=>void)[]=[];
  const {p}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...a:any[])=>{calls.push({a,at:clock.now()});return new Promise<number>(r=>finish.push(r));}});await advance(60);
  items=[{sessionId:'s',kind:'decision',key:'decision:503',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(40);
  for(let n=0;n<3;n++){
   p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','r'+n),true);finish[n]!(503);await advance(0);await advance(100);expect(calls).toHaveLength(n+1);
   if(n<2){await advance(n===0?4900:29900);await advance(40);expect(calls).toHaveLength(n+2);}
  }
  await advance(40000);expect(calls).toHaveLength(3);expect(calls[1].at-calls[0].at).toBeGreaterThanOrEqual(5000);expect(calls[2].at-calls[1].at).toBeGreaterThanOrEqual(30000);
  expect(p.status('d','https://deck.test').delivery).toMatchObject({eligible:1,retried:2,failed:1,sent:0});
 });
});
test('obsolete endpoint 400/404/410 cannot revoke or permanently fail replacement destination',async()=>{
 for(const status of [400,404,410])await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const calls:any[]=[],finish:((s:number)=>void)[]=[];
  const {p}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...a:any[])=>{calls.push(a);return new Promise<number>(r=>finish.push(r));}});await advance(60);
  items=[{sessionId:'s',kind:'decision',key:'decision:stale-endpoint',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(40);
  p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','replacement'),true);finish[0]!(status);await advance(0);await advance(100);expect(p.status('d','https://deck.test').enabled).toBe(true);expect(calls).toHaveLength(1);
  await advance(5000);expect(calls).toHaveLength(2);expect(calls[1][0].endpoint).toEndWith('/replacement');finish[1]!(201);await advance(0);expect(p.status('d','https://deck.test').delivery).toMatchObject({sent:1,retried:1,failed:0});
 });
});
test('revocation and immediate re-opt-in isolate held old responses and fresh authorization',async()=>{
 for(const status of [201,503,410])await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const calls:any[]=[],finish:((s:number)=>void)[]=[];
  const {p}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...a:any[])=>{calls.push(a);return new Promise<number>(r=>finish.push(r));}});await advance(60);
  items=[{sessionId:'s',kind:'decision',key:'decision:epoch',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(40);
  p.revoke('d');expect(calls[0][2].aborted).toBe(true);p.subscribe('d','https://deck.test',subscription('fcm.googleapis.com','reopt'));
  // The same occurrence remains current but is now after this explicit opt-in's floor.
  items=[{...items[0],ts:clock.now()}];p.evaluate();await advance(80);expect(calls).toHaveLength(2);
  finish[0]!(status);await advance(0);await advance(80);expect(p.status('d','https://deck.test').enabled).toBe(true);expect(p.status('d','https://deck.test').delivery.sent).toBe(0);expect(calls).toHaveLength(2);
  finish[1]!(201);await advance(0);expect(p.status('d','https://deck.test').delivery.sent).toBe(1);
 });
});

test('index I/O failure reports uncertainty and automatically resumes independent work after repair',async()=>{
 await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const calls:any[]=[];let p!:WebPush;
  const f=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s'],send:async(...a:any[])=>{calls.push(a);if(calls.length===1)((p as any).receipts as any).db.exec('PRAGMA query_only=ON');return 201;}});p=f.p;await advance(60);
  items=[{sessionId:'s',kind:'decision',key:'decision:io',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(80);
  expect(calls).toHaveLength(1);expect(p.status('d','https://deck.test').delivery).toMatchObject({sent:1,persistenceHealthy:false,lastOutcome:'waiting-for-storage'});expect(p.status('d','https://deck.test').delivery.persistenceFailures).toBeGreaterThan(0);
  items.push({...items[0],kind:'result',key:'result:independent',seq:2});p.evaluate();await advance(80);expect(calls).toHaveLength(1);
  ((p as any).receipts as any).db.exec('PRAGMA query_only=OFF');await advance(5000);await advance(80);expect(calls).toHaveLength(2);expect(calls[1][1].attention).toBe('result');expect(p.status('d','https://deck.test').delivery.persistenceHealthy).toBe(true);
 });
});

test('idle expiry maintenance compacts durable outcomes without an unrelated trigger',async()=>{
 await withPushClock(async(clock,advance)=>{
  let items:any[]=[];const {p,sent}=fixture({now:clock.now,attentionItems:()=>items,attentionSessions:()=>['s']});await advance(60);
  items=[{sessionId:'s',kind:'result',key:'result:lead:1',revision:1,seq:1,ts:clock.now()}];p.evaluate();await advance(80);expect(sent).toHaveLength(1);
  const db=((p as any).receipts as any).db;expect(db.query('SELECT COUNT(*) AS n FROM outcomes').get().n).toBe(1);
  await advance(31*60000);expect(db.query('SELECT COUNT(*) AS n FROM outcomes').get().n).toBe(0);expect(sent).toHaveLength(1);
 });
});

test('reply pages recover later independent occurrences beyond already-sent history',async()=>{
 const count=100,now=Date.now(),items=Array.from({length:count},(_,n)=>({sessionId:'s',kind:'finished' as const,key:`reply-${n+2}-${n+1}`,replyId:`reply-${n+2}-${n+1}`,revision:1,seq:n+2,ts:now+1,summary:`Reply ${n}.`}));
 let pages=0;
 const f=fixture({now:()=>now,attentionSessions:()=>['s'],attentionItems:()=>[],
 replyAttentionPage:(_id:string,after=0)=>{pages++;const start=after?items.findIndex(i=>i.seq===after)+1:0;const page=items.slice(start,start+32);return {items:page,...(start+32<items.length?{nextCursor:page.at(-1)!.seq}:{})};},
 replyAttentionItem:(_id:string,id:string)=>items.find(i=>i.replyId===id),isReplyDisplayed:()=>false});
 f.p.evaluate();for(let n=0;n<200&&f.sent.length<count;n++)await Bun.sleep(20);
 expect(f.sent).toHaveLength(count);expect(new Set(f.sent.map(s=>s[1].replyId)).size).toBe(count);expect(pages).toBeGreaterThan(3);
 f.p.evaluate();await drain();expect(f.sent).toHaveLength(count);
});

test('grouped notification session names are optional, redacted and refreshed before transport',async()=>{
 await withPushClock(async(clock,advance)=>{
  let name='Original';
  const {p,sent}=fixture({now:clock.now,sessionName:()=>name});
  p.accept(event(1));name='Latest name';await advance(80);
  expect(sent[0][1].sessionName).toBe('Latest name');
  name='password=SUPERPRIVATE';p.accept(event(2));await advance(80);
  expect(sent[1][1].sessionName).not.toContain('SUPERPRIVATE');
 });
});
