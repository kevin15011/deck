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
