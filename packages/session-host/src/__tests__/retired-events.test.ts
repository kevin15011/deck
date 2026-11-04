import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../event-log";

// Protects durable history and forbids retired effects at the append boundary.
test("old events replay but cannot be appended", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-retired-events-"));
  const kinds = ["memory.recalled", "memory.proposed", "memory.written"] as const;
  writeFileSync(join(dir, "000001.jsonl"), kinds.map((kind, i) => JSON.stringify({ v: 1, sessionId: "s", seq: i + 1, ts: "2026-01-01T00:00:00Z", kind, source: {}, data: {} })).join("\n") + "\n");
  const log = EventLog.open({ dir, sessionId: "s" });
  try {
    expect([...log.readAfter(0)].map(e => e.kind)).toEqual([...kinds]);
    for (const kind of kinds) expect(() => log.append({ kind: kind as never })).toThrow();
    expect(log.lastSeq).toBe(3);
    expect(log.append({ kind: "session.ended" }).seq).toBe(4);
  } finally { log.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("legacy hook attribution is replayed as inert data", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-legacy-hook-"));
  const event = { v: 1, sessionId: "s", seq: 1, ts: "2026-01-01T00:00:00Z", kind: "hook.completed", source: {}, data: { hookId: "h", hookEvent: "Stop", provenance: "codex-app-server", status: "completed", provider: "supermemory", integration: "runner-plugin" } } as const;
  writeFileSync(join(dir, "000001.jsonl"), JSON.stringify(event) + "\n");
  const log = EventLog.open({ dir, sessionId: "s" });
  try { expect([...log.readAfter(0)]).toEqual([event]); }
  finally { log.close(); rmSync(dir, { recursive: true, force: true }); }
});
