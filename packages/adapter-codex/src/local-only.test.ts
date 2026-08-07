import { describe, expect, test } from "bun:test";

import { buildLocalOnlyExcludeMutation, composeLocalOnlyExclude } from "./local-only";

describe("buildLocalOnlyExcludeMutation", () => {
  test("keeps its exact owned entries idempotently", () => {
    const first = composeLocalOnlyExclude("user\n", [".codex/agents/deck-lead.toml"]);
    expect(first.blocked).toBe(false);
    const second = composeLocalOnlyExclude(first.content, []);
    expect(second).toEqual(first);
  });
  test("adds only exact new untracked fully-owned paths and preserves user entries", async () => {
    const result = await buildLocalOnlyExcludeMutation({
      projectRoot: "/p",
      requestedPaths: [".codex/agents/deck-lead.toml", "AGENTS.md", ".codex/config.toml"],
      tracked: new Set(["AGENTS.md"]),
      fullyOwned: new Set([".codex/agents/deck-lead.toml"]),
      resolveExcludePath: async () => "/p/.git/info/exclude",
      existingExclude: "user-entry\n",
    });
    expect(result.content).toContain("user-entry\n");
    expect(result.content).toContain("/.codex/agents/deck-lead.toml");
    expect(result.content).not.toContain("/AGENTS.md");
    expect(result.visiblePaths).toEqual(["AGENTS.md", ".codex/config.toml"]);
  });

  test("blocks shared mutations when zero visible tracked changes is required", async () => {
    const result = await buildLocalOnlyExcludeMutation({
      projectRoot: "/p",
      requestedPaths: ["AGENTS.md"],
      tracked: new Set(["AGENTS.md"]),
      fullyOwned: new Set(),
      requireZeroVisibleTrackedChanges: true,
      resolveExcludePath: async () => "/p/.git/info/exclude",
      existingExclude: "",
    });
    expect(result.blocked).toBe(true);
  });
});
