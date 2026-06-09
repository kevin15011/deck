import { describe, expect, test } from "bun:test";

import { getDeveloperTeamCatalog } from "./developer-team-catalog";

describe("Developer Team catalog", () => {
  test("includes all 14 agents with unique IDs (including deck-init and deck-onboard)", () => {
    const catalog = getDeveloperTeamCatalog();

    expect(catalog).toHaveLength(14);

    const ids = catalog.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(14);
  });

  test("contains required agent IDs in correct order", () => {
    const catalog = getDeveloperTeamCatalog();
    const ids = catalog.map((a) => a.id);

    expect(ids).toEqual([
      "deck-developer-orchestrator",
      "deck-developer-explorer",
      "deck-developer-proposal",
      "deck-developer-spec",
      "deck-developer-design",
      "deck-developer-task",
      "deck-developer-apply-general",
      "deck-developer-apply-backend",
      "deck-developer-apply-frontend",
      "deck-developer-verify",
      "deck-developer-review",
      "deck-developer-archive",
      "deck-init",
      "deck-onboard",
    ]);
  });

  test("every agent has id, name, displayName, description, and skillId", () => {
    const catalog = getDeveloperTeamCatalog();

    for (const agent of catalog) {
      expect(agent.id).toBeTruthy();
      expect(agent.name).toBe(agent.id);
      expect(agent.displayName).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(agent.skillId).toBe(agent.id);
    }
  });
});
