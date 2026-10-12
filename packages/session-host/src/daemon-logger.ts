/** Structured, redacted, day-rotated daemon log under `<state>/logs/` (XR-11.1, design 12). Never throws. */
import { closeSync, constants, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import { redactText } from "@deck/core/session/redaction";
import type { Clock } from "./clock";

export type LogLevel = "info" | "warn" | "error";
export interface DaemonLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const FIELD_CAP = 2000;

function clean(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value, FIELD_CAP);
  if (value === null || typeof value !== "object" || depth > 3) return typeof value === "object" ? "[truncated]" : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clean(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([k, v]) => [k, /(?:token|secret|password|api[_-]?key|authorization)/i.test(k) ? "[redacted]" : clean(v, depth + 1)]));
}

export function createDaemonLogger(options: { dir: string; clock: Clock }): DaemonLogger {
  const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
    try {
      const now = new Date(options.clock.now());
      const day = now.toISOString().slice(0, 10).replaceAll("-", "");
      mkdirSync(options.dir, { recursive: true, mode: 0o700 });
      const fd = openSync(join(options.dir, `daemon-${day}.jsonl`), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { writeSync(fd, `${JSON.stringify({ ts: now.toISOString(), level, event, ...(clean(fields) as object) })}\n`); } finally { closeSync(fd); }
    } catch { /* logging must never affect the daemon */ }
  };
  return { info: (e, f) => write("info", e, f), warn: (e, f) => write("warn", e, f), error: (e, f) => write("error", e, f) };
}
