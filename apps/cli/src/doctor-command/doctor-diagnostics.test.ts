import { describe, expect, test } from "bun:test";

import { checkSupermemoryProjectScopeAgreement } from "./doctor-diagnostics";

describe("Supermemory project scope Doctor diagnostics", () => {
  test("passes only when configured MCP scope matches the repository-derived canonical scope", () => {
    const result = checkSupermemoryProjectScopeAgreement({
      derivedScope: "sm_project_v1_kevin15011_deck",
      configuredScopes: {
        opencode: "sm_project_v1_kevin15011_deck",
        pi: "sm_project_v1_kevin15011_deck",
        codex: "sm_project_v1_kevin15011_deck",
      },
    });

    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("sm_project_default");
    expect(JSON.stringify(result)).not.toContain("kevin15011_deck");
  });

  test("detects missing, mismatched, stale, and default Supermemory scopes without broadening memory", () => {
    const result = checkSupermemoryProjectScopeAgreement({
      derivedScope: "sm_project_v1_kevin15011_deck",
      configuredScopes: {
        opencode: undefined,
        pi: "sm_project_v1_other_repo",
        codex: "sm_project_default",
      },
    });
    const text = JSON.stringify(result);

    expect(result.status).toBe("error");
    expect(text).toContain("missing");
    expect(text).toContain("does not match");
    expect(text).toContain("legacy/default");
    expect(text).toContain("not authorized");
    expect(text).not.toContain("kevin15011_deck");
    expect(text).not.toContain("other_repo");
  });
});
