import {API, HttpError, request, workspace, type Receipt, type Workspace} from './api';

const collections = ['sessions', 'receipts', 'tasks'] as const;
type Raw = Record<string, unknown>;
type Snapshot = {raw: Raw; cursor: string};

function record(value: unknown): Raw {
 if (typeof value !== 'object' || value === null || Array.isArray(value)) throw Error('Invalid workspace update');
 return value as Raw;
}

function cursorParts(cursor: string) {
 const match = /^([a-f0-9]{32}):([0-9]+)$/.exec(cursor);
 const revision = Number(match?.[2]);
 if (!match || !Number.isSafeInteger(revision)) throw Error('Invalid workspace cursor');
 return {epoch: match[1], revision};
}

function strings(value: unknown): string[] {
 if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) throw Error('Invalid workspace identities');
 return value;
}

function applyDelta(snapshot: Snapshot, event: MessageEvent<string>): Snapshot {
 const previous = cursorParts(snapshot.cursor), cursor = cursorParts(event.lastEventId);
 if (cursor.epoch !== previous.epoch || cursor.revision !== previous.revision + 1) throw Error('Workspace revision gap');

 const delta = record(JSON.parse(event.data));
 const raw = {...snapshot.raw};
 const fields = record(delta.fields);
 const removed = strings(delta.removed);
 for (const key of [...Object.keys(fields), ...removed]) {
  if (key === '__proto__' || collections.some(collection => collection === key)) throw Error('Invalid workspace field update');
 }
 for (const key of removed) delete raw[key];
 Object.assign(raw, fields);

 for (const [key, patch] of Object.entries(record(delta.collections))) {
  if (!collections.some(collection => collection === key)) throw Error('Unknown workspace collection');
  const id = (item: unknown) => {
   const id = record(item).id;
   if (typeof id !== 'string') throw Error('Invalid workspace identity');
   return id;
  };
  const items = new Map((raw[key] as unknown[]).map(item => [id(item), item]));
  const {removed, changed, order} = record(patch);
  const removedIds = strings(removed);
  if (new Set(removedIds).size !== removedIds.length || removedIds.some(id => !items.has(id))) throw Error('Invalid workspace removal');
  if (!Array.isArray(changed)) throw Error('Invalid workspace changes');
  const changedIds = changed.map(id);
  if (new Set(changedIds).size !== changedIds.length || (order === undefined && (removedIds.length || changedIds.some(id => !items.has(id))))) throw Error('Invalid workspace changes');
  for (const key of removedIds) items.delete(key);
  for (const item of changed) items.set(id(item), item);
  if (order === undefined) raw[key] = [...items.values()];
  else {
   const ids = strings(order);
   if (ids.length !== items.size || new Set(ids).size !== ids.length || ids.some(id => !items.has(id))) throw Error('Invalid workspace order');
   raw[key] = ids.map(id => items.get(id));
  }
 }
 return {raw, cursor: event.lastEventId};
}

export function startWorkspaceFeed(callbacks: {
 denied(): boolean;
 accept(value: Workspace): void;
 resumed(): void;
 updating(value: boolean): void;
 stale(error: unknown, message: string): void;
}) {
 const controller = new AbortController();
 const stopped = () => controller.signal.aborted || callbacks.denied();
 let source: EventSource | undefined;
 let snapshot: Snapshot | undefined;
 let staged: Snapshot | undefined;
 let paint: number | undefined;
 const receiptCache = new WeakMap<object, Receipt>();
 let loading: Promise<Workspace> | undefined;
 let retry: ReturnType<typeof setTimeout> | undefined;
 let watchdog: ReturnType<typeof setTimeout> | undefined;
 let delay = 500;
 let needsBootstrap = true;
 let recovering = false;

 function disconnect() {
  source?.close();
  source = undefined;
  clearTimeout(watchdog);
  if (paint !== undefined) cancelAnimationFrame(paint);
  paint = undefined;
  staged = undefined;
 }

 function schedule() {
  clearTimeout(retry);
  if (stopped() || !navigator.onLine || document.hidden) return;
  retry = setTimeout(resume, delay);
  delay = Math.min(delay * 2, 8000);
 }

 function connect() {
  clearTimeout(retry);
  if (stopped() || !navigator.onLine || document.hidden || !snapshot) return;
  const stream = new EventSource('/api/workspace/events?after=' + encodeURIComponent(snapshot.cursor));
  source = stream;
  const current = () => stream === source && !stopped();
  function resync() {
   if (!current()) return;
   disconnect();
   needsBootstrap = true;
   void refresh().catch(() => {});
  }
  function lost(message: string) {
   if (!current()) return;
   disconnect();
   recovering = true;
   callbacks.stale(undefined, message);
   schedule();
  }
  function heard() {
   if (!current()) return;
   clearTimeout(watchdog);
   watchdog = setTimeout(() => lost('Workspace updates timed out. Deck is reconnecting.'), 25000);
  }
  stream.onopen = heard;
  stream.onerror = () => lost('Workspace connection lost. Deck is reconnecting.');
  stream.addEventListener('heartbeat', () => {
   if (!current()) return;
   delay = 500;
   heard();
   if (recovering && !staged) {
    recovering = false;
    callbacks.resumed();
   }
  });
  stream.addEventListener('resync', resync);
  stream.addEventListener('delta', (event: MessageEvent<string>) => {
   if (!current() || !snapshot) return;
   try {
    staged = applyDelta(staged ?? snapshot, event);
    delay = 500;
    heard();
    if (paint !== undefined) return;
    // Apply every revision in order, then reconcile the latest state once per paint.
    paint = requestAnimationFrame(() => {
     paint = undefined;
     const next = staged;
     staged = undefined;
     if (!current() || !next) return;
     try {
      callbacks.accept(workspace(next.raw, receiptCache));
      snapshot = next;
      recovering = false;
     } catch {
      resync();
     }
    });
   } catch {
    resync();
   }
  });
  heard();
 }

 async function reportFailure(error: unknown, received: boolean) {
  if (stopped()) return;
  if (received || error instanceof HttpError) {
   callbacks.stale(error, (error as Error).message);
   return;
  }
  callbacks.stale(undefined, 'Connection lost. Deck is checking host availability.');
  try {
   const health = await request('GET', '/api/health', undefined, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])) as {api:number};
   if (health?.api !== API) throw Error('Unexpected health response');
   if (!stopped()) callbacks.stale(undefined, 'Deck is reachable. Session data is stale while Deck retries the workspace update.');
  } catch (e) {
   if (!stopped()) callbacks.stale(e, e instanceof HttpError ? e.message : 'Connection check failed. Deck is retrying.');
  }
 }

 function refresh(): Promise<Workspace> {
  if (stopped()) return Promise.reject(Error('Workspace connection is closed'));
  if (loading) return loading;
  needsBootstrap = true;
  disconnect();
  clearTimeout(retry);
  const slow = setTimeout(() => { if (!stopped()) callbacks.updating(true); }, 5000);
  loading = (async () => {
   let received = false, cursor = '';
   try {
    const payload = await request('GET', '/api/workspace?transport=events', undefined,
     AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]), 'host',
     response => { cursor = response.headers.get('x-deck-workspace-cursor') ?? ''; });
    received = true;
    const value = workspace(payload, receiptCache);
    cursorParts(cursor);
    if (stopped() || !navigator.onLine) throw Error('Workspace connection is closed');
    callbacks.accept(value);
    snapshot = {raw: record(payload), cursor};
    needsBootstrap = false;
    recovering = false;
    delay = 500;
    connect();
    return value;
   } catch (e) {
    await reportFailure(e, received);
    schedule();
    throw e;
   } finally {
    clearTimeout(slow);
    loading = undefined;
    if (!stopped()) callbacks.updating(false);
   }
  })();
  return loading;
 }

 function resume() {
  if (stopped() || loading || source || !navigator.onLine || document.hidden) return;
  if (snapshot && !needsBootstrap) connect();
  else void refresh().catch(() => {});
 }
 function suspend() {
  disconnect();
  clearTimeout(retry);
 }
 function offline() {
  suspend();
  recovering = true;
  if (!stopped()) callbacks.stale(undefined, 'Connection lost. Reconnect to update session data.');
 }
 function visible() { if (document.hidden) suspend(); else resume(); }
 window.addEventListener('online', resume);
 window.addEventListener('offline', offline);
 window.addEventListener('pageshow', resume);
 window.addEventListener('pagehide', suspend);
 document.addEventListener('visibilitychange', visible);

 return {refresh, close() {
  controller.abort();
  disconnect();
  clearTimeout(retry);
  window.removeEventListener('online', resume);
  window.removeEventListener('offline', offline);
  window.removeEventListener('pageshow', resume);
  window.removeEventListener('pagehide', suspend);
  document.removeEventListener('visibilitychange', visible);
 }};
}
