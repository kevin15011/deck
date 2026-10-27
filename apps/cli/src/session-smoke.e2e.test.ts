import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { runSessionSmoke, type SmokeReport } from "../../../scripts/session-smoke";

/** Successful smoke reports must actually execute their protected-boundary checks. */
function expectNativeSmoke(report: SmokeReport, runner: "claude" | "codex" | "opencode") {
  expect(report.checks.filter(check => !check.ok)).toEqual([]);
  expect(report.ok).toBe(true);
  const nativeChecks = {
    claude: ["claude retains native user loading with relayed approvals and no native delegation", "claude protects the exact Deck declaration in a private additive MCP file"],
    codex: ["codex preserves native loading and disables native delegation", "codex receives the exact protected Deck declaration through thread stdin", "codex relays approvals to the user in the read-only sandbox"],
    opencode: ["opencode retains native HOME and global loading on authenticated loopback", "opencode protects the exact Deck declaration alongside native additions", "opencode relays approvals, preserves native deny and disables native delegation"],
  };
  for (const name of [...nativeChecks[runner], `no inline credential in ${runner} argv`, "event log records the full turn", "task credential was removed after the turn", "session state is private (0700 dirs, 0600 files)", "session stop ends the session", "daemon stops on SIGTERM", "daemon files cleaned up (no socket/lock left)"]) expect(report.checks).toContainEqual({name,ok:true});
}

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
    expectNativeSmoke(report, "claude");
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
    expectNativeSmoke(report, runner);
  }, 90_000);
}
