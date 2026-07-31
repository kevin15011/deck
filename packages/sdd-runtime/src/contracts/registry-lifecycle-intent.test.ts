import { describe, expect, test } from "bun:test";

import { buildRegistryLifecycleIntentV1, parseRegistryLifecycleIntentV1 } from "./registry-lifecycle-intent";

const digest = (char: string) => `sha256:${char.repeat(64)}` as const;

describe("RegistryLifecycleIntentV1", () => {
  test("serializes park, reactivate, and terminal closure additively", () => {
    const park = buildRegistryLifecycleIntentV1({
      schema: "registry-lifecycle-intent-v1", changeId: "change", transition: "park", reason: "Waiting for dependency",
      timestamp: "2026-07-30T00:00:00.000Z", prior: { phase: "apply", status: "in_progress" },
    });
    const close = buildRegistryLifecycleIntentV1({
      schema: "registry-lifecycle-intent-v1", changeId: "change", transition: "supersede", reason: "Replaced",
      timestamp: "2026-07-30T00:00:00.000Z", prior: { phase: "apply", status: "parked" }, successorChangeId: "replacement",
    });
    expect(park.intentId).toMatch(/^registry-lifecycle-intent:v1:/);
    expect(close.transition).toBe("supersede");
    expect(parseRegistryLifecycleIntentV1(close)).toEqual(close);
    expect(() => parseRegistryLifecycleIntentV1({ ...park, unknown: true })).toThrow();
    expect(digest("a")).toMatch(/^sha256:/);
  });
});
