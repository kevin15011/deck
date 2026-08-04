import { describe, expect, test } from "bun:test";

import { migrateLegacyDeveloperTeamAssignments } from "./model-migration";

describe("legacy Developer Team model migration", () => {
  test("migrates one-to-one role assignments", () => {
    const result = migrateLegacyDeveloperTeamAssignments({
      "deck-developer-orchestrator": "model/lead",
      "deck-developer-explorer": "model/fast",
      "deck-developer-apply-general": "model/cheap",
      "deck-init": "model/setup",
    });
    expect(result.assignments).toEqual({
      "deck-lead": "model/lead",
      "deck-investigate": "model/fast",
      "deck-apply-fast": "model/cheap",
      "deck-setup": "model/setup",
    });
    expect(result.conflicts).toEqual([]);
  });

  test("migrates merged roles only when every configured legacy value agrees", () => {
    const result = migrateLegacyDeveloperTeamAssignments({
      "deck-developer-proposal": "model/reasoning",
      "deck-developer-design": "model/reasoning",
      "deck-developer-apply-backend": "model/deep",
      "deck-developer-apply-frontend": "model/deep",
      "deck-developer-verify": "model/quality-a",
      "deck-developer-review": "model/quality-b",
    });
    expect(result.assignments["deck-architect"]).toBe("model/reasoning");
    expect(result.assignments["deck-apply-deep"]).toBe("model/deep");
    expect(result.assignments["deck-quality"]).toBeUndefined();
    expect(result.conflicts).toEqual(["deck-quality"]);
  });

  test("never overwrites an existing new-role assignment", () => {
    const result = migrateLegacyDeveloperTeamAssignments({
      "deck-lead": "model/current",
      "deck-developer-orchestrator": "model/legacy",
    });
    expect(result.assignments["deck-lead"]).toBe("model/current");
    expect(result.migratedAgentIds).toEqual([]);
  });

  test("uses only the former orchestrator assignment for Lead", () => {
    const result = migrateLegacyDeveloperTeamAssignments({
      "deck-developer-orchestrator": "model/lead",
      "deck-developer-archive": "model/archive",
      "deck-onboard": "model/onboard",
    });
    expect(result.assignments).toEqual({ "deck-lead": "model/lead" });
    expect(result.conflicts).toEqual([]);
  });
});
