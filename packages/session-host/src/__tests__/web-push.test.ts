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
    expect(Object.keys(call[1]).sort()).toEqual(['kind','seq','sessionId']);
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
