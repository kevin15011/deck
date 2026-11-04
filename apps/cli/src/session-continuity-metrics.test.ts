import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readContinuityMetrics } from "./session-continuity-metrics";

function event(seq: number, kind: string, data: Record<string, unknown> = {}) {
  return {
    v: 1, sessionId: "s", seq, ts: new Date(seq * 10).toISOString(), kind,
    source: { taskId: "t", memberId: "quality" }, data,
  };
}

// Protects offline history compatibility without dropping ordinary metrics after retired events.
// Oracle: retirement spec requires replay-only acceptance and preserved session history.
test("metrics read mixed historical and current segments through task completion", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-continuity-history-"));
  const write = (name: string, rows: unknown[]) =>
    writeFileSync(join(dir, name), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  try {
    // Create out of order to exercise chronological segment traversal.
    write("000002.jsonl", [
      event(5, "memory.proposed"), event(6, "memory.written"),
      event(7, "usage", { requestUsage: { requestId: "r2", inputTokens: 20 } }),
      event(8, "task.state", { taskId: "t", state: "completed" }),
    ]);
    write("000001.jsonl", [
      event(1, "task.created", { taskId: "t", memberId: "quality", runnerId: "claude", modelId: "m", continuityRole: "review" }),
      event(2, "task.state", { taskId: "t", state: "running", launched: true }),
      event(3, "usage", { requestUsage: { requestId: "r1", inputTokens: 10 } }),
      event(4, "memory.recalled"),
    ]);
    const report = readContinuityMetrics(dir);
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0]!.cost).toMatchObject({
      kind: "review-through-completion", status: "completed", steps: 2,
      tokens: { input: 30 }, durationMs: 60,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Replay acceptance remains bounded to known event kinds and validated envelopes/data.
for (const [name, invalid, error] of [
  ["unknown kind", event(1, "unknown.event"), "unknown kind"],
  ["malformed historical envelope", { ...event(1, "memory.recalled"), seq: 0 }, "seq must"],
  ["malformed current data", event(1, "task.created"), "data.taskId required"],
] as const) {
  test(`metrics reject ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "deck-continuity-invalid-"));
    try {
      writeFileSync(join(dir, "000001.jsonl"), JSON.stringify(invalid) + "\n");
      expect(() => readContinuityMetrics(dir)).toThrow(error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
