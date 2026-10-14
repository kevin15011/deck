import React from "react";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeRunnerAdapter } from "../../../../packages/adapter-claude/src";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import { getDefaultDeckConfig, validateDeckConfig } from "@deck/core";
import { buildCrossReview, createCrossDraft, inventoryModels, pickerRunner, saveCrossConfiguration } from "./cross-config";
import { CrossConfigurationScreen } from "./screens/cross-configuration-screen";

describe("cross configuration", () => {
  test("explicit picker targets route native and cross models to their own runner", () => {
    expect(pickerRunner({ kind: "runner-native", runnerId: "codex" })).toBe("codex");
    expect(pickerRunner({ kind: "cross-member", memberId: "quality", runnerId: "opencode" })).toBe("opencode");
  });
  test("actual Claude inventory keeps native inherit but excludes and rejects it for cross members", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "deck-cross-model-sentinel-")));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => [{ value: "opus", displayName: "Opus", description: "Runtime model fixture" }] });
      const result = await adapter.getModelInventory!({ projectRoot: home, mode: "rescan" });
      expect(result.state).toBe("ready");
      if (result.state !== "ready") throw new Error("Fixture inventory unavailable");
      expect(inventoryModels(result.inventory, "claude", { kind: "cross-member", memberId: "lead", runnerId: "claude" }).map(model => model.id)).toEqual(["opus"]);
      expect(inventoryModels(result.inventory, "claude", { kind: "runner-native", runnerId: "claude" }).map(model => model.id)).toEqual(["opus", "inherit"]);
      expect((await adapter.validateModelAssignments!({ projectRoot: home, modelAssignments: { "deck-lead": "inherit" }, thinkingAssignments: {}, changedAgentIds: ["deck-lead"] })).valid).toBe(true);
      const draft = createCrossDraft(getDefaultDeckConfig());
      draft.members.lead = { runnerId: "claude", modelId: "inherit" };
      draft.claudeTosAcknowledgedAt = "2026-10-12T00:00:00.000Z";
      const ready = [{ runnerId: "claude", label: "Claude", ready: true }];
      expect(buildCrossReview(draft, ready).blockers.join(" ")).toContain("explicit Claude model");
      let writes = 0;
      expect(() => saveCrossConfiguration({ patch() { writes++; return getDefaultDeckConfig(); } }, draft, ready)).toThrow("explicit Claude model");
      expect(writes).toBe(0);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
  test("full member → runner → model → thinking → review renders a configuration-only plan", () => {
    const draft = createCrossDraft(getDefaultDeckConfig());
    const checks = [{ runnerId: "codex", label: "Codex", ready: true }];
    for (const stage of ["members", "runners", "models", "thinking"] as const) {
      const text = renderToString(<CrossConfigurationScreen stage={stage} cursor={0} draft={draft} runners={checks} items={[{ label: "Fixture model" }]} />);
      expect(text).toContain(stage === "members" ? "lead" : stage === "runners" ? "Codex" : "Fixture model");
    }
    draft.members.lead = { runnerId: "codex", modelId: "fixture", thinking: "high" };
    const review = buildCrossReview(draft, checks);
    expect(review.installActions).toEqual([]);
    expect(review.blockers).toEqual([]);
    const text = renderToString(<CrossConfigurationScreen stage="review" cursor={0} draft={draft} runners={checks} items={[]} />);
    expect(text).toContain("codex / fixture / high");
    expect(text).toContain("Save cross configuration");
    expect(text).toContain("Missing members cannot receive delegated tasks");
  });
  test("review blocks missing installation, missing driver and lead without requiring Claude acknowledgement", () => {
    const draft = createCrossDraft(getDefaultDeckConfig());
    expect(buildCrossReview(draft, []).blockers).toContain("Lead assignment is required.");
    draft.members.lead = { runnerId: "claude", modelId: "opus" };
    const runners = [{ runnerId: "claude", label: "Claude", ready: false, reason: "Runner not installed" }];
    expect(buildCrossReview(draft, runners).blockers.join(" ")).toContain("Runner not installed");
    runners[0]!.reason = "No session driver";
    expect(buildCrossReview(draft, runners).blockers.join(" ")).toContain("No session driver");
    expect(buildCrossReview(draft, [{ ...runners[0]!, ready: true }]).blockers).toEqual([]);
    const text = renderToString(<CrossConfigurationScreen stage="review" cursor={0} draft={draft} runners={runners} items={[]} />);
    expect(text).not.toContain("Residual risk");
  });
  test("save patches current config atomically and preserves native assignments and concurrent changes", () => {
    let current = validateDeckConfig({ ...getDefaultDeckConfig(), crossRunner: { members: { lead: { runnerId: "codex", modelId: "old" } } } });
    const draft = createCrossDraft(current);
    draft.members.lead = { runnerId: "codex", modelId: "new" };
    current = validateDeckConfig({ ...current, crossRunner: { ...current.crossRunner, maxConcurrentTasks: 8, web: { port: 8123 } }, webSearch: { enabled: true, provider: "tavily" } });
    const before = current.developerTeamExecution;
    saveCrossConfiguration({ patch(fn) { current = validateDeckConfig(fn(current)); return current; } }, draft, [{ runnerId: "codex", label: "Codex", ready: true }]);
    expect(current.webSearch.enabled).toBe(true);
    expect(current.developerTeamExecution).toEqual(before);
    expect(current.crossRunner?.members.lead?.modelId).toBe("new");
    expect(current.crossRunner?.enabled).toBe(true);
    expect(current.crossRunner?.maxConcurrentTasks).toBe(8);
    expect(current.crossRunner?.web.port).toBe(8123);
  });
});
