import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runSessionSmoke } from "../../../scripts/session-smoke";

/**
 * Production composition through the real CLI entry (main.tsx): owned daemon startup, ToS gate, a prompt
 * end to end through a fake `claude` on PATH, list/status/stop, daemon SIGTERM. The same harness is the
 * S1 BIN gate against the compiled binary (scripts/session-smoke.ts <binary>).
 */
test("S1 smoke: deck cross developer + deck session ... against a fake claude, from a temp HOME", async () => {
  const report = await runSessionSmoke({ deck: [process.execPath, resolve(import.meta.dir, "main.tsx")], timeoutMs: 90_000, keep: true });
  try {
    const wrapper = readFileSync(resolve(report.tempDir!, "bin/claude"), "utf8");
    expect(wrapper).toContain(resolve(report.tempDir!, "fake-claude.mjs"));
    expect(wrapper).not.toContain(resolve(import.meta.dir, "../../.."));
    const failed = report.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(15);
  } finally { rmSync(report.tempDir!, { recursive: true, force: true }); }
}, 240_000);

test("S1 smoke cleans up its owned daemon and stalled terminal on attachment timeout", async () => {
  const report = await runSessionSmoke({ deck: [process.execPath, resolve(import.meta.dir, "../../../scripts/fixtures/failing-smoke-deck.mjs")], timeoutMs: 300, keep: true });
  try {
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "cross developer attaches to the daemon")?.ok).toBe(false);
    for (const name of ["internal", "cross"]) {
      const pid = Number(readFileSync(resolve(report.tempDir!, `${name}.pid`), "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    }
  } finally { rmSync(report.tempDir!, { recursive: true, force: true }); }
}, 15_000);

for (const runner of ["codex", "opencode"] as const) {
  test(`S2 smoke: native ${runner} protocol through the production CLI`, async () => {
    const report = await runSessionSmoke({ deck: [process.execPath, resolve(import.meta.dir, "main.tsx")], runner, timeoutMs: 15_000 });
    expect(report.checks.filter(c => !c.ok)).toEqual([]);
    expect(report.ok).toBe(true);
  }, 90_000);
}
