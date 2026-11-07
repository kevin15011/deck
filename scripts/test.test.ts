import { describe, expect, test } from "bun:test";
import { withBudget, validateQuarantine, RUN_BUDGET_MS } from "./test";

describe("quarantine metadata", () => {
  const entry = { path: "apps/web/src/a.test.ts", owner: "team", reason: "intermittent", link: "https://example.com/issue/1", created: "2026-10-20", expires: "2026-10-30" };
  test("expired and overlong entries fail", () => {
    expect(() => validateQuarantine([entry], new Date("2026-10-26"))).not.toThrow();
    expect(() => validateQuarantine([entry], new Date("2026-10-31"))).toThrow("expired");
    expect(() => validateQuarantine([{ ...entry, expires: "2026-11-10" }], new Date("2026-10-26"))).toThrow("14 days");
  });
  test("missing ownership and protected paths without approval fail", () => {
    expect(() => validateQuarantine([{ ...entry, owner: "" }])).toThrow("owner");
    expect(() => validateQuarantine([{ ...entry, path: "packages/session-host/src/approval.test.ts" }], new Date("2026-10-26"))).toThrow("approval");
  });
});

// Oracle: a deadline must terminate work and identify the offending file/run.
for (const [label, budget] of [["Test run", RUN_BUDGET_MS]] as const) {
  test(`${label} deadline kills pending work and fails`, async () => {
    let expire!: () => void;
    let killed = false, cleared = false;
    const result = withBudget({ exited: new Promise(() => {}), kill: () => { killed = true; } }, budget, label,
      (callback, ms) => { expect(ms).toBe(budget); expire = callback; return () => { cleared = true; }; });
    expire();
    await expect(result).rejects.toThrow(`${label} exceeded ${budget / 1000}s`);
    expect(killed).toBe(true);
    expect(cleared).toBe(true);
  });
}
test("completed work preserves exit status and cancels its deadline", async () => {
  let cleared = false;
  expect(await withBudget({ exited: Promise.resolve(7), kill: () => { throw new Error("unexpected kill"); } }, 2000, "file",
    () => () => { cleared = true; })).toBe(7);
  expect(cleared).toBe(true);
});

// Oracle: slow files run once, remain successful, and do not hide functional failures.
test("slow files warn without retrying or changing exit status", async () => {
  const { runWithTolerance } = await import("./test");
  let active = 0, peak = 0;
  const attempts = new Map<string, number>();
  const warnings: string[] = [];
  const results = await runWithTolerance(["spike", "slow", "failure", "normal", "later"], async file => {
    attempts.set(file, (attempts.get(file) ?? 0) + 1);
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    return { code: file === "failure" ? 1 : 0, text: file, overBudget: ["slow", "spike"].includes(file) };
  }, () => false, message => warnings.push(message));
  expect([...attempts.values()]).toEqual([1, 1, 1, 1, 1]);
  expect(peak).toBe(4);
  expect(results.filter(result => result.code !== 0).map(result => result.file)).toEqual(["failure"]);
  expect(warnings).toHaveLength(2);
});

// Oracle: stopped admission must never look like a successfully completed selection.
test("run deadline prevents later admission and rejects incomplete completion", async () => {
  const { runWithTolerance } = await import("./test");
  let stopped = false;
  const started: string[] = [];
  const work = runWithTolerance(["one", "two", "three", "four", "later"], async file => {
    started.push(file);
    await Promise.resolve();
    stopped = true;
    return { code: 0, text: "", overBudget: false };
  }, () => stopped);
  await expect(work).rejects.toThrow("stopped");
  expect(started).toEqual(["one", "two", "three", "four"]);
});

// Protects work-conserving scheduling without increasing the four-process limit.
test("a free worker starts the next file while another file remains pending", async () => {
  const { runWithTolerance } = await import("./test");
  let unblock!: () => void;
  const pending = new Promise<void>(resolve => { unblock = resolve; });
  const started: string[] = [];
  const work = runWithTolerance(["slow", "a", "b", "c", "next"], async file => {
    started.push(file);
    if (file === "slow") await pending;
    return { code: 0, text: "", overBudget: false };
  }, () => false);
  await Promise.resolve(); await Promise.resolve();
  expect(started).toContain("next");
  unblock();
  expect(await work).toHaveLength(5);
});

// Real boundary: the supervisor must kill the process group even when work blocks
// synchronously or exits while a descendant still holds its output pipes open.
test.skipIf(process.platform !== "linux")("supervisor bounds blocked work and descendant output drain", async () => {
  const { runSupervised } = await import("./test");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "deck-test-deadline-"));
  try {
    for (const mode of ["blocked", "drain"]) {
      const pidPath = join(root, mode);
      const script = `
        const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "inherit", stderr: "inherit" });
        require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
        ${mode === "blocked" ? "while (true) {}" : "process.exit(0)"}
      `;
      await expect(runSupervised([process.execPath, "-e", script], root, 400)).rejects.toThrow("wall-time budget");
      const pid = Number(readFileSync(pidPath, "utf8"));
      const running = () => {
        try { return !/[)] [ZX] /.test(readFileSync(`/proc/${pid}/stat`, "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
      };
      for (let i = 0; i < 20 && running(); i++) await Bun.sleep(5);
      expect(running()).toBe(false);
    }
    expect(await runSupervised([process.execPath, "-e", "process.exit(7)"], root, 1000)).toBe(7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
