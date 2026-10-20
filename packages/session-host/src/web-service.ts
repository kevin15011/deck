/** Loopback-only browser transport. Unix socket remains the sole administrative surface. */
import { WebPush, type WebPushOptions } from './web-push';
import { LeadReplies } from './lead-replies';
import { validReplyId } from '@deck/core/session/lead-replies';
import { ChatHistory } from './chat-history';
import type { EventLog } from './event-log';
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
  tailscaleServeAccess?: boolean;
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
  expiresAt?: string;
  tailscaleIdentity?: string;
};
type SocketData = {
  deviceId: string;
  sessionId: string;
  after: number;
  chat?: boolean;
  taskId?:string;
  unsubscribe?: () => void;
};
export type WebServiceOptions = {
  paths: StatePaths;
  service: SessionService;
  config: WebConfig;
  assets?: WebAssets;
  now?: () => number;
  push?: Pick<WebPushOptions, "send">;
  maxReplayEvents?: number;
  maxQueuedBytes?: number;
};
const COOKIE = "deck_device";
const PUSH_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const HEADERS = { "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "Permissions-Policy": "camera=(), microphone=(), geolocation=()" };
const safeId = (v: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(v) && !v.includes("..");
export class WebService {
  private server?: Server<SocketData>;
  private push?: WebPush;
  private replies?: LeadReplies;
  private replyError = false;
  private replyTimer?: ReturnType<typeof setInterval>;
  private replyCursor = 0;
  private pendingReplies=new Set<string>();
  private pendingRevocations=new Set<string>();
  private syncReplies(id?: string) {
    if(!this.replies)throw Error("reply-storage-unavailable");
    let pending=false;
    const all=this.options.service.pushAttentionSessions?.()??[];
    const ids=id?[id]:Array.from({length:Math.min(4,all.length)},()=>all[this.replyCursor++%all.length]!);
    for(const key of ids){const log=this.options.service.openLog(key);if(log){const more=this.replies.sync(log);if(more)this.pendingReplies.add(key);else this.pendingReplies.delete(key);pending=more||pending;}}
    this.replyError=false;return pending||this.pendingReplies.size>0;
  }
  private unsubscribePush?: () => void;
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
  private histories = new Map<EventLog, {history:ChatHistory;unsubscribe:()=>void}>();
  private history(log:EventLog) {
    let entry=this.histories.get(log);
    if(!entry){if(this.histories.size>=8){const [oldLog,old]=this.histories.entries().next().value!;old.unsubscribe();this.histories.delete(oldLog);}
      const history=new ChatHistory(log);entry={history,unsubscribe:log.subscribe(event=>history.apply(event))};this.histories.set(log,entry);}
    return entry.history;
  }
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
      if (!Array.isArray(value) || !value.every(d => d && typeof d.id === 'string' && typeof d.name === 'string' && typeof d.createdAt === 'string' && /^[a-f0-9]{64}$/.test(d.hash) && (d.expiresAt === undefined || typeof d.expiresAt === 'string' && Number.isFinite(Date.parse(d.expiresAt))) && (d.tailscaleIdentity === undefined || typeof d.tailscaleIdentity === 'string' && /^[a-f0-9]{64}$/.test(d.tailscaleIdentity))))
        throw new Error("Invalid web device store");
      this.records = value;
      for(const d of this.records)if(d.revokedAt)this.pendingRevocations.add(d.id);
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
        try {
          this.replies=new LeadReplies(this.options.paths.webDir,this.now);
          for(const id of this.options.service.pushAttentionSessions?.()??[])this.pendingReplies.add(id);
          if(this.replies.fresh)for(const id of this.options.service.pushAttentionSessions?.()??[]){const log=this.options.service.openLog(id);if(log)this.replies.initialize(log);}
          for(const d of this.records)if(this.activeDevice(d))this.replies.enroll(d.id);
        }catch{this.replyError=true;}

        try {
          this.push = new WebPush({paths:this.options.paths, now:this.now,
            isDeviceActive:id=>this.records.some(d=>d.id===id&&this.activeDevice(d)),
            attentionItems:this.options.service.pushAttentionItems ? id=>this.options.service.pushAttentionItems!(id).filter(item=>item.kind!=='result'&&item.kind!=='finished') : undefined,
            replyAttentionPage:(id,after)=>{
              try{
                this.syncReplies(id);
                if(this.options.service.canNotifyReplies?.(id)===false)return {items:[]};
                const page=this.replies!.attentionPage(id,after),current=this.options.service.pushAttentionItems?.(id)??[];
                return {...page,items:page.items.map(reply=>{
                  const existing=current.find(item=>item.seq===reply.seq&&(item.kind==='result'||item.kind==='finished'));
                  return {...reply,...(existing?{kind:existing.kind,othersActive:existing.othersActive}:{})};
                })};
              }catch{this.replyError=true;return {items:[]};}
            },
            replyAttentionItem:(id,replyId)=>{
              try{
                if(this.options.service.canNotifyReplies?.(id)===false)return;
                const reply=this.replies?.attentionReply(id,replyId);if(!reply)return;
                const current=this.options.service.pushAttentionItems?.(id).find(item=>item.seq===reply.seq&&(item.kind==='result'||item.kind==='finished'));
                return {...reply,...(current?{kind:current.kind,othersActive:current.othersActive}:{})};
              }catch{this.replyError=true;return;}
            },
            isReplyDisplayed:(deviceId,sessionId,replyId)=>this.replies?.isDisplayed(deviceId,sessionId,replyId)??false,
            attentionSessions:this.options.service.pushAttentionSessions ? ()=>this.options.service.pushAttentionSessions!() : undefined,
            isCurrent:attention=>this.options.service.isPushAttentionCurrent?.(attention)??false,
            ...this.options.push});
          this.unsubscribePush = this.options.service.subscribeEvents?.(event=>{
            this.pendingReplies.add(event.sessionId);
            if(event.kind==='session.removed')this.push?.retireSession(event.sessionId);
            // Defer until the complete append batch has been applied.
            if(event.kind==='turn.completed'||event.kind==='session.removed'&&event.data.phase==='removed')queueMicrotask(()=>{try{this.syncReplies(event.sessionId);this.push?.evaluate(event.sessionId);}catch{this.replyError=true;}});
            this.push?.accept(event);
          });
        } catch { this.push = undefined; }
        // Revoked device records are durable cleanup intents, including after restart.
        // Retry separately from reply replay so an unavailable index cannot skip
        // push cancellation or socket teardown.
        this.replyTimer=setInterval(()=>{
          for(const id of [...this.pendingRevocations].slice(0,4))this.cleanupRevocation(id);
          const ids=this.options.service.pushAttentionSessions?.()??[];
          for(let n=0;n<Math.min(4,ids.length);n++){const id=ids[this.replyCursor++%ids.length]!;try{this.syncReplies(id);}catch{this.replyError=true;}}
        },250);this.replyTimer.unref();
        for(const id of [...this.pendingRevocations].slice(0,4))this.cleanupRevocation(id);
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
    clearInterval(this.replyTimer);this.replyTimer=undefined;
    this.replies?.close();this.replies=undefined;this.pendingReplies.clear();
    this.unsubscribePush?.(); this.unsubscribePush=undefined; this.push?.close(); this.push=undefined;
    for(const entry of this.histories.values())entry.unsubscribe();
    this.histories.clear();
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
  status() { return { enabled: !!this.server, hostname: "127.0.0.1", port: this.server?.port ?? this.options.config.port, url: this.server ? `http://127.0.0.1:${this.server.port}` : undefined, clients: this.clientCount, error: this.error ?? (this.pendingRevocations.size ? 'device-revocation-cleanup-pending' : this.replyError ? 'reply-storage-unavailable' : undefined), exposure: { trustedProxy: this.options.config.trustedProxy, allowedOrigins: this.options.config.allowedOrigins, allowFunnel: this.options.config.allowFunnel, tailscaleServeAccess: this.options.config.tailscaleServeAccess ?? false } }; }
  pair() { if (!this.server)
    throw new Error("Web listener disabled"); const code = String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, "0"), token = randomBytes(32).toString("base64url"); this.challenge = { codeHash: hash(code), tokenHash: hash(token), expiresAt: this.now() + 300000, attempts: 0 }; return { code, url: `${this.status().url}/#pair=${token}`, expiresAt: new Date(this.challenge.expiresAt).toISOString() }; }
  devices() { return this.records.map(({ hash, tailscaleIdentity, ...d }) => d); }
  revoke(id: string) { const d = this.records.find(d => d.id === id); if (!d)
    return false; d.revokedAt ??= new Date(this.now()).toISOString();this.pendingRevocations.add(id);
    if(!this.cleanupRevocation(id))throw Error('device-revocation-cleanup-pending');return true; }
  private disconnectDevice(id:string) {
    let complete=true;
    for(const ws of this.sockets)if(ws.data.deviceId===id){
      this.sockets.delete(ws);
      try{ws.data.unsubscribe?.();}catch{complete=false;}
      finally{ws.data.unsubscribe=undefined;try{ws.close(1008,'Device revoked');}catch{complete=false;try{ws.terminate();}catch{}}}
    }
    return complete;
  }
  private cleanupRevocation(id:string) {
    let complete=true;
    const attempt=(cleanup:()=>void)=>{try{cleanup();}catch{complete=false;}};
    attempt(()=>{if(!this.disconnectDevice(id))complete=false;});
    attempt(()=>this.save());
    attempt(()=>{
      if(this.push)this.push.revoke(id);
      else if(existsSync(join(this.options.paths.webDir,'push.json'))){
        const dormant=new WebPush({paths:this.options.paths,isDeviceActive:deviceId=>this.records.some(record=>record.id===deviceId&&this.activeDevice(record)),isCurrent:()=>false});
        try{dormant.revoke(id);}finally{dormant.close();}
      }
    });
    attempt(()=>{
      if(this.replies)this.replies.revoke(id);
      else if(existsSync(join(this.options.paths.webDir,'lead-replies.sqlite'))||existsSync(join(this.options.paths.webDir,'lead-replies.json'))){
        const dormant=new LeadReplies(this.options.paths.webDir,this.now);try{dormant.revoke(id);}finally{dormant.close();}
      }
    });
    if(complete)this.pendingRevocations.delete(id);return complete;
  }
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
  catch (error) {
    return { ok: false, code: "web-unavailable", ...((error as Error).message==='device-revocation-cleanup-pending'?{message:'Device access is blocked; revocation cleanup is pending.'}:{}) };
  } }
  private response(data: unknown, status = 200, extra: Record<string, string> = {}) { return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, "Content-Type": "application/json", ...extra } }); }
  private issueDevice(r: Request, body: Record<string, unknown>, tailscaleIdentity?: string) {
    const token = randomBytes(32).toString('base64url');
    const d: Device = { id: randomUUID(), name: typeof body.name === 'string' ? body.name.slice(0, 80) : 'Browser', createdAt: new Date(this.now()).toISOString(), hash: hash(token), ...(tailscaleIdentity ? { tailscaleIdentity } : {}) };
    this.replies?.enroll(d.id);
    this.records.push(d);
    this.save();
    return this.response({ ok: true, device: this.devices().find(x => x.id === d.id) }, 200, { 'Set-Cookie': this.deviceCookie(r, token) });
  }
  private cookieToken(r: Request) { return (r.headers.get('cookie') ?? '').split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1); }
  private deviceCookie(r: Request, token: string, persistent = false) {
    const secure = r.headers.get('origin')?.startsWith('https://') ? '; Secure' : '';
    const lifetime = persistent ? `; Max-Age=${PUSH_COOKIE_MAX_AGE}; Expires=${new Date(this.now() + PUSH_COOKIE_MAX_AGE * 1000).toUTCString()}` : '';
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}${lifetime}`;
  }
  private activeDevice(d: Device) { return !d.revokedAt && (d.expiresAt === undefined || Date.parse(d.expiresAt) > this.now()); }
  private device(r: Request, s: Server<SocketData>) {
    const token = this.cookieToken(r); if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const h = hash(token);
    return this.records.find(d => this.activeDevice(d) && equal(d.hash, h) && (!d.tailscaleIdentity || d.tailscaleIdentity === this.serveIdentity(r, s)));
  }
  // Serve strips inbound identity headers and adds its verified user login. Trust
  // this contract only on the explicitly configured loopback proxy deployment.
  private serveIdentity(r: Request, s: Server<SocketData>) {
    const config = this.options.config;
    const peer = s.requestIP(r)?.address;
    if (!config.tailscaleServeAccess || !peer || peer !== config.trustedProxy || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) || [...r.headers.keys()].some(h => h.includes('funnel')))
      return;
    const origin = config.allowedOrigins.find(o => {
      const u = new URL(o);
      return u.protocol === 'https:' && u.hostname.endsWith('.ts.net') && u.host === r.headers.get('host');
    });
    if (!origin || (r.headers.has('origin') && r.headers.get('origin') !== origin)) return;
    const login = r.headers.get('tailscale-user-login');
    if (!login || login !== login.trim() || login.length > 512 || /[\s,\x00-\x1f\x7f]/.test(login)) return;
    return hash(JSON.stringify([origin, login]));
  }
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
        const tailscaleIdentity = this.serveIdentity(r, s);
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '')
          && origin !== null && localOrigins.includes(origin) && new URL(origin).host === host
          && ![...r.headers.keys()].some(h => h === 'forwarded' || h.startsWith('x-forwarded-') || h.includes('funnel'));
        if (!tailscaleIdentity && !local)
          return this.response({ ok: false, code: 'request-forbidden' }, 403);
        const body = await this.json(r);
        const existing = this.device(r, s);
        if (existing) return this.response({ ok: true, device: this.devices().find(d => d.id === existing.id) });
        // A revoked or invalid credential must not silently obtain a replacement.
        if ((r.headers.get('cookie') ?? '').split(';').some(c => c.trim().startsWith(`${COOKIE}=`)))
          return this.response({ ok: false, code: 'device-revoked' }, 403);
        return this.issueDevice(r, body, tailscaleIdentity);
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
        const device = this.device(r, s);
        if (!device)
          return this.response({ ok: false, code: 'device-required' }, 401);
        if(path==='/api/replies' || /^\/api\/sessions\/[^/]+\/replies(?:\/[^/]+)?$/.test(path)) {
          if(!this.replies)return this.response({ok:false,code:'reply-storage-unavailable'},503);
          const match=/^\/api\/sessions\/([^/]+)\/replies(?:\/([^/]+))?$/.exec(path);
          const sessionId=match?.[1],replyId=match?.[2];
          if(sessionId&&!safeId(sessionId)||replyId&&!validReplyId(replyId))return this.response({ok:false,code:'reply-invalid'},400);
          if(sessionId&&!this.options.service.openLog(sessionId))return this.response({ok:false,code:'session-unknown'},404);
          try {
            // Receipt replay belongs after the body await: source changes while
            // reading it must be validated, with only one 4096-event batch per POST.
            const syncing=r.method==='POST'&&replyId?false:this.syncReplies(sessionId);this.replies.enroll(device.id);
            if(r.method==='GET'&&replyId){const reply=this.replies.get(sessionId!,replyId);return reply?this.response({ok:true,reply}):this.response({ok:false,code:'reply-unknown'},404);}
            if(r.method==='POST'&&replyId){
              if(!this.replies.get(sessionId!,replyId))return this.response({ok:false,code:'reply-unknown'},404);
              let body:Record<string,unknown>;try{body=await this.json(r);}catch{return this.response({ok:false,code:'reply-receipt-invalid'},400);}
              if(body.displayed!==true||Object.keys(body).some(k=>k!=='displayed'))return this.response({ok:false,code:'reply-receipt-invalid'},400);
              if(!this.device(r,s))return this.response({ok:false,code:'device-required'},401);
              const log=this.options.service.openLog(sessionId!);
              if(!log)return this.response({ok:false,code:'session-unknown'},404);
              if(this.replies.sync(log)){this.pendingReplies.add(sessionId!);return this.response({ok:false,code:'reply-history-syncing'},503);}
              this.pendingReplies.delete(sessionId!);
              if(!this.replies.get(sessionId!,replyId))return this.response({ok:false,code:'reply-unknown'},404);
              this.replies.displayed(device.id,sessionId!,replyId);this.push?.evaluate(sessionId);
              return this.response({ok:true});
            }
            if(r.method==='GET'&&!replyId&&sessionId&&url.searchParams.has('messageSeq')){
              const values=url.searchParams.getAll('messageSeq');
              if([...url.searchParams.keys()].some(k=>k!=='messageSeq')||values.length>120||values.some(v=>!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1))return this.response({ok:false,code:'cursor-invalid'},400);
              return this.response({ok:true,replies:this.replies.forMessages(device.id,sessionId,values.map(Number)),syncing});
            }
            if(r.method==='GET'&&!replyId){
              const raw=url.searchParams.get('cursor')??'0';
              if([...url.searchParams.keys()].some(k=>k!=='cursor')||url.searchParams.getAll('cursor').length>1||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))return this.response({ok:false,code:'cursor-invalid'},400);
              return this.response({ok:true,...this.replies.list(device.id,Number(raw),sessionId),syncing});
            }
            return this.response({ok:false,code:'route-unknown'},404);
          }catch{return this.response({ok:false,code:'reply-storage-unavailable'},503);}
        }
        if (path === '/api/push' || path === '/api/push/presence') {
          const origins=[`http://127.0.0.1:${s.port}`,`http://localhost:${s.port}`,...this.options.config.allowedOrigins];
          const referer=r.headers.get('referer');
          const supplied=r.headers.get('origin')??(referer?new URL(referer).origin:undefined);
          const origin=supplied??origins.find(o=>new URL(o).host===r.headers.get('host'))!;
          if (!origins.includes(origin) || new URL(origin).host!==r.headers.get('host')) return this.response({ok:false,code:'request-forbidden'},403);
          if (!this.push || !this.options.service.subscribeEvents) return this.response({ok:false,code:'push-unavailable'},503);
          if (path === '/api/push' && r.method === 'GET') return this.response({ok:true,...this.push.status(device.id,origin)});
          if (path === '/api/push' && r.method === 'DELETE') { this.push.unsubscribe(device.id,origin); return this.response({ok:true}); }
          if (r.method === 'POST') {
            if (!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')??'')) return this.response({ok:false,code:'request-invalid'},400);
            const body=JSON.parse(new TextDecoder().decode(await this.boundedBody(r,8192)));
            // A revoke may race a streaming upload; recheck authorization after reading it.
            if (!this.device(r,s)) return this.response({ok:false,code:'device-required'},401);
            if (path === '/api/push') {
              this.push.subscribe(device.id,origin,body.subscription,body.renew===true);
              device.expiresAt = new Date(this.now() + PUSH_COOKIE_MAX_AGE * 1000).toISOString(); this.save();
              return this.response({ok:true},200,{'Set-Cookie':this.deviceCookie(r,this.cookieToken(r)!,true)});
            }
            this.push.presence(device.id,origin,body.tabId,body.sessionId,body.revision,body.seenSeq);
            return this.response({ok:true});
          }
          return this.response({ok:false,code:'route-unknown'},404);
        }
        const summary = /^\/api\/sessions\/([^/]+)\/summary$/.exec(path);
        if(summary && r.method==='GET') {
          if(!safeId(summary[1]!))return this.response({ok:false,code:'session-invalid'},400);
          const outcome=await this.options.service.query?.('session.summary',{sessionId:summary[1]})??{ok:false as const,code:'query-unavailable'};
          return this.response(outcome,outcome.ok?200:404);
        }
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
        const decisions = /^\/api\/sessions\/([^/]+)\/decisions$/.exec(path);
        if (decisions && r.method === "GET") {
          if (!safeId(decisions[1]!)) return this.response({ok:false,code:"session-invalid"},400);
          const outcome = await this.options.service.query?.("decisions.list",{sessionId:decisions[1]}) ?? {ok:false as const,code:"query-unavailable"};
          return this.response(outcome,outcome.ok?200:404);
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
        const historyMatch = /^\/api\/sessions\/([^/]+)\/history$/.exec(path);
        if(historyMatch && r.method==='GET') {
          const id=historyMatch[1]!;
          const params=url.searchParams;
          if(!safeId(id)||[...params.keys()].some(key=>!['before','after','around','limit','taskId'].includes(key)||params.getAll(key).length!==1)||['before','after','around'].filter(key=>params.has(key)).length>1)return this.response({ok:false,code:'cursor-invalid'},400);
          const taskId=params.get('taskId')??undefined;
          if(taskId!==undefined&&!safeId(taskId))return this.response({ok:false,code:'cursor-invalid'},400);
          const parsed: {before?:number;after?:number;around?:number;limit?:number;taskId?:string}={taskId};
          for(const key of ['before','after','around','limit'] as const) {
            const raw=params.get(key);if(raw===null)continue;
            const value=Number(raw);
            if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||value<1||key==='limit'&&value>40)return this.response({ok:false,code:'cursor-invalid'},400);
            parsed[key]=value;
          }
          const log=this.options.service.openLog(id);
          if(!log)return this.response({ok:false,code:'session-unknown'},404);
          return this.response(this.history(log).page(parsed));
        }
        const match = /^\/api\/sessions\/([^/]+)\/events$/.exec(path);
        if (match && r.method === 'GET') {
          const id = match[1]!, raw = url.searchParams.get('after') ?? '0', after = Number(raw);
          const taskId=url.searchParams.get('taskId')??undefined;
          if(url.searchParams.getAll('taskId').length>1||taskId!==undefined&&!safeId(taskId))return this.response({ok:false,code:'cursor-invalid'},400);
          if (!safeId(id) || !/^\d+$/.test(raw) || !Number.isSafeInteger(after))
            return this.response({ ok: false, code: 'cursor-invalid' }, 400);
          const log = this.options.service.openLog(id);
          if (!log)
            return this.response({ ok: false, code: 'session-unknown' }, 404);
          if (r.headers.get('upgrade')?.toLowerCase() === 'websocket') {
            if (s.upgrade(r, { data: { deviceId: device.id, sessionId: id, after, chat: url.searchParams.get('view')==='chat', taskId }, headers: HEADERS }))
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
    if (!this.records.some(d => d.id === ws.data.deviceId && this.activeDevice(d))) {
      ws.close(1008, 'Device revoked');
      return;
    }
    this.sockets.add(ws);
    const log = this.options.service.openLog(ws.data.sessionId);
    if (!log) {
      ws.close(1008, 'Unknown session');
      return;
    }
    const send = (e: SessionEvent) => { if(!this.records.some(d=>d.id===ws.data.deviceId&&this.activeDevice(d))){this.disconnectDevice(ws.data.deviceId);return false;} if (e.seq <= ws.data.after)
      return; const history=ws.data.chat?this.history(log):undefined;history?.apply(e);
      const value = JSON.stringify({ type: 'event', event: e, ...(history ? {message:history.messageAt(e,ws.data.taskId)} : {}) }); if (ws.getBufferedAmount() + Buffer.byteLength(value) > (this.options.maxQueuedBytes ?? 1024 * 1024) || ws.send(value) === -1) {
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
