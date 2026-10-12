/** Minimal client for the daemon control socket (terminal client, TUI, tests, version handshake). */
import { randomUUID } from "node:crypto";
import net from "node:net";
import type { SessionEvent } from "@deck/core/session/events";
import { encodeFrame, FrameDecoder, parseFrame, type ClientFrame, type CommandOutcome, type ServerFrame } from "./protocol";

export type AttachHandlers = {
  onEvent(event: SessionEvent): void;
  onCaughtUp?(seq: number): void;
  onResync?(reason: string): void;
};

type Pending = { resolve: (f: ServerFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class ControlClient {
  private readonly pending = new Map<string, Pending>();
  private readonly attachments = new Map<string, AttachHandlers>();
  private readonly decoder = new FrameDecoder();
  private counter = 0;
  readonly closed: Promise<void>;
  private isClosed = false;

  private constructor(private readonly socket: net.Socket) {
    this.closed = new Promise<void>((resolve) => {
      socket.once("close", () => {
        this.isClosed = true;
        for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("Connection closed")); this.pending.delete(id); }
        resolve();
      });
    });
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (chunk: string) => {
      let lines: string[];
      try { lines = this.decoder.push(chunk); } catch { socket.destroy(); return; }
      for (const line of lines) {
        const parsed = parseFrame(line);
        if (parsed.ok) this.dispatch(parsed.frame as unknown as ServerFrame);
      }
    });
  }

  static connect(socketPath: string, options: { timeoutMs?: number } = {}): Promise<ControlClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath);
      const timer = setTimeout(() => { socket.destroy(); reject(new Error("Timed out connecting to the daemon socket")); }, options.timeoutMs ?? 5000);
      socket.once("connect", () => { clearTimeout(timer); resolve(new ControlClient(socket)); });
      socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
  }

  private dispatch(frame: ServerFrame): void {
    if ("id" in frame && frame.id !== undefined && this.pending.has(frame.id)) {
      const p = this.pending.get(frame.id)!;
      this.pending.delete(frame.id);
      clearTimeout(p.timer);
      p.resolve(frame);
      return;
    }
    if (frame.t === "event") this.attachments.get(frame.sessionId)?.onEvent(frame.event);
    else if (frame.t === "caught-up") this.attachments.get(frame.sessionId)?.onCaughtUp?.(frame.seq);
    else if (frame.t === "resync") { const h = this.attachments.get(frame.sessionId); this.attachments.delete(frame.sessionId); h?.onResync?.(frame.reason); }
  }

  request(frame: ClientFrame, timeoutMs = 10000): Promise<ServerFrame> {
    if (this.isClosed) return Promise.reject(new Error("Connection closed"));
    const id = frame.id ?? `r${++this.counter}`;
    return new Promise<ServerFrame>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out waiting for ${frame.t} reply`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(encodeFrame({ ...frame, id } as ClientFrame));
    });
  }

  async hello(clientVersion: string): Promise<Extract<ServerFrame, { t: "hello" }>> {
    const reply = await this.request({ t: "hello", clientVersion });
    if (reply.t !== "hello") throw new Error(`Unexpected reply to hello: ${reply.t}`);
    return reply;
  }

  async command(command: unknown, sessionId?: string): Promise<Extract<ServerFrame, { t: "command.result" }>> {
    const reply = await this.request({ t: "command", ...(sessionId ? { sessionId } : {}), command });
    if (reply.t !== "command.result") throw new Error(`Unexpected reply to command: ${reply.t === "error" ? reply.code : reply.t}`);
    return reply;
  }

  async attach(sessionId: string, after: number, handlers: AttachHandlers): Promise<CommandOutcome> {
    this.attachments.set(sessionId, handlers);
    const reply = await this.command({ v: 1, commandId: randomUUID(), type: "session.attach", after }, sessionId);
    if (!reply.outcome.ok) this.attachments.delete(sessionId);
    return reply.outcome;
  }

  async detach(sessionId: string): Promise<void> {
    this.attachments.delete(sessionId);
    await this.request({ t: "detach", sessionId });
  }

  close(): void { this.socket.destroy(); }
}
