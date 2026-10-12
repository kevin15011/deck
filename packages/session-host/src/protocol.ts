/**
 * Local control protocol (XR-8.1): newline-delimited JSON frames over the daemon Unix socket.
 * Used by the terminal client, the TUI and the session MCP bridge.
 */
import type { SessionCommand } from "@deck/core/session/commands";
import type { SessionEvent } from "@deck/core/session/events";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;

export type CommandOutcome =
  | { ok: true; data?: unknown }
  | { ok: false; code: string; message?: string; errors?: string[] };

/** What a service returns: the outcome plus an optional flag for a duplicate recognised from persisted receipts. */
export type ExecuteOutcome = CommandOutcome & { duplicate?: boolean };

export type ClientFrame =
  | { t: "hello"; id?: string; clientVersion: string }
  | { t: "command"; id?: string; sessionId?: string; command: unknown }
  | { t: "detach"; id?: string; sessionId: string }
  | { t: "daemon.status"; id?: string }
  | { t: "daemon.restart"; id?: string }
  | { t: "bridge.call"; id?: string; token: string; tool: string; arguments?: unknown }
  | { t: "query"; id?: string; name: string; args?: unknown };

export type ServerFrame =
  | { t: "hello"; id?: string; protocol: number; daemonVersion: string; pid: number; nonce: string }
  | { t: "command.result"; id?: string; commandId?: string; outcome: CommandOutcome; duplicate?: boolean }
  | { t: "event"; sessionId: string; event: SessionEvent }
  | { t: "caught-up"; sessionId: string; seq: number }
  | { t: "resync"; sessionId: string; reason: string }
  | { t: "detached"; id?: string; sessionId: string }
  | { t: "daemon.status"; id?: string; status: unknown }
  | { t: "daemon.restart"; id?: string; outcome: CommandOutcome }
  | { t: "bridge.result"; id?: string; outcome: CommandOutcome }
  | { t: "query.result"; id?: string; outcome: CommandOutcome }
  | { t: "error"; id?: string; code: string; message: string };

export type ValidatedCommand = SessionCommand;

export function encodeFrame(frame: ClientFrame | ServerFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/** Incremental NDJSON decoder with a hard per-frame size bound. */
export class FrameDecoder {
  private buffer = "";
  constructor(private readonly maxBytes = MAX_FRAME_BYTES) {}

  /** Returns complete lines; throws FrameTooLargeError when a single line exceeds the bound. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let at: number;
    while ((at = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (line.length > this.maxBytes) throw new FrameTooLargeError();
      if (line.trim().length > 0) lines.push(line);
    }
    if (this.buffer.length > this.maxBytes) throw new FrameTooLargeError();
    return lines;
  }
}

export class FrameTooLargeError extends Error {
  constructor() { super("Frame exceeds the maximum size"); this.name = "FrameTooLargeError"; }
}

export function parseFrame(line: string): { ok: true; frame: Record<string, unknown> & { t: string } } | { ok: false } {
  try {
    const value = JSON.parse(line) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as { t?: unknown }).t === "string") {
      return { ok: true, frame: value as Record<string, unknown> & { t: string } };
    }
  } catch { /* fall through */ }
  return { ok: false };
}
