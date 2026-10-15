/** Loopback-only browser transport. Unix socket remains the sole administrative surface. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { IMAGE_ATTACHMENT_LIMITS, validateSessionCommand } from "@deck/core/session/commands";
import type { SessionEvent } from "@deck/core/session/events";
import { assertPrivateFile, writePrivateFile, type StatePaths } from "./paths";
import type { SessionService } from "./service";
import type { CommandOutcome } from "./protocol";
export type WebConfig = {
  port: number;
  trustedProxy: string | null;
  allowedOrigins: readonly string[];
  allowFunnel: boolean;
  hostname?: string;
};
export type WebAsset = {
  body: string | Uint8Array;
  contentType: string;
};
export type WebAssets = Readonly<Record<string, WebAsset>>;
type Device = {
  id: string;
  name: string;
  createdAt: string;
  hash: string;
  revokedAt?: string;
};
type SocketData = {
  deviceId: string;
  sessionId: string;
  after: number;
  unsubscribe?: () => void;
};
export type WebServiceOptions = {
  paths: StatePaths;
  service: SessionService;
  config: WebConfig;
  assets?: WebAssets;
  now?: () => number;
  maxReplayEvents?: number;
  maxQueuedBytes?: number;
};
const COOKIE = "deck_device";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const HEADERS = { "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" };
const safeId = (v: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v) && !v.includes("..");
export class WebService {
  private server?: Server<SocketData>;
  private records: Device[] = [];
  private sockets = new Set<ServerWebSocket<SocketData>>();
  private challenge?: {
    codeHash: string;
    tokenHash: string;
    expiresAt: number;
    attempts: number;
  };
  private readonly now: () => number;
  private error?: string;
  private uploadsInFlight = 0;
  constructor(private readonly options: WebServiceOptions) {
    this.now = options.now ?? Date.now;
    if (options.config.hostname !== undefined && options.config.hostname !== "127.0.0.1")
      throw new Error("Web listener must bind 127.0.0.1");
    for (const origin of options.config.allowedOrigins) {
      const u = new URL(origin);
      if (u.origin !== origin || u.username || u.password || !['http:', 'https:'].includes(u.protocol))
        throw new Error("Invalid web allowed origin");
    }
    if (existsSync(options.paths.devicesFile)) {
      assertPrivateFile(options.paths.devicesFile);
      const value = JSON.parse(readFileSync(options.paths.devicesFile, "utf8"));
      if (!Array.isArray(value) || !value.every(d => d && typeof d.id === 'string' && typeof d.name === 'string' && typeof d.createdAt === 'string' && /^[a-f0-9]{64}$/.test(d.hash)))
        throw new Error("Invalid web device store");
      this.records = value;
    }
  }
  get clientCount() { return this.sockets.size; }
  private get stateFile() { return join(this.options.paths.webDir, "listener.json"); }
  start() { if (existsSync(this.stateFile)) {
    assertPrivateFile(this.stateFile);
    if (JSON.parse(readFileSync(this.stateFile, "utf8")).enabled === false)
      return;
  } this.enable(false); }
  enable(persist = true) {
    if (!this.server) {
      try {
        this.server = Bun.serve<SocketData>({ hostname: "127.0.0.1", port: this.options.config.port, maxRequestBodySize: IMAGE_ATTACHMENT_LIMITS.maxFileBytes + 1024 * 1024, fetch: (r, s) => this.fetch(r, s), websocket: { maxPayloadLength: 1024, backpressureLimit: this.options.maxQueuedBytes ?? 1024 * 1024, closeOnBackpressureLimit: false, open: ws => this.open(ws), message: ws => ws.close(1008, "Read-only stream"), close: ws => { ws.data.unsubscribe?.(); this.sockets.delete(ws); } } });
        this.error = undefined;
      }
      catch {
        this.error = "web-listen-failed";
        throw new Error(this.error);
      }
    }
    if (persist)
      writePrivateFile(this.stateFile, JSON.stringify({ enabled: true }));
    return this.status();
  }
  async disable(persist = true) { await this.close(); this.challenge = undefined; if (persist)
    writePrivateFile(this.stateFile, JSON.stringify({ enabled: false })); return this.status(); }
  async close() {
    for (const ws of this.sockets) {
      ws.data.unsubscribe?.();
      ws.close(1001, "Listener closed");
      ws.terminate();
    }
    this.sockets.clear();
    const server = this.server;
    this.server = undefined; // Bun stops accepting connections synchronously. Its returned promise can remain pending after a WebSocket close handshake.
    server?.stop(true).catch(() => { });
  }
  status() { return { enabled: !!this.server, hostname: "127.0.0.1", port: this.server?.port ?? this.options.config.port, url: this.server ? `http://127.0.0.1:${this.server.port}` : undefined, clients: this.clientCount, error: this.error, exposure: { trustedProxy: this.options.config.trustedProxy, allowedOrigins: this.options.config.allowedOrigins, allowFunnel: this.options.config.allowFunnel } }; }
  pair() { if (!this.server)
    throw new Error("Web listener disabled"); const code = String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, "0"), token = randomBytes(32).toString("base64url"); this.challenge = { codeHash: hash(code), tokenHash: hash(token), expiresAt: this.now() + 300000, attempts: 0 }; return { code, url: `${this.status().url}/#pair=${token}`, expiresAt: new Date(this.challenge.expiresAt).toISOString() }; }
  devices() { return this.records.map(({ hash, ...d }) => d); }
  revoke(id: string) { const d = this.records.find(d => d.id === id); if (!d)
    return false; d.revokedAt = new Date(this.now()).toISOString(); this.save(); for (const ws of this.sockets)
    if (ws.data.deviceId === id) {
      ws.data.unsubscribe?.();
      ws.close(1008, "Device revoked");
    } return true; }
  private save() { writePrivateFile(this.options.paths.devicesFile, JSON.stringify(this.records)); }
  async query(name: string, args: unknown): Promise<CommandOutcome> { try {
    switch (name) {
      case "web.status": return { ok: true, data: this.status() };
      case "web.enable": return { ok: true, data: this.enable() };
      case "web.disable": return { ok: true, data: await this.disable() };
      case "web.pair": return { ok: true, data: this.pair() };
      case "web.devices": return { ok: true, data: { devices: this.devices() } };
      case "web.revoke": return typeof (args as any)?.deviceId === 'string' && this.revoke((args as any).deviceId) ? { ok: true } : { ok: false, code: "device-unknown" };
      default: return { ok: false, code: "query-unknown" };
    }
  }
  catch {
    return { ok: false, code: "web-unavailable" };
  } }
  private response(data: unknown, status = 200, extra: Record<string, string> = {}) { return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, "Content-Type": "application/json", ...extra } }); }
  private issueDevice(r: Request, body: Record<string, unknown>) {
    const token = randomBytes(32).toString('base64url');
    const d: Device = { id: randomUUID(), name: typeof body.name === 'string' ? body.name.slice(0, 80) : 'Browser', createdAt: new Date(this.now()).toISOString(), hash: hash(token) };
    this.records.push(d);
    this.save();
    const secure = r.headers.get('origin')?.startsWith('https://') ? '; Secure' : '';
    return this.response({ ok: true, device: this.devices().find(x => x.id === d.id) }, 200, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}` });
  }
  private device(r: Request) { const cookies = r.headers.get("cookie") ?? ""; const token = cookies.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1); if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
    return; const h = hash(token); return this.records.find(d => !d.revokedAt && equal(d.hash, h)); }
  private boundary(r: Request, s: Server<SocketData>) { const config = this.options.config, host = r.headers.get('host'), origin = r.headers.get('origin'); const origins = [`http://127.0.0.1:${s.port}`, `http://localhost:${s.port}`, ...config.allowedOrigins]; if (!origins.some(o => new URL(o).host === host))
    return false; const forwarded = [...r.headers.keys()].some(h => h === 'forwarded' || h.startsWith('x-forwarded-')); const funnel = [...r.headers.keys()].some(h => h.includes('funnel')); if (forwarded || funnel) {
    const ip = s.requestIP(r)?.address;
    if (!config.trustedProxy || ip !== config.trustedProxy || !config.allowedOrigins.some(o => new URL(o).host === host) || (origin !== null && !config.allowedOrigins.includes(origin)) || (funnel && !config.allowFunnel))
      return false;
  } if (r.method !== "GET" || r.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    if (!origin || !origins.includes(origin) || new URL(origin).host !== host)
      return false;
  } return true; }
  private async boundedBody(r: Request, max: number): Promise<Uint8Array> {
    const length = r.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) throw new Error("body-too-large");
    const reader = r.body?.getReader(); if (!reader) return new Uint8Array();
    const body = new Uint8Array(length === null ? max : Number(length)); let size=0, aborted=false;
    const abort=()=>{aborted=true;void reader.cancel().catch(()=>{});};
    r.signal.addEventListener("abort",abort,{once:true});
    const timeout=setTimeout(abort,30_000);
    if(r.signal.aborted) abort();
    try { for (;;) { const result=await reader.read(); if(aborted) throw new Error("upload-aborted"); if(result.done) break; size+=result.value.length; if(size>max) { void reader.cancel().catch(()=>{}); throw new Error("body-too-large"); } body.set(result.value,size-result.value.length); } }
    finally { clearTimeout(timeout);r.signal.removeEventListener("abort",abort);reader.releaseLock(); }
    return body.subarray(0,size);
  }
  private async json(r: Request) {
    if (!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type') ?? '')) throw new Error('json');
    const text=await r.text(); if(Buffer.byteLength(text)>1024*1024) throw new Error("body-too-large");
    return JSON.parse(text) as Record<string,unknown>;
  }
  private async fetch(r: Request, s: Server<SocketData>): Promise<Response | undefined> {
    if (!this.boundary(r, s))
      return this.response({ ok: false, code: 'request-forbidden' }, 403);
    const url = new URL(r.url), path = url.pathname;
    try {
      if (path === '/api/local-access' && r.method === 'POST') {
        const host = r.headers.get('host'), origin = r.headers.get('origin');
        const localOrigins = [`http://127.0.0.1:${s.port}`, `http://localhost:${s.port}`];
        const peer = s.requestIP(r)?.address;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '') || !origin || !localOrigins.includes(origin) || new URL(origin).host !== host || [...r.headers.keys()].some(h => h === 'forwarded' || h.startsWith('x-forwarded-') || h.includes('funnel')))
          return this.response({ ok: false, code: 'request-forbidden' }, 403);
        const body = await this.json(r);
        const existing = this.device(r);
        if (existing) return this.response({ ok: true, device: this.devices().find(d => d.id === existing.id) });
        // A revoked or invalid credential must not silently obtain a replacement.
        if ((r.headers.get('cookie') ?? '').split(';').some(c => c.trim().startsWith(`${COOKIE}=`)))
          return this.response({ ok: false, code: 'device-revoked' }, 403);
        return this.issueDevice(r, body);
      }
      if (path === '/pair' && r.method === 'POST') {
        const body = await this.json(r), c = this.challenge;
        const value = typeof body.code === 'string' ? body.code : typeof body.token === 'string' ? body.token : '';
        if (!c || c.expiresAt <= this.now() || c.attempts >= 5)
          return this.response({ ok: false, code: 'pairing-invalid' }, 401);
        c.attempts++;
        if (!value || !(typeof body.code === 'string' ? equal(c.codeHash, hash(value)) : equal(c.tokenHash, hash(value))))
          return this.response({ ok: false, code: 'pairing-invalid' }, 401);
        this.challenge = undefined;
        return this.issueDevice(r, body);
      }
      if (path.startsWith('/api/')) {
        const device = this.device(r);
        if (!device)
          return this.response({ ok: false, code: 'device-required' }, 401);
        const attachments = /^\/api\/sessions\/([^/]+)\/attachments(?:\/([^/]+))?$/.exec(path);
        if (attachments && (r.method === 'POST' || r.method === 'GET')) {
          const sessionId=attachments[1]!, attachmentId=attachments[2];
          if(!safeId(sessionId) || attachmentId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attachmentId)) return this.response({ok:false,code:'attachment-invalid'},400);
          if(r.method === 'POST' && !attachmentId) {
            const mimeType=r.headers.get('content-type') ?? '';
            if(!['image/png','image/jpeg','image/webp'].includes(mimeType) || url.searchParams.getAll('name').length>1) return this.response({ok:false,code:'attachment-invalid'},400);
            if(this.uploadsInFlight>=8) return this.response({ok:false,code:'attachment-upload-busy'},429);
            this.uploadsInFlight++;
            try {
            let bytes:Uint8Array; try { bytes=await this.boundedBody(r,IMAGE_ATTACHMENT_LIMITS.maxFileBytes); } catch(error) { return (error as Error).message==='upload-aborted' ? this.response({ok:false,code:'attachment-upload-aborted'},408) : this.response({ok:false,code:'attachment-too-large'},413); }
            const outcome=this.options.service.uploadAttachment?.({sessionId,bytes,mimeType,name:url.searchParams.get('name')??''}) ?? {ok:false as const,code:'attachment-unavailable'};
            return this.response(outcome,outcome.ok?200:outcome.code==='attachment-too-large'||outcome.code==='attachment-staging-full'?413:outcome.code==='unknown-session'?404:400);
            } finally { this.uploadsInFlight--; }
          }
          if(r.method === 'GET' && attachmentId) {
            const image=this.options.service.readAttachment?.(sessionId,attachmentId);
            return image ? new Response(image.bytes as BodyInit,{headers:{...HEADERS,'Content-Type':image.attachment.mimeType,'Content-Disposition':'inline','Content-Length':String(image.bytes.length)}}) : this.response({ok:false,code:'attachment-unknown'},404);
          }
          return this.response({ok:false,code:'attachment-invalid'},400);
        }
        if (path === '/api/sessions/status' && r.method === 'GET') {
          const sessionIds = url.searchParams.getAll('sessionId');
          if (url.searchParams.getAll('projectId').length !== 1 || sessionIds.length < 1 || sessionIds.length > 100 || sessionIds.some(id => !safeId(id))) return this.response({ ok: false, code: 'sessions-status-invalid' }, 400);
          const outcome = await this.options.service.query?.('sessions.status', { projectId: url.searchParams.get('projectId'), sessionIds }) ?? { ok: false as const, code: 'query-unavailable' };
          return this.response(outcome, outcome.ok ? 200 : 400);
        }
        if (r.method === 'GET' && ['/api/sessions', '/api/projects', '/api/directories', '/api/models'].includes(path)) {
          const names: Record<string, string> = { '/api/sessions': 'sessions.list', '/api/projects': 'projects.list', '/api/directories': 'directories.list', '/api/models': 'runners.models' };
          const keys = path === '/api/sessions' ? ['projectId', 'cursor', 'limit'] : path === '/api/directories' ? ['path', 'prefix', 'limit'] : path === '/api/models' ? ['projectId'] : [];
          const args: Record<string, unknown> = {};
          for (const key of keys) {
            const values = url.searchParams.getAll(key);
            if (values.length > 1) return this.response({ ok: false, code: 'query-invalid' }, 400);
            if (values.length) args[key] = key === 'limit' ? /^\d+$/.test(values[0]!) ? Number(values[0]) : NaN : values[0];
          }
          const outcome = await this.options.service.query?.(names[path]!, args) ?? { ok: false as const, code: 'query-unavailable' };
          return this.response(outcome, outcome.ok ? 200 : 400);
        }
        const prompts = /^\/api\/sessions\/([^/]+)\/prompts$/.exec(path);
        if (prompts && r.method === 'GET') {
          if (!safeId(prompts[1]!)) return this.response({ ok: false, code: 'session-invalid' }, 400);
          const outcome = await this.options.service.query?.('prompts.list', { sessionId: prompts[1] }) ?? { ok: false as const, code: 'query-unavailable' };
          return this.response(outcome, outcome.ok ? 200 : 404);
        }
        const readiness = /^\/api\/sessions\/([^/]+)\/readiness$/.exec(path);
        if (readiness && r.method === 'GET') {
          if (!safeId(readiness[1]!)) return this.response({ ok: false, code: 'session-invalid' }, 400);
          const outcome = await this.options.service.query?.('session.readiness', { sessionId: readiness[1] }) ?? { ok: false as const, code: 'query-unavailable' };
          return this.response(outcome, outcome.ok ? 200 : 404);
        }
        const artifacts = /^\/api\/sessions\/([^/]+)\/openspec(\/artifact)?$/.exec(path);
        if (artifacts && r.method === 'GET') {
          const sessionId = artifacts[1]!;
          if (!safeId(sessionId)) return this.response({ ok: false, code: 'openspec-invalid' }, 400);
          const read = !!artifacts[2];
          if (read && (url.searchParams.getAll('changeId').length !== 1 || url.searchParams.getAll('path').length !== 1))
            return this.response({ ok: false, code: 'openspec-invalid' }, 400);
          const args = read ? { sessionId, changeId: url.searchParams.get('changeId'), path: url.searchParams.get('path') } : { sessionId };
          const outcome = await this.options.service.query?.(read ? 'openspec.read' : 'openspec.list', args) ?? { ok: false as const, code: 'openspec-unavailable' };
          const status = outcome.ok ? 200 : outcome.code === 'session-unknown' || outcome.code === 'openspec-not-found' ? 404
            : outcome.code === 'openspec-forbidden' ? 403 : outcome.code === 'openspec-too-large' || outcome.code === 'openspec-limit' ? 413
            : outcome.code === 'openspec-unavailable' ? 503 : 400;
          return this.response(outcome, status);
        }
        if (path === '/api/commands' && r.method === 'POST') {
          const body = await this.json(r), validated = validateSessionCommand(body.command);
          if (!validated.ok || body.sessionId !== undefined && (typeof body.sessionId !== 'string' || !safeId(body.sessionId)))
            return this.response({ ok: false, code: 'command-invalid' }, 400);
          if (validated.value.type === 'session.attach')
            return this.response({ ok: false, code: 'command-use-events' }, 400);
          return this.response(await this.options.service.execute({ sessionId: body.sessionId as string | undefined, command: validated.value, clientId: `web:${device.id}` }));
        }
        const match = /^\/api\/sessions\/([^/]+)\/events$/.exec(path);
        if (match && r.method === 'GET') {
          const id = match[1]!, raw = url.searchParams.get('after') ?? '0', after = Number(raw);
          if (!safeId(id) || !/^\d+$/.test(raw) || !Number.isSafeInteger(after))
            return this.response({ ok: false, code: 'cursor-invalid' }, 400);
          const log = this.options.service.openLog(id);
          if (!log)
            return this.response({ ok: false, code: 'session-unknown' }, 404);
          if (r.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            if (s.upgrade(r, { data: { deviceId: device.id, sessionId: id, after }, headers: HEADERS }))
              return;
            return this.response({ ok: false, code: 'upgrade-failed' }, 400);
          }
          const events: SessionEvent[] = [];
          for (const e of log.readAfter(after)) {
            if (events.length >= (this.options.maxReplayEvents ?? 1000))
              break;
            events.push(e);
          }
          const seq = events.at(-1)?.seq ?? Math.min(after, log.lastSeq);
          return this.response({ events, seq, hasMore: seq < log.lastSeq });
        }
        return this.response({ ok: false, code: 'route-unknown' }, 404);
      }
      if (r.method !== 'GET')
        return this.response({ ok: false, code: 'route-unknown' }, 404);
      const asset = this.options.assets?.[path === '/' ? '/index.html' : path] ?? (path === '/' ? this.options.assets?.['/'] : undefined);
      if (!asset)
        return this.response({ ok: false, code: 'route-unknown' }, 404);
      return new Response(asset.body as BodyInit, { headers: { ...HEADERS, 'Content-Type': asset.contentType } });
    }
    catch {
      return this.response({ ok: false, code: 'request-invalid' }, 400);
    }
  }
  private open(ws: ServerWebSocket<SocketData>) {
    if (!this.records.some(d => d.id === ws.data.deviceId && !d.revokedAt)) {
      ws.close(1008, 'Device revoked');
      return;
    }
    this.sockets.add(ws);
    const log = this.options.service.openLog(ws.data.sessionId);
    if (!log) {
      ws.close(1008, 'Unknown session');
      return;
    }
    const send = (e: SessionEvent) => { if (e.seq <= ws.data.after)
      return; const value = JSON.stringify({ type: 'event', event: e }); if (ws.getBufferedAmount() + Buffer.byteLength(value) > (this.options.maxQueuedBytes ?? 1024 * 1024) || ws.send(value) === -1) {
      ws.send(JSON.stringify({ type: 'resync' }));
      ws.close(1013, 'Resync required');
      ws.data.unsubscribe?.();
      return false;
    } ws.data.after = e.seq; return true; };
    ws.data.unsubscribe = log.subscribe(send);
    let count = 0;
    for (const e of log.readAfter(ws.data.after)) {
      if (++count > (this.options.maxReplayEvents ?? 1000)) {
        ws.send(JSON.stringify({ type: 'resync' }));
        ws.close(1013, 'Replay limit');
        ws.data.unsubscribe();
        break;
      }
      if (send(e) === false)
        break;
    }
  }
}
