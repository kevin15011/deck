/**
 * Append-only JSONL event log for one session (XR-3.3, XR-3.5, D-3, D-15).
 *
 * - `seq` is gap-free and monotonic across segments; segments rotate at `segmentBytes`.
 * - Appends are written synchronously (visible to readers immediately) and fsynced in batches.
 * - A crash-truncated last line is dropped with a diagnostic; any other damage is fatal.
 */
import {
  closeSync, constants, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, truncateSync, writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  boundRaw, validateSessionEvent, type SessionEvent, type SessionEventKind, type SessionEventRaw, type SessionEventSource,
} from "@deck/core/session/events";
import { systemClock, type Clock, type TimerHandle } from "./clock";
import { ensurePrivateDir } from "./paths";

export const DEFAULT_SEGMENT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_FSYNC_WINDOW_MS = 50;

export type EventDraft = {
  kind: SessionEventKind;
  source?: SessionEventSource;
  data?: Record<string, unknown>;
  raw?: SessionEventRaw;
};

export type LogDiagnostic = { code: "event-log-truncated-tail" | "event-log-fsync-failed" | "event-log-newline-repaired"; file: string; detail?: string; droppedBytes?: number };

export class EventLogCorruptError extends Error {
  /** `malformed` lines may be a crash-truncated tail; `consistency` failures never are. */
  constructor(message: string, readonly file?: string, readonly reason: "malformed" | "consistency" = "consistency") {
    super(message);
    this.name = "EventLogCorruptError";
  }
}

export type EventLogIo = {
  write(fd: number, buffer: Uint8Array, offset: number, length: number): number;
  fsync(fd: number): void;
};

export type EventLogOptions = {
  dir: string;
  sessionId: string;
  segmentBytes?: number;
  fsyncWindowMs?: number;
  clock?: Clock;
  onDiagnostic?: (diagnostic: LogDiagnostic) => void;
  io?: Partial<EventLogIo>;
};

type Segment = { index: number; path: string; firstSeq: number; lastSeq: number };
const SEGMENT_NAME = /^(\d{6})\.jsonl$/;
const segmentName = (index: number) => `${String(index).padStart(6, "0")}.jsonl`;

export class EventLog {
  private readonly segments: Segment[] = [];
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private readonly diagnosticList: LogDiagnostic[] = [];
  private readonly io: EventLogIo;
  private fd: number | undefined;
  private activeBytes = 0;
  private seq = 0;
  private dirty = false;
  private timer: TimerHandle | undefined;
  private closed = false;
  private broken: Error | undefined;

  private constructor(private readonly options: Required<Pick<EventLogOptions, "dir" | "sessionId" | "segmentBytes" | "fsyncWindowMs">> & { clock: Clock; onDiagnostic?: (d: LogDiagnostic) => void }, io: EventLogIo) {
    this.io = io;
  }

  static open(options: EventLogOptions): EventLog {
    const log = new EventLog({
      dir: options.dir,
      sessionId: options.sessionId,
      segmentBytes: options.segmentBytes ?? DEFAULT_SEGMENT_BYTES,
      fsyncWindowMs: options.fsyncWindowMs ?? DEFAULT_FSYNC_WINDOW_MS,
      clock: options.clock ?? systemClock,
      onDiagnostic: options.onDiagnostic,
    }, {
      write: options.io?.write ?? ((fd, buffer, offset, length) => writeSync(fd, buffer, offset, length)),
      fsync: options.io?.fsync ?? ((fd) => fsyncSync(fd)),
    });
    log.load();
    return log;
  }

  get lastSeq(): number { return this.seq; }
  get sessionId(): string { return this.options.sessionId; }
  get diagnostics(): readonly LogDiagnostic[] { return this.diagnosticList; }

  private diagnose(d: LogDiagnostic): void {
    this.diagnosticList.push(d);
    try { this.options.onDiagnostic?.(d); } catch { /* diagnostics must never break the log */ }
  }

  // ---- loading -----------------------------------------------------------------------------

  private load(): void {
    const { dir } = this.options;
    mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
    ensurePrivateDir(dir);
    const names = readdirSync(dir).filter((n) => SEGMENT_NAME.test(n)).sort();
    let expectedNext = 1;
    names.forEach((name, i) => {
      const path = join(dir, name);
      const index = Number(SEGMENT_NAME.exec(name)![1]);
      const isLast = i === names.length - 1;
      const segment = isLast ? this.scanTail(path, index, expectedNext) : this.scanSealed(path, index, expectedNext);
      this.segments.push(segment);
      expectedNext = segment.lastSeq + 1;
    });
    this.seq = expectedNext - 1;
    const last = this.segments.at(-1);
    if (last) {
      this.fd = openSync(last.path, constants.O_WRONLY | constants.O_APPEND, 0o600);
      this.activeBytes = statSync(last.path).size;
    }
  }

  private parseLine(text: string, path: string, expectedSeq: number): SessionEvent {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new EventLogCorruptError(`Invalid JSON near seq ${expectedSeq}`, path, "malformed"); }
    const result = validateSessionEvent(value);
    if (!result.ok) throw new EventLogCorruptError(`Invalid event near seq ${expectedSeq}: ${result.errors.join("; ")}`, path, "malformed");
    if (result.value.seq !== expectedSeq) throw new EventLogCorruptError(`Sequence gap: expected ${expectedSeq}, found ${result.value.seq}`, path);
    if (result.value.sessionId !== this.options.sessionId) throw new EventLogCorruptError(`Event belongs to session ${result.value.sessionId}`, path);
    return result.value;
  }

  /** Sealed (non-newest) segment: verify first/last line and line count only. */
  private scanSealed(path: string, index: number, expectedFirst: number): Segment {
    const buf = readFileSync(path);
    if (buf.length === 0 || buf[buf.length - 1] !== 0x0a) throw new EventLogCorruptError("Sealed segment is empty or unterminated", path);
    const firstEnd = buf.indexOf(0x0a);
    const first = this.parseLine(buf.toString("utf8", 0, firstEnd), path, expectedFirst);
    const prevNl = buf.lastIndexOf(0x0a, buf.length - 2);
    const lastLine = buf.toString("utf8", prevNl + 1, buf.length - 1);
    let lines = 0;
    for (let at = buf.indexOf(0x0a); at !== -1; at = buf.indexOf(0x0a, at + 1)) lines++;
    const lastSeq = expectedFirst + lines - 1;
    this.parseLine(lastLine, path, lastSeq);
    return { index, path, firstSeq: first.seq, lastSeq };
  }

  /** Newest segment: parse everything, drop a crash-truncated final line. */
  private scanTail(path: string, index: number, expectedFirst: number): Segment {
    const buf = readFileSync(path);
    let pos = 0;
    let goodEnd = 0;
    let next = expectedFirst;
    let repairNewline = false;
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      const end = nl === -1 ? buf.length : nl;
      const isFinalLine = nl === -1 || nl + 1 >= buf.length;
      try {
        this.parseLine(buf.toString("utf8", pos, end), path, next);
      } catch (error) {
        if (!isFinalLine || (error as EventLogCorruptError).reason !== "malformed") throw error;
        break; // crash-truncated (or zero-filled) tail
      }
      next++;
      if (nl === -1) { repairNewline = true; goodEnd = buf.length; break; }
      pos = nl + 1;
      goodEnd = pos;
    }
    if (goodEnd < buf.length) {
      truncateSync(path, goodEnd);
      this.diagnose({ code: "event-log-truncated-tail", file: path, droppedBytes: buf.length - goodEnd });
    }
    if (repairNewline) {
      const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND);
      try { writeSync(fd, "\n"); fsyncSync(fd); } finally { closeSync(fd); }
      this.diagnose({ code: "event-log-newline-repaired", file: path });
    }
    return { index, path, firstSeq: expectedFirst, lastSeq: next - 1 };
  }

  // ---- appending ---------------------------------------------------------------------------

  private build(draft: EventDraft, seq: number, ts: string): SessionEvent {
    const event: SessionEvent = {
      v: 1, sessionId: this.options.sessionId, seq, ts, kind: draft.kind, source: draft.source ?? {}, data: draft.data ?? {},
    };
    if (draft.raw) {
      const bounded = boundRaw({ runnerId: draft.raw.runnerId, protocol: draft.raw.protocol, payload: draft.raw.payload });
      event.raw = { ...bounded, truncated: bounded.truncated || draft.raw.truncated };
    }
    const result = validateSessionEvent(event);
    if (!result.ok) throw new Error(`Invalid session event: ${result.errors.join("; ")}`);
    return event;
  }

  append(draft: EventDraft): SessionEvent {
    return this.appendMany([draft])[0]!;
  }

  /** Atomically append a batch (one write, consecutive seq, one rotation decision). */
  appendMany(drafts: readonly EventDraft[]): SessionEvent[] {
    if (this.closed) throw new Error("Event log is closed");
    if (this.broken) throw new Error(`Event log is unusable after a failed write: ${this.broken.message}`);
    if (drafts.length === 0) return [];
    const ts = new Date(this.options.clock.now()).toISOString();
    const events = drafts.map((draft, i) => this.build(draft, this.seq + 1 + i, ts));
    const buffer = Buffer.from(events.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");

    if (this.fd === undefined) this.openNextSegment(this.seq + 1);
    else if (this.activeBytes > 0 && this.activeBytes + buffer.length > this.options.segmentBytes) this.rotate(this.seq + 1);

    this.writeAll(buffer);
    this.activeBytes += buffer.length;
    this.seq += events.length;
    this.segments.at(-1)!.lastSeq = this.seq;
    this.markDirty();
    for (const event of events) this.notify(event);
    return events;
  }

  private writeAll(buffer: Uint8Array): void {
    let offset = 0;
    try {
      while (offset < buffer.length) offset += this.io.write(this.fd!, buffer, offset, buffer.length - offset);
    } catch (error) {
      try { ftruncateSync(this.fd!, this.activeBytes); } catch (rollback) { this.broken = rollback as Error; }
      throw error;
    }
  }

  private openNextSegment(firstSeq: number): void {
    const index = (this.segments.at(-1)?.index ?? 0) + 1;
    const path = join(this.options.dir, segmentName(index));
    this.fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL, 0o600);
    this.activeBytes = 0;
    this.segments.push({ index, path, firstSeq, lastSeq: firstSeq - 1 });
  }

  private rotate(firstSeq: number): void {
    this.flush();
    closeSync(this.fd!);
    this.fd = undefined;
    this.openNextSegment(firstSeq);
  }

  private notify(event: SessionEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch { /* a slow or broken subscriber must not affect persistence */ }
    }
  }

  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ---- durability --------------------------------------------------------------------------

  private markDirty(): void {
    this.dirty = true;
    if (this.timer !== undefined) return;
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = undefined;
      try { this.flush(); } catch (error) {
        this.diagnose({ code: "event-log-fsync-failed", file: this.segments.at(-1)?.path ?? this.options.dir, detail: (error as Error).message });
      }
    }, this.options.fsyncWindowMs);
  }

  /** Force the pending fsync now. */
  flush(): void {
    if (this.timer !== undefined) { this.options.clock.clearTimeout(this.timer); this.timer = undefined; }
    if (!this.dirty || this.fd === undefined) return;
    this.io.fsync(this.fd);
    this.dirty = false;
  }

  close(): void {
    if (this.closed) return;
    try { this.flush(); } finally {
      this.closed = true;
      this.listeners.clear();
      if (this.fd !== undefined) closeSync(this.fd);
      this.fd = undefined;
    }
  }

  // ---- reading -----------------------------------------------------------------------------

  /** Every persisted event with `seq > after`, in order, across segments. */
  *readAfter(after: number): Generator<SessionEvent> {
    const cursor = Math.max(0, Math.floor(after));
    for (const segment of [...this.segments]) {
      if (segment.lastSeq <= cursor) continue;
      const buf = readFileSync(segment.path);
      const skip = Math.max(0, cursor - segment.firstSeq + 1);
      let pos = 0;
      for (let i = 0; i < skip; i++) { const nl = buf.indexOf(0x0a, pos); if (nl === -1) break; pos = nl + 1; }
      let seq = segment.firstSeq + skip;
      while (pos < buf.length) {
        const nl = buf.indexOf(0x0a, pos);
        if (nl === -1) break; // unterminated: not yet committed
        if (seq > segment.lastSeq) return;
        yield this.parseLine(buf.toString("utf8", pos, nl), segment.path, seq);
        seq++;
        pos = nl + 1;
      }
    }
  }
}
