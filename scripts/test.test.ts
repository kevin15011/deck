import { describe, expect, test } from "bun:test";
import { classifyTier, fallbackScope, selectAffected, validateQuarantine } from "./test";

test("tiers form a disjoint partition", () => {
  expect(["a.test.ts", "b.int.test.tsx", "c.e2e.test.ts"].map(classifyTier)).toEqual(["fast", "int", "e2e"]);
});
test("non-import inputs expand to their package, shared configuration to all", () => {
  expect(fallbackScope("packages/core/fixtures/input.json")).toBe("packages/core/");
  expect(fallbackScope("apps/cli/package.json")).toBe("apps/cli/");
  expect(fallbackScope("packages/core/src/content.generated.ts")).toBe("packages/core/");
  for (const path of ["bunfig.toml", "bun.lock", "package.json", "scripts/test-preload.ts"]) expect(fallbackScope(path)).toBe("");
  expect(fallbackScope("packages/core/src/parser.ts")).toBeUndefined();
});
test("affected closure includes transitive importers and terminates on cycles", () => {
  const graph = new Map([["a.test.ts", ["b.ts"]], ["b.ts", ["c.ts"]], ["c.ts", ["b.ts"]], ["other.test.ts", []]]);
  expect(selectAffected(["a.test.ts", "other.test.ts"], ["c.ts"], graph)).toEqual(["a.test.ts"]);
});
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
