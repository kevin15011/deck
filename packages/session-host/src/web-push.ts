/** Private browser subscriptions and bounded, recoverable user-attention delivery. */
import { createHash, ECDH } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import webPush from 'web-push';
import { PushAttentionStore, attentionExpires } from './push-attention-store';
import type { AttentionItem, AttentionKind } from './push-attention';
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
  replyId?: string;
  attention?: AttentionKind; summary?: string; othersActive?: boolean; tagId?: string;
};
type RecordEntry = {
  deviceId: string;
  origin: string;
  subscription: BrowserSubscription;
  epoch?: string;
  generation?: number;
};
type Store = {
  v: 1;
  keys: { publicKey: string; privateKey: string };
  subscriptions: RecordEntry[];
};
type Delivery = {
  attention: PushAttention;
  item?: AttentionItem;
  attempts?: number;
  record: RecordEntry;
  expires: number;
  acknowledgeBy: number;
  retryAt?: number;
  deferred?: boolean;
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
export type PushDeliveryStatus = {
  eligible: number;
  sent: number;
  suppressed: number;
  deferred: number;
  stale: number;
  failed: number;
  expired: number;
  queueFull: number;
  retried: number;
  lastOutcome?:
    | 'accepted'
    | 'viewed'
    | 'waiting-for-view'
    | 'waiting-for-storage'
    | 'stale'
    | 'expired'
    | 'queue-full'
    | 'rejected'
    | 'transport-error'
    | 'payload-error';
  lastStatus?: number;
  updatedAt?: string;
};
export type WebPushOptions = {
  paths: StatePaths;
  isDeviceActive: (id: string) => boolean;
  isCurrent: (attention: PushAttention) => boolean;
  attentionItems?: (sessionId: string) => AttentionItem[];
  replyAttentionPage?: (sessionId:string,after?:number)=>{items:AttentionItem[];nextCursor?:number};
  replyAttentionItem?: (sessionId:string,replyId:string)=>AttentionItem|undefined;
  isReplyDisplayed?: (deviceId:string,sessionId:string,replyId:string)=>boolean;
  attentionSessions?: () => string[];
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
  private delivery = new Map<string, PushDeliveryStatus>();
  private receipts: PushAttentionStore;
  private evaluating = new Set<string>();
  private storageTimer?: ReturnType<typeof setTimeout>;
  private maintenanceTimer?: ReturnType<typeof setTimeout>;
  private evaluationTimer?: ReturnType<typeof setTimeout>;
  private inflight = new Set<string>();
  private presenceTabs = new Map<
    string,
    {
      deviceId: string;
      origin: string;
      sessionId: string | null;
      until: number;
      revision: number;
      seenSeq?: number;
    }
  >();
  private timer?: ReturnType<typeof setTimeout>;
  private timerDue?: number;
  private replyCursors=new Map<string,number>();
  private replyPageTimer?: ReturnType<typeof setTimeout>;
  private controllers = new Map<AbortController, {record:RecordEntry;sessionId:string}>();
  private closed = false;
  private readonly now: () => number;
  constructor(private options: WebPushOptions) {
    this.now = options.now ?? Date.now;
    this.receipts = new PushAttentionStore(options.paths.webDir, this.now);
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
    this.syncReceipts();
    this.evaluationTimer=setTimeout(()=>{this.evaluationTimer=undefined;this.evaluate();for(const id of this.evaluating)this.evaluate(id);this.evaluating.clear();},20);
  }
  private deviceKey(r: RecordEntry) { return this.deliveryKey(r.deviceId, r.origin); }
  private syncReceipts() {
    this.receipts.sync((this.store?.subscriptions ?? []).map(r => this.deviceKey(r)));
    for(const record of this.store?.subscriptions ?? []) {
      record.epoch=this.receipts.epoch(this.deviceKey(record)); record.generation ??= 0;
    }
  }
  private eligible(r: RecordEntry, a: AttentionItem) {
    const age = ['result','finished'].includes(a.kind) ? 30*60_000 : 24*60*60_000;
    return this.now()-a.ts <= age && this.receipts.eligible(this.deviceKey(r),a);
  }
  private enqueue(item: AttentionItem, record: RecordEntry) {
    const key=JSON.stringify([this.deviceKey(record),record.epoch,item.sessionId,item.key,item.revision]);
    if(!this.eligible(record,item) || this.queue.has(key) || this.inflight.has(key))return;
    if(this.queue.size>=256){this.record(record,'queueFull','queue-full');return;}
    const kind=item.kind==='decision'?'question':item.kind==='result'?'finished':item.kind;
    const attention: PushAttention={sessionId:item.sessionId,seq:item.seq,kind,attention:item.kind,
      ...(item.summary?{summary:item.summary}:{}),...(item.replyId?{replyId:item.replyId}:{}),...(item.othersActive?{othersActive:true}:{}),
      ...(item.kind==='decision'?{tagId:createHash('sha256').update(item.key).digest('base64url').slice(0,16)}:{})};
    this.record(record,'eligible');
    this.queue.set(key,{attention,item,record,expires:this.now()+(['result','finished'].includes(item.kind)?120_000:600_000),acknowledgeBy:this.now()+2000});
  }
  evaluate(sessionId?: string) {
    if(this.closed || !this.options.attentionItems)return;
    if(!this.receipts.maintain()){this.waitForStorage();return;}
    this.scheduleMaintenance();
    let more=false;
    for(const id of sessionId?[sessionId]:(this.options.attentionSessions?.()??[])){
      for(const item of this.options.attentionItems(id))
        for(const record of this.store?.subscriptions??[])this.enqueue(item,record);
      if(this.options.replyAttentionPage){
        const page=this.options.replyAttentionPage(id,this.replyCursors.get(id));
        for(const item of page.items)for(const record of this.store?.subscriptions??[])this.enqueue(item,record);
        // Do not advance past queue overflow. Existing network completions refill it.
        if(this.queue.size<256){if(page.nextCursor){this.replyCursors.set(id,page.nextCursor);more=true;}else this.replyCursors.delete(id);}
      }
    }
    if(more&&!this.replyPageTimer&&this.queue.size<256){this.replyPageTimer=setTimeout(()=>{this.replyPageTimer=undefined;this.evaluate();},20);this.replyPageTimer.unref();}
    if(!this.receipts.healthy)this.waitForStorage();
    this.schedule(true);
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
  private deliveryKey(deviceId: string, origin: string) {
    return JSON.stringify([deviceId, origin]);
  }
  private deliveryStatus(deviceId: string, origin: string): PushDeliveryStatus {
    return (
      this.delivery.get(this.deliveryKey(deviceId, origin)) ?? {
        eligible: 0,
        sent: 0,
        suppressed: 0,
        deferred: 0,
        stale: 0,
        failed: 0,
        expired: 0,
        queueFull: 0,
        retried: 0,
      }
    );
  }
  private record(
    record: RecordEntry,
    counter: keyof Pick<
      PushDeliveryStatus,
      | 'eligible'
      | 'sent'
      | 'suppressed'
      | 'deferred'
      | 'stale'
      | 'failed'
      | 'expired'
      | 'queueFull'
      | 'retried'
    >,
    outcome?: PushDeliveryStatus['lastOutcome'],
    status?: number,
  ) {
    const key = this.deliveryKey(record.deviceId, record.origin),
      previous = this.deliveryStatus(record.deviceId, record.origin);
    const next = {
      ...previous,
      [counter]: Math.min(Number.MAX_SAFE_INTEGER, previous[counter] + 1),
    };
    if (outcome) {
      next.lastOutcome = outcome;
      next.lastStatus = status;
      next.updatedAt = new Date(this.now()).toISOString();
    }
    this.delivery.delete(key);
    this.delivery.set(key, next);
    if (this.delivery.size > 256)
      this.delivery.delete(this.delivery.keys().next().value!);
  }
  status(deviceId: string, origin: string) {
    return {
      enabled: !!this.store?.subscriptions.some(
        (r) => r.deviceId === deviceId && r.origin === origin,
      ),
      publicKey: this.identity().keys.publicKey,
      delivery: { ...this.deliveryStatus(deviceId, origin), persistenceFailures: this.receipts.writeFailures + this.receipts.readFailures, persistenceHealthy: this.receipts.healthy },
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
    const current=store.subscriptions.find(r=>r.deviceId===deviceId && r.origin===origin);
    if(current) {
      // A destination changes; the authorized logical occurrence remains the same.
      current.subscription=subscription;
      current.generation=(current.generation??0)+1;
    } else store.subscriptions.push({deviceId,origin,subscription,generation:0});
    this.save();
    this.syncReceipts();
    this.evaluate();
  }
  unsubscribe(deviceId: string, origin?: string) {
    if (!this.store) return;
    this.store.subscriptions = this.store.subscriptions.filter(
      (r) =>
        r.deviceId !== deviceId ||
        (origin !== undefined && r.origin !== origin),
    );
    for (const [key, d] of this.queue)
      if (
        d.record.deviceId === deviceId &&
        (origin === undefined || d.record.origin === origin)
      )
        this.queue.delete(key);
    for (const [controller, {record}] of this.controllers)
      if (
        record.deviceId === deviceId &&
        (origin === undefined || record.origin === origin)
      )
        controller.abort();
    // Stop all authorized effects before fallible persistence/receipt cleanup.
    this.save();
    this.syncReceipts();
  }
  revoke(deviceId: string) {
    try { this.unsubscribe(deviceId); }
    finally { for (const [key, p] of this.presenceTabs)
      if (p.deviceId === deviceId) this.presenceTabs.delete(key); }
  }
  retireSession(sessionId:string) {
    this.evaluating.delete(sessionId);this.replyCursors.delete(sessionId);
    for(const [key,job] of this.queue)if(job.attention.sessionId===sessionId)this.queue.delete(key);
    for(const [controller,delivery] of this.controllers)if(delivery.sessionId===sessionId)controller.abort('session-removed');
  }
  presence(
    deviceId: string,
    origin: string,
    tabId: string,
    sessionId: string | null,
    revision?: number,
    seenSeq?: number,
  ) {
    if (!validId(tabId) || (sessionId !== null && !validId(sessionId)))
      throw new Error('push-presence-invalid');
    if (
      seenSeq !== undefined &&
      (!Number.isSafeInteger(seenSeq) || seenSeq < 0)
    )
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
      seenSeq,
    });
    if(sessionId && seenSeq!==undefined)this.receipts.viewed(this.deliveryKey(deviceId,origin),sessionId,seenSeq);
    this.evaluate(sessionId??undefined);
    this.schedule(true);
  }
  private prunePresence() {
    for (const [key, p] of this.presenceTabs)
      if (p.until <= this.now()) this.presenceTabs.delete(key);
  }
  private viewing(
    r: RecordEntry,
    attention: PushAttention,
  ): 'viewed' | 'pending' | undefined {
    this.prunePresence();
    const tabs = [...this.presenceTabs.values()].filter(
      (p) =>
        p.deviceId === r.deviceId &&
        p.origin === r.origin &&
        p.sessionId === attention.sessionId,
    );
    if(attention.replyId)return this.options.isReplyDisplayed?.(r.deviceId,attention.sessionId,attention.replyId)?'viewed':tabs.length?'pending':undefined;
    return tabs.some(
      (p) => p.seenSeq !== undefined && p.seenSeq >= attention.seq,
    )
      ? 'viewed'
      : tabs.length
        ? 'pending'
        : undefined;
  }
  accept(event: SessionEvent) {
    if (this.closed || !this.store?.subscriptions.length) return;
    if(this.options.attentionItems){
      this.evaluating.add(event.sessionId);
      if(!this.evaluationTimer)this.evaluationTimer=setTimeout(()=>{this.evaluationTimer=undefined;const ids=[...this.evaluating];this.evaluating.clear();for(const id of ids)this.evaluate(id);},20);
      return;
    }
    const attention = pushAttention(event);
    if (!attention) return;
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
      this.record(record, 'eligible');
      if (this.queue.size >= 256 && !this.queue.has(key)) {
        this.record(record, 'queueFull', 'queue-full');
        continue;
      }
      if(this.inflight.has(key) || (this.queue.get(key)?.attention.seq ?? 0)>=attention.seq)continue;
      this.queue.set(key, {
        attention,
        record,
        expires: this.now() + 30_000,
        acknowledgeBy: this.now() + 2000,
      });
    }
    this.schedule(true);
  }
  private schedule(wake = false) {
    if (
      this.closed ||
      !this.queue.size ||
      this.controllers.size >= 4
    )
      return;
    const now = this.now();
    const due = wake
      ? now + 20
      : Math.max(now + 20, Math.min(
          ...[...this.queue.values()].map(
            (job) => job.retryAt ?? now + 20,
          ),
        ));
    if (this.timer) {
      // A wake may advance a pending pump, but must never postpone it.
      if (this.timerDue! <= due && this.timerDue! > now) return;
      clearTimeout(this.timer);
    }
    this.timerDue = due;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        this.timerDue = undefined;
        this.pump();
      },
      due - now,
    );
  }
  private pump() {
    for (const [key, job] of [...this.queue]) {
      if (this.closed || this.controllers.size >= 4) break;
      this.queue.delete(key);
      const { attention: a, record: r } = job;
      if (!this.store?.subscriptions.includes(r)) continue;
      if (!this.options.isDeviceActive(r.deviceId)) {
        this.record(r, 'expired', 'expired');
        this.removeRecord(r);
        continue;
      }
      const current = job.item?.replyId&&this.options.replyAttentionItem ? this.options.replyAttentionItem(a.sessionId,job.item.replyId) : job.item ? this.options.attentionItems?.(a.sessionId).find(i=>i.key===job.item!.key&&i.revision===job.item!.revision) : undefined;
      if (job.item ? !current : !this.options.isCurrent(a)) {
        this.record(r, 'stale', 'stale');
        continue;
      }
      const viewing = this.viewing(r, a);
      if (viewing === 'viewed') {
        this.record(r, 'suppressed', 'viewed');
        if(job.item)this.receipts.record(this.deviceKey(r),job.item,'suppressed');
        continue;
      }
      if(job.item && !this.eligible(r,current!)){
        if(!this.receipts.healthy){job.retryAt=this.now()+5000;this.queue.set(key,job);this.waitForStorage();}
        else {const reason=this.now()>=attentionExpires(current!)?'expired':'stale';this.record(r,reason,reason);}
        continue;
      }
      if (job.retryAt && job.retryAt > this.now()) { this.queue.set(key,job); continue; }
      if (viewing === 'pending' && this.now() < job.acknowledgeBy) {
        if (!job.deferred) this.record(r, 'deferred', 'waiting-for-view');
        job.deferred = true;
        job.retryAt = job.acknowledgeBy;
        this.queue.set(key, job);
        continue;
      }
      if (
        r.subscription.expirationTime &&
        r.subscription.expirationTime <= this.now()
      ) {
        this.record(r, 'expired', 'expired');
        this.removeRecord(r);
        continue;
      }
      if (job.expires < this.now()) {
        this.record(r,'expired','expired');
        if(job.item){this.receipts.record(this.deviceKey(r),job.item,'failed');}
        continue;
      }
      if(current){a.summary=current.summary;a.othersActive=current.othersActive;}
      const sentSubscription=r.subscription, sentGeneration=r.generation;
      const authorizedEpoch=r.epoch;
      const stillAuthorized=()=>!this.closed && controller.signal.reason!=='session-removed' && this.store?.subscriptions.includes(r) && r.epoch===authorizedEpoch && this.options.isDeviceActive(r.deviceId);
      this.inflight.add(key);
      const controller = new AbortController();
      this.controllers.set(controller, {record:r,sessionId:a.sessionId});
      const deadline = setTimeout(() => controller.abort(), 5000);
      // Execution leaves the event-log callback before any crypto, disk or network work.
      void (async () => {
        let attempted = false;
        try {
          const topic = createHash('sha256')
            .update(JSON.stringify(job.item?[a.sessionId,job.item.key,job.item.revision]:[a.sessionId,a.kind,a.seq]))
            .digest('base64url')
            .slice(0, 32);
          const details = webPush.generateRequestDetails(
            sentSubscription,
            JSON.stringify(a),
            {
              vapidDetails: {
                ...this.store!.keys,
                subject: 'https://github.com/kevin15011/deck',
              },
              TTL: job.item ? (['result','finished'].includes(job.item.kind)?120:600) : 60,
              urgency: 'normal',
              topic,
            },
          );
          attempted = true;
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
          if (!stillAuthorized())return;
          if (status >= 200 && status < 300) {
            this.record(r, 'sent', 'accepted', status);
            if(job.item)this.receipts.record(this.deviceKey(r),job.item,'sent');
          } else if(r.generation!==sentGeneration) this.retry(key,job,status);
          else if(status===404 || status===410) {this.record(r,'failed','rejected',status);this.removeRecord(r);}
          else if(job.item && (status===429||status>=500))this.retry(key,job,status);
          else { this.record(r,'failed','rejected',status>=100&&status<=599?status:undefined);if(job.item)this.receipts.record(this.deviceKey(r),job.item,'failed'); }
        } catch {
          if (stillAuthorized()) {
            if(job.item && attempted)this.retry(key,job);
            else {this.record(r,'failed',attempted?'transport-error':'payload-error');if(job.item)this.receipts.record(this.deviceKey(r),job.item,'failed');}
          }
          /* Delivery is best effort. Never log endpoints, keys or provider response bodies. */
        } finally {
          clearTimeout(deadline);
          this.controllers.delete(controller);
          this.inflight.delete(key);
          // Also refill queue overflow from authoritative current attention. No unseen
          // occurrence is covered by a different receipt or a session high-water mark.
          if(!this.closed)this.evaluate();
          this.schedule();
        }
      })();
    }
    this.schedule();
  }
  private scheduleMaintenance() {
    if(this.closed || this.maintenanceTimer)return;
    this.maintenanceTimer=setTimeout(()=>{
      this.maintenanceTimer=undefined;
      if(!this.receipts.maintain())this.waitForStorage();else this.scheduleMaintenance();
    },Math.max(1000,this.receipts.nextMaintenance-this.now()));
  }
  private waitForStorage() {
    for(const r of this.store?.subscriptions??[])if(this.deliveryStatus(r.deviceId,r.origin).lastOutcome!=='waiting-for-storage')this.record(r,'deferred','waiting-for-storage');
    if(this.closed || this.storageTimer)return;
    this.storageTimer=setTimeout(()=>{this.storageTimer=undefined;this.evaluate();},5000);
  }
  private retry(key:string,job:Delivery,status?:number) {
    job.attempts=(job.attempts??0)+1;
    if(job.attempts<3 && this.now()<job.expires){job.retryAt=this.now()+(job.attempts===1?5000:30000);this.queue.set(key,job);this.record(job.record,'retried');}
    else { this.record(job.record,'failed',status?'rejected':'transport-error',status);if(job.item)this.receipts.record(this.deviceKey(job.record),job.item,'failed'); }
  }
  private removeRecord(record: RecordEntry) {
    if (!this.store?.subscriptions.includes(record)) return;
    this.store.subscriptions = this.store.subscriptions.filter(
      (r) => r !== record,
    );
    this.save();
    this.syncReceipts();
  }
  close() {
    clearTimeout(this.replyPageTimer);this.replyCursors.clear();
    this.closed = true;
    if(this.evaluationTimer)clearTimeout(this.evaluationTimer);
    if(this.storageTimer)clearTimeout(this.storageTimer);
    if(this.maintenanceTimer)clearTimeout(this.maintenanceTimer);
    this.evaluating.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDue = undefined;
    this.queue.clear();
    this.presenceTabs.clear();
    for (const c of this.controllers.keys()) c.abort();
    this.receipts.close();
  }
}
