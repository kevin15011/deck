/**
 * Local control server (XR-8.1, XR-1.5, XR-3.4, XR-3.5): Unix socket, NDJSON frames, command
 * dispatch with idempotency, and attach = backlog then live with a bounded per-client queue
 * (overflow => `resync`, the client reattaches from its last cursor).
 */
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import net from "node:net";
import { dirname } from "node:path";
import { validateSessionCommand, type SessionCommand } from "@deck/core/session/commands";
import type { SessionEvent } from "@deck/core/session/events";
import type { EventLog } from "./event-log";
import { assertSafeSegment, ensurePrivateDir } from "./paths";
import {
  encodeFrame, FrameDecoder, MAX_FRAME_BYTES, parseFrame, PROTOCOL_VERSION, type CommandOutcome, type ExecuteOutcome, type ServerFrame,
} from "./protocol";
import type { SessionService } from "./service";

export const DEFAULT_MAX_QUEUED_EVENTS = 2000;
const DEFAULT_IDEMPOTENCY_WINDOW = 1000;

export type DaemonControl = {
  version: string; pid: number; nonce: string;
  status(): unknown;
  requestRestart(): CommandOutcome | Promise<CommandOutcome>;
};
export type BridgePort = { call(input: { token: string; tool: string; arguments?: unknown }, context?: { signal?: AbortSignal }): Promise<CommandOutcome> };

export type ControlServerOptions = {
  socketPath: string;
  service: SessionService;
  daemon: DaemonControl;
  bridge?: BridgePort;
  maxQueuedEvents?: number;
  maxFrameBytes?: number;
  idempotencyWindow?: number;
  onClientsChanged?: (count: number) => void;
  onDiagnostic?: (diagnostic: { code: string; detail?: string }) => void;
};

class Attachment {
  private queue: SessionEvent[] = [];
  private backlog: Iterator<SessionEvent> | undefined;
  private lastSent: number;
  private running = false;
  private done = false;
  private unsubscribe: () => void;

  constructor(
    private readonly conn: Connection, readonly sessionId: string, log: EventLog, after: number, private readonly maxQueue: number,
  ) {
    this.lastSent = after;
    // Subscribe BEFORE reading the backlog: appends are synchronous, so nothing can slip between the two.
    this.unsubscribe = log.subscribe((event) => this.onLive(event));
    this.backlog = log.readAfter(after);
    this.kick();
  }

  private onLive(event: SessionEvent): void {
    if (this.done) return;
    if (this.queue.length >= this.maxQueue) { this.overflow("queue-overflow"); return; }
    this.queue.push(event);
    this.kick();
  }

  private kick(): void {
    if (this.running || this.done) return;
    this.running = true;
    void this.pump().finally(() => { this.running = false; if (!this.done && (this.queue.length > 0 || this.backlog)) this.kick(); });
  }

  private async pump(): Promise<void> {
    while (!this.done) {
      let event: SessionEvent | undefined;
      if (this.backlog) {
        let next: IteratorResult<SessionEvent>;
        try { next = this.backlog.next(); } catch (error) {
          this.conn.send({ t: "error", code: "log-unreadable", message: (error as Error).message });
          return this.overflow("log-unreadable");
        }
        if (next.done) {
          this.backlog = undefined;
          this.conn.send({ t: "caught-up", sessionId: this.sessionId, seq: this.lastSent });
          continue;
        }
        event = next.value;
      } else {
        event = this.queue.shift();
      }
      if (!event) return;
      if (event.seq <= this.lastSent) continue; // seen via backlog already
      if (event.seq !== this.lastSent + 1) return this.overflow("sequence-gap"); // defensive: never deliver a hole
      await this.conn.sendBackpressured({ t: "event", sessionId: this.sessionId, event });
      this.lastSent = event.seq;
    }
  }

  private overflow(reason: string): void {
    if (this.done) return;
    this.dispose();
    this.conn.send({ t: "resync", sessionId: this.sessionId, reason });
    this.conn.endAfterFlush();
  }

  dispose(): void {
    this.done = true;
    this.unsubscribe();
    this.queue = [];
    this.backlog = undefined;
  }
}

class Connection {
  private readonly decoder: FrameDecoder;
  private readonly attachments = new Map<string, Attachment>();
  closed = false;
  /** Aborted when the peer disconnects, so blocking bridge calls can release their waiters. */
  readonly abort = new AbortController();

  constructor(readonly id: string, readonly socket: net.Socket, private readonly server: ControlServer, maxFrameBytes: number) {
    this.decoder = new FrameDecoder(maxFrameBytes);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", () => {});
    socket.once("close", () => this.onClose());
  }

  private onData(chunk: string): void {
    let lines: string[];
    try { lines = this.decoder.push(chunk); } catch { this.server.diag("frame-too-large"); this.socket.destroy(); return; }
    for (const line of lines) {
      const parsed = parseFrame(line);
      if (!parsed.ok) { this.send({ t: "error", code: "bad-frame", message: "Frame is not a JSON object with a string 't'" }); continue; }
      void this.server.handleFrame(this, parsed.frame).catch((error: Error) => {
        this.server.diag("handler-failed", error.message);
        this.send({ t: "error", id: typeof parsed.frame.id === "string" ? parsed.frame.id : undefined, code: "internal-error", message: "Frame handling failed" });
      });
    }
  }

  send(frame: ServerFrame): void {
    if (!this.closed && !this.socket.destroyed) this.socket.write(encodeFrame(frame));
  }

  /** Resolves once the frame was handed to the kernel (honours socket backpressure). */
  sendBackpressured(frame: ServerFrame): Promise<void> {
    if (this.closed || this.socket.destroyed) return Promise.resolve();
    if (this.socket.write(encodeFrame(frame))) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => { this.socket.off("drain", done); this.socket.off("close", done); resolve(); };
      this.socket.once("drain", done);
      this.socket.once("close", done);
    });
  }

  endAfterFlush(): void { this.socket.end(); }

  attach(sessionId: string, log: EventLog, after: number, maxQueue: number): void {
    this.attachments.get(sessionId)?.dispose();
    this.attachments.set(sessionId, new Attachment(this, sessionId, log, after, maxQueue));
  }

  detach(sessionId: string): void {
    this.attachments.get(sessionId)?.dispose();
    this.attachments.delete(sessionId);
  }

  private onClose(): void {
    this.closed = true;
    this.abort.abort();
    for (const a of this.attachments.values()) a.dispose();
    this.attachments.clear();
    this.server.connectionClosed(this);
  }
}

export class ControlServer {
  private server: net.Server | undefined;
  private readonly connections = new Set<Connection>();
  private readonly idempotency = new Map<string, Map<string, Promise<ExecuteOutcome>>>();
  private counter = 0;

  constructor(private readonly options: ControlServerOptions) {}

  get clientCount(): number { return this.connections.size; }
  diag(code: string, detail?: string): void { try { this.options.onDiagnostic?.({ code, detail }); } catch { /* never throws */ } }

  async listen(): Promise<void> {
    const { socketPath } = this.options;
    ensurePrivateDir(dirname(socketPath), { strict: true });
    await this.clearStaleSocket(socketPath);
    const server = net.createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
    chmodSync(socketPath, 0o600);
    this.server = server;
  }

  /** The daemon lock guarantees a single owner, so a leftover inode is stale unless something still answers. */
  private async clearStaleSocket(path: string): Promise<void> {
    let stat;
    try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (!stat.isSocket()) throw new Error(`Refusing to replace ${path}: not a socket`);
    if (process.getuid && stat.uid !== process.getuid()) throw new Error(`Refusing to replace ${path}: wrong owner`);
    const alive = await new Promise<boolean>((resolve) => {
      const probe = new net.Socket();
      const finish = (v: boolean) => { probe.destroy(); resolve(v); };
      probe.on("error", () => finish(false));
      probe.once("connect", () => finish(true));
      try { probe.connect(path); } catch { finish(false); }
      setTimeout(() => finish(false), 500).unref();
    });
    if (alive) throw new Error(`Daemon socket ${path} is already in use`);
    unlinkSync(path);
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const conn of [...this.connections]) conn.socket.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    try { if (lstatSync(this.options.socketPath).isSocket()) unlinkSync(this.options.socketPath); } catch { /* already gone */ }
  }

  private accept(socket: net.Socket): void {
    const conn = new Connection(`c-${++this.counter}`, socket, this, this.options.maxFrameBytes ?? MAX_FRAME_BYTES);
    this.connections.add(conn);
    this.options.onClientsChanged?.(this.connections.size);
  }

  connectionClosed(conn: Connection): void {
    if (this.connections.delete(conn)) this.options.onClientsChanged?.(this.connections.size);
  }

  async handleFrame(conn: Connection, frame: Record<string, unknown> & { t: string }): Promise<void> {
    const id = typeof frame.id === "string" ? frame.id : undefined;
    const reply = (f: ServerFrame) => conn.send(f);
    switch (frame.t) {
      case "hello": {
        const { daemon } = this.options;
        return reply({ t: "hello", id, protocol: PROTOCOL_VERSION, daemonVersion: daemon.version, pid: daemon.pid, nonce: daemon.nonce });
      }
      case "daemon.status": return reply({ t: "daemon.status", id, status: this.options.daemon.status() });
      case "daemon.restart": return reply({ t: "daemon.restart", id, outcome: await this.options.daemon.requestRestart() });
      case "detach": {
        if (typeof frame.sessionId === "string") conn.detach(frame.sessionId);
        return reply({ t: "detached", id, sessionId: String(frame.sessionId ?? "") });
      }
      case "bridge.call": {
        if (!this.options.bridge) return reply({ t: "bridge.result", id, outcome: { ok: false, code: "bridge-unavailable" } });
        if (typeof frame.token !== "string" || typeof frame.tool !== "string") return reply({ t: "bridge.result", id, outcome: { ok: false, code: "invalid-bridge-call" } });
        return reply({ t: "bridge.result", id, outcome: await this.options.bridge.call({ token: frame.token, tool: frame.tool, arguments: frame.arguments }, { signal: conn.abort.signal }) });
      }
      case "query": {
        const { service } = this.options;
        if (!service.query || typeof frame.name !== "string") return reply({ t: "query.result", id, outcome: { ok: false, code: "query-unsupported" } });
        let outcome: CommandOutcome;
        try { outcome = await service.query(frame.name, frame.args); } catch (error) {
          this.diag("query-threw", (error as Error).message);
          outcome = { ok: false, code: "internal-error", message: "Query failed" };
        }
        return reply({ t: "query.result", id, outcome });
      }
      case "command": return this.handleCommand(conn, id, frame);
      default: return reply({ t: "error", id, code: "unknown-frame", message: `Unknown frame type ${String(frame.t)}` });
    }
  }

  private async handleCommand(conn: Connection, id: string | undefined, frame: Record<string, unknown>): Promise<void> {
    const respond = (outcome: ExecuteOutcome, extra: { commandId?: string; duplicate?: boolean } = {}) => {
      // `duplicate` from a service (receipt found after a restart) is transport metadata, not part of the outcome.
      const { duplicate, ...rest } = outcome;
      conn.send({ t: "command.result", id, ...extra, ...(duplicate ? { duplicate: true } : {}), outcome: rest as CommandOutcome });
    };
    const validated = validateSessionCommand(frame.command);
    if (!validated.ok) return respond({ ok: false, code: "invalid-command", errors: validated.errors });
    const command = validated.value;
    let sessionId: string | undefined;
    if (frame.sessionId !== undefined) {
      try { sessionId = assertSafeSegment(String(frame.sessionId), "session id"); } catch { return respond({ ok: false, code: "invalid-session-id" }, { commandId: command.commandId }); }
    }
    if (command.type !== "session.create" && command.type !== "project.register" && command.type !== "project.rename" && command.type !== "project.remove" && !sessionId) return respond({ ok: false, code: "session-required" }, { commandId: command.commandId });

    if (command.type === "session.attach") {
      const log = this.options.service.openLog(sessionId!);
      if (!log) return respond({ ok: false, code: "unknown-session" }, { commandId: command.commandId });
      if (command.after > log.lastSeq) return respond({ ok: false, code: "cursor-ahead", message: `Log head is ${log.lastSeq}` }, { commandId: command.commandId });
      respond({ ok: true, data: { lastSeq: log.lastSeq } }, { commandId: command.commandId });
      conn.attach(sessionId!, log, command.after, this.options.maxQueuedEvents ?? DEFAULT_MAX_QUEUED_EVENTS);
      return;
    }

    const scope = sessionId ?? "";
    let bucket = this.idempotency.get(scope);
    if (!bucket) { bucket = new Map(); this.idempotency.set(scope, bucket); }
    const existing = bucket.get(command.commandId);
    if (existing) return respond(await existing, { commandId: command.commandId, duplicate: true });

    const execution = this.execute(conn, sessionId, command);
    bucket.set(command.commandId, execution);
    const window = this.options.idempotencyWindow ?? DEFAULT_IDEMPOTENCY_WINDOW;
    while (bucket.size > window) bucket.delete(bucket.keys().next().value!);
    respond(await execution, { commandId: command.commandId });
  }

  private async execute(conn: Connection, sessionId: string | undefined, command: SessionCommand): Promise<ExecuteOutcome> {
    try {
      return await this.options.service.execute({ sessionId, command, clientId: conn.id });
    } catch (error) {
      this.diag("service-threw", (error as Error).message);
      return { ok: false, code: "internal-error", message: "Command execution failed" };
    }
  }
}
