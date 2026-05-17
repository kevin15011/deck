import { describe, expect, test } from "bun:test";

import { getDeveloperTeamCatalog } from "./catalog";

describe("Developer Team catalog (canonical)", () => {
  test("includes all 12 agents with unique team-scoped IDs", () => {
    const catalog = getDeveloperTeamCatalog();

    expect(catalog).toHaveLength(12);

    const ids = catalog.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(12);
  });

  test("all IDs are team-scoped with 'deck-developer-' prefix", () => {
    const catalog = getDeveloperTeamCatalog();

    for (const agent of catalog) {
      expect(agent.id).toMatch(/^deck-developer-/);
      expect(agent.name).toBe(agent.id);
      expect(agent.skillId).toBe(agent.id);
    }
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
