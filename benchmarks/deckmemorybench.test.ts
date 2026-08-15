import { describe, expect, test } from "bun:test";

import { runDeckMemoryBench } from "./deckmemorybench";

describe("DeckMemoryBench", () => {
  test("scores deterministic memory-quality fixtures without token-count claims", async () => {
    const results = await runDeckMemoryBench();
    expect(results).toHaveLength(13);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.map((result) => result.name)).toEqual(expect.arrayContaining([
      "temporal-supersession",
      "stale-contradictory-dominance",
      "recurring-problems",
      "changed-decisions",
      "preferences",
      "conventions",
      "root-causes",
      "rediscovery",
      "role-budgets",
      "project-leakage",
      "secret-exclusion",
      "latency-context-size",
      "mcp-primary-vs-runtime",
    ]));
    expect(Math.max(...results.map((result) => result.byteSize))).toBeLessThanOrEqual(6000);
  });
});
