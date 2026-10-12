import { describe, expect, test } from "bun:test";
import { qualifyAssignments, projectForRunner } from "./assignments";

describe("runner-qualified assignments", () => {
  test("qualifyAssignments tags flat assignments with runner and thinking", () => {
    const out = qualifyAssignments("claude", { lead: "opus", "apply-fast": "sonnet" }, { lead: "high" });
    expect(out).toEqual({
      lead: { runnerId: "claude", modelId: "opus", thinking: "high" },
      "apply-fast": { runnerId: "claude", modelId: "sonnet" },
    });
  });
  test("projectForRunner keeps only that runner's members as flat assignments", () => {
    const cross = {
      lead: { runnerId: "claude", modelId: "opus" },
      "apply-deep": { runnerId: "codex", modelId: "gpt-x", thinking: "high" },
    };
    expect(projectForRunner("codex", cross)).toEqual({ "apply-deep": "gpt-x" });
    expect(projectForRunner("opencode", cross)).toEqual({});
  });
  test("does not mutate inputs", () => {
    const flat = { lead: "opus" };
    qualifyAssignments("claude", flat);
    expect(flat).toEqual({ lead: "opus" });
  });
});
