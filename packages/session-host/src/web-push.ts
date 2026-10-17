/** Private browser subscriptions and best-effort, live-only user-attention delivery. */
import { createHash, ECDH } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import webPush from 'web-push';
import type { SessionEvent } from '@deck/core/session/events';
import { assertPrivateFile, writePrivateFile, type StatePaths } from './paths';

export type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
};
export type PushAttention = {
  sessionId: string;
  seq: number;
  kind: 'finished' | 'failure' | 'question' | 'approval';
};
type RecordEntry = {
  deviceId: string;
  origin: string;
  subscription: BrowserSubscription;
};
type Store = {
  v: 1;
  keys: { publicKey: string; privateKey: string };
  subscriptions: RecordEntry[];
};
type Delivery = {
  attention: PushAttention;
  record: RecordEntry;
  expires: number;
};
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const validId = (id: unknown): id is string =>
  typeof id === 'string' && SAFE_ID.test(id) && !id.includes('..');
const b64 = (value: unknown, bytes: number) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]+$/.test(value) &&
  Buffer.from(value, 'base64url').length === bytes;

const allowedPushHost = (host: string) =>
  host === 'fcm.googleapis.com' ||
  host === 'updates.push.services.mozilla.com' ||
  /^(?:[a-z0-9-]+\.)+push\.apple\.com$/.test(host);

export function validatePushSubscription(value: unknown): BrowserSubscription {
  const s = value as BrowserSubscription;
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 4096)
    throw new Error('push-subscription-invalid');
  const u = new URL(s.endpoint);
  const provider = allowedPushHost(u.hostname);
  if (
    !provider ||
    u.protocol !== 'https:' ||
    u.port ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname === '/' ||
    /[\\\s]/.test(s.endpoint)
  )
    throw new Error('push-provider-unsupported');
  if (!s.keys || !b64(s.keys.p256dh, 65) || !b64(s.keys.auth, 16))
    throw new Error('push-subscription-invalid');
  // The peer key must be a real uncompressed P-256 point, not just a correctly sized string.
  ECDH.convertKey(Buffer.from(s.keys.p256dh, 'base64url'), 'prime256v1');
  if (
    s.expirationTime !== undefined &&
    s.expirationTime !== null &&
    (!Number.isFinite(s.expirationTime) || s.expirationTime <= Date.now())
  )
    throw new Error('push-subscription-expired');
  return {
    endpoint: u.href,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    ...(s.expirationTime === undefined
      ? {}
      : { expirationTime: s.expirationTime }),
  };
}

/** Fail closed for private, link-local, mapped, reserved and non-global DNS answers. */
export function isPublicPushAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  const [first, second] = address.split(':').map((v) => parseInt(v || '0', 16));
  return (
    first !== 0x2002 &&
    first !== 0x3ffe &&
    first !== 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8))
  );
}

export type PushRequest = ReturnType<typeof webPush.generateRequestDetails>;
/** web-push owns all protocol crypto; this transport pins public DNS and never follows redirects. */
export async function sendPushRequest(
  details: PushRequest,
  signal: AbortSignal,
  network = { lookup, request },
): Promise<number> {
  validatePushSubscriptionEndpoint(details.endpoint);
  const u = new URL(details.endpoint);
  const answers = await network.lookup(u.hostname, { all: true });
  if (
    signal.aborted ||
    !answers.length ||
    answers.some((a) => !isPublicPushAddress(a.address))
  )
    throw new Error('push-destination-forbidden');
  const answer = answers.find((a) => a.family === 4) ?? answers[0]!;
  return new Promise((resolve, reject) => {
    const req = network.request(
      u,
      {
        method: 'POST',
        headers: details.headers,
        signal,
        agent: false,
        lookup: ((_host: any, options: any, callback: any) =>
          options?.all
            ? callback(null, [answer])
            : callback(null, answer.address, answer.family)) as any,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.destroy();
        resolve(status);
      },
    );
    req.on('error', () => reject(new Error('push-delivery-failed')));
    req.end(details.body);
  });
}
function validatePushSubscriptionEndpoint(endpoint: string) {
  // Reuse the same URL policy at the final outbound boundary, including persisted records.
  const u = new URL(endpoint);
  if (
    u.protocol !== 'https:' ||
    u.port ||
    u.username ||
    u.password ||
    u.hash ||
    !allowedPushHost(u.hostname)
  )
    throw new Error('push-provider-unsupported');
}
export function pushAttention(event: SessionEvent): PushAttention | undefined {
  if (!validId(event.sessionId)) return;
  const lead =
    event.source.memberId !== undefined
      ? event.source.memberId === 'lead'
      : typeof event.source.taskId === 'string' &&
        /^lead(?:-g\d+)?$/.test(event.source.taskId);
  const base = { sessionId: event.sessionId, seq: event.seq };
  if (
    event.kind === 'question.requested' &&
    typeof event.data.questionId === 'string'
  )
    return { ...base, kind: 'question' };
  if (
    event.kind === 'approval.requested' &&
    typeof event.data.approvalId === 'string'
  )
    return { ...base, kind: 'approval' };
  if (event.kind === 'turn.completed' && lead) {
    if (event.data.status === 'completed') return { ...base, kind: 'finished' };
    if (event.data.status === 'failed') return { ...base, kind: 'failure' };
  }
  if (
    event.kind === 'prompt.queue' &&
    event.data.paused === true &&
    ![
      'interrupted',
      'interrupted-forced',
      'session-released',
      'session-stopped',
    ].includes(String(event.data.reason))
  )
    return { ...base, kind: 'failure' };
  if (
    event.kind === 'diagnostic' &&
    event.data.code === 'session.preparation' &&
    event.data.status === 'failed'
  )
    return { ...base, kind: 'failure' };
  if (event.kind === 'session.released' && event.data.reasonCode)
    return { ...base, kind: 'failure' };
}
export type WebPushOptions = {
  paths: StatePaths;
  isDeviceActive: (id: string) => boolean;
  isCurrent: (attention: PushAttention) => boolean;
  send?: (
    details: PushRequest,
    payload: PushAttention,
    signal: AbortSignal,
  ) => Promise<number>;
  now?: () => number;
};
export class WebPush {
  private store?: Store;
  private queue = new Map<string, Delivery>();
  private seen = new Map<string, number>();
  private presenceTabs = new Map<
    string,
    {
      deviceId: string;
      origin: string;
      sessionId: string | null;
      until: number;
      revision: number;
    }
  >();
  private timer?: ReturnType<typeof setTimeout>;
  private controllers = new Map<AbortController, RecordEntry>();
  private closed = false;
  private readonly now: () => number;
  constructor(private options: WebPushOptions) {
    this.now = options.now ?? Date.now;
    if (existsSync(this.file)) {
      assertPrivateFile(this.file);
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Store;
      if (
        s.v !== 1 ||
        !b64(s.keys?.publicKey, 65) ||
        !b64(s.keys?.privateKey, 32) ||
        !Array.isArray(s.subscriptions) ||
        s.subscriptions.length > 128
      )
        throw new Error('push-store-invalid');
      this.store = {
        ...s,
        subscriptions: s.subscriptions.filter((r) => {
          try {
            return (
              options.isDeviceActive(r.deviceId) &&
              validId(r.deviceId) &&
              new URL(r.origin).origin === r.origin &&
              !!validatePushSubscription(r.subscription)
            );
          } catch {
            return false;
          }
        }),
      };
      if (this.store.subscriptions.length !== s.subscriptions.length)
        this.save();
    }
  }
  private get file() {
    return join(this.options.paths.webDir, 'push.json');
  }
  private identity() {
    if (!this.store) {
      this.store = {
        v: 1,
        keys: webPush.generateVAPIDKeys(),
        subscriptions: [],
      };
      this.save();
    }
    return this.store;
  }
  private save() {
    writePrivateFile(this.file, JSON.stringify(this.store));
  }
  status(deviceId: string, origin: string) {
    return {
      enabled: !!this.store?.subscriptions.some(
        (r) => r.deviceId === deviceId && r.origin === origin,
      ),
      publicKey: this.identity().keys.publicKey,
    };
  }
  subscribe(deviceId: string, origin: string, value: unknown, renew = false) {
    if (!validId(deviceId) || new URL(origin).origin !== origin)
      throw new Error('push-subscription-invalid');
    const subscription = validatePushSubscription(value),
      store = this.identity();
    if (
      renew &&
      !store.subscriptions.some(
        (r) => r.deviceId === deviceId && r.origin === origin,
      )
    )
      throw new Error('push-not-enabled');
    if (
      store.subscriptions.some(
        (r) =>
          r.subscription.endpoint === subscription.endpoint &&
          (r.deviceId !== deviceId || r.origin !== origin),
      )
    )
      throw new Error('push-subscription-owned');
    if (
      !store.subscriptions.some(
        (r) => r.deviceId === deviceId && r.origin === origin,
      ) &&
      store.subscriptions.length >= 128
    )
      throw new Error('push-subscription-limit');
    store.subscriptions = store.subscriptions.filter(
      (r) => r.deviceId !== deviceId || r.origin !== origin,
    );
    store.subscriptions.push({ deviceId, origin, subscription });
    this.save();
  }
  unsubscribe(deviceId: string, origin?: string) {
    if (!this.store) return;
    this.store.subscriptions = this.store.subscriptions.filter(
      (r) =>
        r.deviceId !== deviceId ||
        (origin !== undefined && r.origin !== origin),
    );
    this.save();
    for (const [key, d] of this.queue)
      if (
        d.record.deviceId === deviceId &&
        (origin === undefined || d.record.origin === origin)
      )
        this.queue.delete(key);
    for (const [controller, record] of this.controllers)
      if (
        record.deviceId === deviceId &&
        (origin === undefined || record.origin === origin)
      )
        controller.abort();
  }
  revoke(deviceId: string) {
    this.unsubscribe(deviceId);
    for (const [key, p] of this.presenceTabs)
      if (p.deviceId === deviceId) this.presenceTabs.delete(key);
  }
  presence(
    deviceId: string,
    origin: string,
    tabId: string,
    sessionId: string | null,
    revision?: number,
  ) {
    if (!validId(tabId) || (sessionId !== null && !validId(sessionId)))
      throw new Error('push-presence-invalid');
    const key = JSON.stringify([deviceId, origin, tabId]);
    this.prunePresence();
    const previous = this.presenceTabs.get(key);
    revision ??= (previous?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new Error('push-presence-invalid');
    if (previous && revision <= previous.revision) return;
    if (
      !this.presenceTabs.has(key) &&
      [...this.presenceTabs.values()].filter((p) => p.deviceId === deviceId)
        .length >= 16
    )
      throw new Error('push-presence-limit');
    this.presenceTabs.set(key, {
      deviceId,
      origin,
      sessionId,
      until: this.now() + 45_000,
      revision,
    });
  }
  private prunePresence() {
    for (const [key, p] of this.presenceTabs)
      if (p.until <= this.now()) this.presenceTabs.delete(key);
  }
  private viewing(r: RecordEntry, id: string) {
    this.prunePresence();
    return [...this.presenceTabs.values()].some(
      (p) =>
        p.deviceId === r.deviceId &&
        p.origin === r.origin &&
        p.sessionId === id,
    );
  }
  accept(event: SessionEvent) {
    if (this.closed || !this.store?.subscriptions.length) return;
    const attention = pushAttention(event);
    if (!attention) return;
    const previous = this.seen.get(attention.sessionId) ?? 0;
    if (attention.seq <= previous) return;
    this.seen.delete(attention.sessionId);
    this.seen.set(attention.sessionId, attention.seq);
    if (this.seen.size > 1024) this.seen.delete(this.seen.keys().next().value!);
    for (const record of this.store.subscriptions) {
      const key = JSON.stringify([
        record.deviceId,
        record.origin,
        attention.sessionId,
        attention.kind,
        ['question', 'approval'].includes(attention.kind)
          ? attention.seq
          : undefined,
      ]);
      if (this.queue.size >= 256 && !this.queue.has(key)) continue;
      this.queue.set(key, { attention, record, expires: this.now() + 30_000 });
    }
    this.schedule();
  }
  private schedule() {
    if (this.closed || this.timer || !this.queue.size) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump();
    }, 20);
  }
  private pump() {
    while (!this.closed && this.controllers.size < 4 && this.queue.size) {
      const [key, job] = this.queue.entries().next().value!;
      this.queue.delete(key);
      const { attention: a, record: r } = job;
      if (!this.options.isDeviceActive(r.deviceId)) {
        this.removeRecord(r);
        continue;
      }
      if (
        job.expires < this.now() ||
        !this.store?.subscriptions.includes(r) ||
        this.viewing(r, a.sessionId) ||
        !this.options.isCurrent(a)
      )
        continue;
      if (
        r.subscription.expirationTime &&
        r.subscription.expirationTime <= this.now()
      ) {
        this.removeRecord(r);
        continue;
      }
      const controller = new AbortController();
      this.controllers.set(controller, r);
      const deadline = setTimeout(() => controller.abort(), 5000);
      // Execution leaves the event-log callback before any crypto, disk or network work.
      void (async () => {
        try {
          const topic = createHash('sha256')
            .update(JSON.stringify([a.sessionId, a.kind, a.seq]))
            .digest('base64url')
            .slice(0, 32);
          const details = webPush.generateRequestDetails(
            r.subscription,
            JSON.stringify(a),
            {
              vapidDetails: {
                ...this.store!.keys,
                subject: 'https://github.com/kevin15011/deck',
              },
              TTL: 60,
              urgency: 'normal',
              topic,
            },
          );
          const status = await new Promise<number>((resolve, reject) => {
            const abort = () => reject(new Error('push-deadline'));
            controller.signal.addEventListener('abort', abort, { once: true });
            const sending = this.options.send
              ? this.options.send(details, a, controller.signal)
              : sendPushRequest(details, controller.signal);
            void sending
              .then(resolve, reject)
              .finally(() =>
                controller.signal.removeEventListener('abort', abort),
              );
          });
          if (!this.closed && (status === 404 || status === 410))
            this.removeRecord(r);
        } catch {
          /* Delivery is best effort. Never log endpoints, keys or provider response bodies. */
        } finally {
          clearTimeout(deadline);
          this.controllers.delete(controller);
          this.schedule();
        }
      })();
    }
  }
  private removeRecord(record: RecordEntry) {
    if (!this.store?.subscriptions.includes(record)) return;
    this.store.subscriptions = this.store.subscriptions.filter(
      (r) => r !== record,
    );
    this.save();
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue.clear();
    this.presenceTabs.clear();
    for (const c of this.controllers.keys()) c.abort();
  }
}
