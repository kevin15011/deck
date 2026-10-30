import { describe, expect, test } from "bun:test";
import { withBudget, validateQuarantine } from "./test";

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
for (const [label, budget] of [["slow.test.ts", 2000], ["Test run", 90000]] as const) {
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

// Protects isolated retries, one-off warnings, and persistent failures without real delays.
test("budget spikes retry alone once and retain real failures", async () => {
  const { runWithTolerance } = await import("./test");
  let active = 0;
  const attempts = new Map<string, number>();
  const warnings: string[] = [];
  const results = await runWithTolerance(["spike", "slow", "failure", "normal", "later"], async file => {
    const attempt = (attempts.get(file) ?? 0) + 1;
    attempts.set(file, attempt);
    if (attempt === 2) expect(active).toBe(0);
    active++;
    await Promise.resolve();
    active--;
    return { code: file === "failure" ? 1 : 0, text: file, overBudget: file === "slow" || (file === "spike" && attempt === 1) };
  }, () => false, message => warnings.push(message));
  expect(attempts.get("spike")).toBe(2);
  expect(attempts.get("slow")).toBe(2);
  expect(attempts.get("failure")).toBe(1);
  expect(results.filter(result => result.code !== 0).map(result => result.file)).toEqual(["slow", "failure"]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("spike");
});

test("run deadline prevents isolated retries and later batches", async () => {
  const { runWithTolerance } = await import("./test");
  let stopped = false;
  const started: string[] = [];
  await runWithTolerance(["one", "two", "three", "four", "later"], async file => {
    started.push(file);
    stopped = true;
    return { code: 1, text: "", overBudget: true };
  }, () => stopped);
  expect(started).toEqual(["one", "two", "three", "four"]);
});
