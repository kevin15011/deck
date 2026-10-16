import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventLog, EventLogCorruptError, type LogDiagnostic } from "../event-log";
import { FakeClock, cleanupTempDirs, tempDir } from "./test-helpers";

afterEach(cleanupTempDirs);
const open = (dir: string, extra: Partial<Parameters<typeof EventLog.open>[0]> = {}) =>
  EventLog.open({ dir: join(dir, "events"), sessionId: "s-1", ...extra });
const say = (log: EventLog, n: number, text = "x") => {
  for (let i = 0; i < n; i++) log.append({ kind: "message.delta", source: { taskId: "lead" }, data: { text: `${text}${i}` } });
};
const seqs = (events: Iterable<{ seq: number }>) => [...events].map((e) => e.seq);

describe("EventLog ordering and persistence (XR-3.3)", () => {
  test("assigns seq 1..N, ISO timestamps, and replays after a cursor", () => {
    const log = open(tempDir());
    say(log, 5);
    expect(log.lastSeq).toBe(5);
    const all = [...log.readAfter(0)];
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.every((e) => e.v === 1 && e.sessionId === "s-1" && !Number.isNaN(Date.parse(e.ts)))).toBe(true);
    expect(seqs(log.readAfter(3))).toEqual([4, 5]);
    expect(seqs(log.readAfter(5))).toEqual([]);
    expect(seqs(log.readAfter(99))).toEqual([]);
    log.close();
  });

  test("reopening continues the sequence and keeps every event", () => {
    const dir = tempDir();
    const a = open(dir);
    say(a, 3);
    a.close();
    const b = open(dir);
    expect(b.lastSeq).toBe(3);
    say(b, 2);
    expect(seqs(b.readAfter(0))).toEqual([1, 2, 3, 4, 5]);
    b.close();
  });

  test("files are append-only JSONL with 0600 files in a 0700 directory", () => {
    const dir = tempDir();
    const log = open(dir);
    say(log, 2);
    log.close();
    const events = join(dir, "events");
    expect(lstatSync(events).mode & 0o777).toBe(0o700);
    expect(readdirSync(events)).toEqual(["000001.jsonl"]);
    expect(lstatSync(join(events, "000001.jsonl")).mode & 0o777).toBe(0o600);
    const lines = readFileSync(join(events, "000001.jsonl"), "utf8").trimEnd().split("\n");
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2]);
  });

  test("rejects invalid drafts without consuming a sequence number", () => {
    const log = open(tempDir());
    expect(() => log.append({ kind: "not.a.kind" as never })).toThrow(/invalid/i);
    expect(() => log.append({ kind: "task.created", data: {} })).toThrow(/taskId/);
    expect(log.lastSeq).toBe(0);
    say(log, 1);
    expect(log.lastSeq).toBe(1);
    log.close();
  });

  test("bounds and redacts raw payloads before persistence (XR-1.3)", () => {
    const dir = tempDir();
    const log = open(dir);
    const big = log.append({ kind: "runner.unmapped", raw: { runnerId: "r", protocol: "p", payload: { blob: "a".repeat(200_000) }, truncated: false } });
    expect(big.raw?.truncated).toBe(true);
    expect(typeof big.raw?.payload).toBe("string");
    expect((big.raw?.payload as string).length).toBeLessThanOrEqual(64 * 1024);
    const secret = log.append({ kind: "runner.unmapped", raw: { runnerId: "r", protocol: "p", payload: { note: "Authorization: Bearer abc123def" }, truncated: false } });
    expect(JSON.stringify(secret.raw)).not.toContain("abc123def");
    log.close();
  });

  test("appendMany writes a batch atomically with consecutive seq", () => {
    const log = open(tempDir());
    const events = log.appendMany([{ kind: "turn.started" }, { kind: "message.delta", data: { text: "a" } }, { kind: "turn.completed", data: { status: "completed" } }]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(() => log.appendMany([{ kind: "turn.started" }, { kind: "bogus" as never }])).toThrow();
    expect(log.lastSeq).toBe(3);
    log.close();
  });
});

describe("crash-truncated tail (XR-3.3)", () => {
  test("a partial last line is ignored, reported, trimmed, and appends continue cleanly", () => {
    const dir = tempDir();
    const a = open(dir);
    say(a, 3);
    a.close();
    const file = join(dir, "events", "000001.jsonl");
    appendFileSync(file, '{"v":1,"sessionId":"s-1","seq":4,"ts":"2026-01-01T00:0');
    const seen: LogDiagnostic[] = [];
    const b = open(dir, { onDiagnostic: (d) => seen.push(d) });
    expect(b.lastSeq).toBe(3);
    expect(seen.map((d) => d.code)).toEqual(["event-log-truncated-tail"]);
    expect(b.diagnostics.map((d) => d.code)).toEqual(["event-log-truncated-tail"]);
    say(b, 1);
    b.close();
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([1, 2, 3, 4]);
  });

  test("a NUL-filled tail (power loss) is treated the same way", () => {
    const dir = tempDir();
    const a = open(dir);
    say(a, 2);
    a.close();
    appendFileSync(join(dir, "events", "000001.jsonl"), Buffer.alloc(32));
    const b = open(dir);
    expect(b.lastSeq).toBe(2);
    expect(b.diagnostics).toHaveLength(1);
    b.close();
  });

  test("corruption before the tail is fatal, not silently skipped", () => {
    const dir = tempDir();
    const a = open(dir);
    say(a, 3);
    a.close();
    const file = join(dir, "events", "000001.jsonl");
    const lines = readFileSync(file, "utf8").split("\n");
    lines[1] = "{not json";
    writeFileSync(file, lines.join("\n"));
    expect(() => open(dir)).toThrow(EventLogCorruptError);
  });

  test("a sequence gap inside a segment is fatal", () => {
    const dir = tempDir();
    const a = open(dir);
    say(a, 3);
    a.close();
    const file = join(dir, "events", "000001.jsonl");
    const lines = readFileSync(file, "utf8").split("\n");
    writeFileSync(file, [lines[0], lines[2], ""].join("\n"));
    expect(() => open(dir)).toThrow(EventLogCorruptError);
  });
});

describe("segment rotation (D-3, XR-3.5)", () => {
  test("rotates at the segment size and reads across boundaries without gaps", () => {
    const dir = tempDir();
    const log = open(dir, { segmentBytes: 600 });
    say(log, 30, "payload-");
    const files = readdirSync(join(dir, "events")).sort();
    expect(files.length).toBeGreaterThan(2);
    expect(files[0]).toBe("000001.jsonl");
    for (const f of files.slice(0, -1)) expect(lstatSync(join(dir, "events", f)).size).toBeLessThanOrEqual(600);
    expect(seqs(log.readAfter(0))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    for (const cursor of [0, 1, 5, 14, 29, 30]) {
      expect(seqs(log.readAfter(cursor))).toEqual(Array.from({ length: 30 - cursor }, (_, i) => cursor + i + 1));
    }
    log.close();
    const reopened = open(dir, { segmentBytes: 600 });
    expect(reopened.lastSeq).toBe(30);
    expect(seqs(reopened.readAfter(10))).toEqual(Array.from({ length: 20 }, (_, i) => 11 + i));
    reopened.close();
  });

  test("an event larger than the segment limit gets its own segment", () => {
    const log = open(tempDir(), { segmentBytes: 200 });
    say(log, 1);
    log.append({ kind: "message.delta", data: { text: "y".repeat(1000) } });
    say(log, 1);
    expect(seqs(log.readAfter(0))).toEqual([1, 2, 3]);
    log.close();
  });

  test("a missing middle segment is detected as a gap", () => {
    const dir = tempDir();
    const log = open(dir, { segmentBytes: 400 });
    say(log, 30);
    log.close();
    const files = readdirSync(join(dir, "events")).sort();
    rmSync(join(dir, "events", files[1]!));
    expect(() => open(dir, { segmentBytes: 400 })).toThrow(EventLogCorruptError);
  });

  test("rotation boundary survives a crash right after a rotation (empty newest segment)", () => {
    const dir = tempDir();
    const log = open(dir, { segmentBytes: 300 });
    say(log, 8);
    log.close();
    const files = readdirSync(join(dir, "events")).sort();
    const next = String(Number(files.at(-1)!.slice(0, 6)) + 1).padStart(6, "0") + ".jsonl";
    writeFileSync(join(dir, "events", next), "", { mode: 0o600 });
    const reopened = open(dir, { segmentBytes: 300 });
    expect(reopened.lastSeq).toBe(8);
    say(reopened, 1);
    expect(seqs(reopened.readAfter(7))).toEqual([8, 9]);
    reopened.close();
  });
});

describe("batched fsync (design 6.2)", () => {
  test("coalesces appends inside the window into one fsync", () => {
    const clock = new FakeClock();
    let syncs = 0;
    const log = open(tempDir(), { clock, fsyncWindowMs: 50, io: { fsync: () => { syncs++; } } });
    say(log, 10);
    expect(syncs).toBe(0);
    clock.advance(49);
    expect(syncs).toBe(0);
    clock.advance(1);
    expect(syncs).toBe(1);
    say(log, 1);
    clock.advance(50);
    expect(syncs).toBe(2);
    log.close();
  });

  test("flush and close force the pending fsync", () => {
    const clock = new FakeClock();
    let syncs = 0;
    const log = open(tempDir(), { clock, io: { fsync: () => { syncs++; } } });
    say(log, 2);
    log.flush();
    expect(syncs).toBe(1);
    log.flush();
    expect(syncs).toBe(1);
    say(log, 1);
    log.close();
    expect(syncs).toBe(2);
    expect(clock.pending).toBe(0);
  });
});

describe("live subscription and failures", () => {
  test("subscribers see events in order, can unsubscribe, and cannot break appends", () => {
    const log = open(tempDir());
    const got: number[] = [];
    const off = log.subscribe((e) => { got.push(e.seq); });
    log.subscribe(() => { throw new Error("boom"); });
    say(log, 2);
    off();
    say(log, 1);
    expect(got).toEqual([1, 2]);
    expect(log.lastSeq).toBe(3);
    log.close();
  });

  test("a failed write does not consume a sequence number and leaves a clean segment", () => {
    const dir = tempDir();
    let fail = false;
    const log = open(dir, { io: { write: (fd, buf, off, len) => { if (fail) { const e = new Error("ENOSPC") as NodeJS.ErrnoException; e.code = "ENOSPC"; throw e; } return (require("node:fs") as typeof import("node:fs")).writeSync(fd, buf, off, len); } } });
    say(log, 2);
    fail = true;
    expect(() => say(log, 1)).toThrow(/ENOSPC/);
    expect(log.lastSeq).toBe(2);
    fail = false;
    say(log, 1);
    expect(seqs(log.readAfter(0))).toEqual([1, 2, 3]);
    log.close();
    expect(existsSync(join(dir, "events", "000001.jsonl"))).toBe(true);
  });

  test("append after close is rejected", () => {
    const log = open(tempDir());
    log.close();
    expect(() => say(log, 1)).toThrow(/closed/i);
  });
});

test('random-access history reads preserve UTF-8 bytes across rotation and reopening',()=>{
 const dir=tempDir();
 try {
  const options={dir,sessionId:'history',segmentBytes:256};
  const log=EventLog.open(options);
  const events=log.appendMany([{kind:'message.completed',data:{text:'Synthetic 🧪 ñ'}},{kind:'message.completed',data:{text:'Second synthetic'}}]);
  events.push(log.append({kind:'message.completed',data:{text:'Rotated'}}));
  expect(events.map(e=>log.readEvent(e.seq))).toEqual(events);expect(log.readEvent(0)).toBeUndefined();expect(log.readEvent(999)).toBeUndefined();log.close();
  const reopened=EventLog.open(options);expect(events.map(e=>reopened.readEvent(e.seq))).toEqual(events);reopened.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
