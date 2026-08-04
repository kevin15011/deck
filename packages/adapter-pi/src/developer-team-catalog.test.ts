import { describe, expect, test } from "bun:test";

import { getDeveloperTeamCatalog } from "./developer-team-catalog";

describe("Developer Team catalog", () => {
  test("includes exactly seven canonical agents with unique IDs", () => {
    const catalog = getDeveloperTeamCatalog();

    expect(catalog).toHaveLength(7);

    const ids = catalog.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(7);
  });

  test("contains required agent IDs in correct order", () => {
    const catalog = getDeveloperTeamCatalog();
    const ids = catalog.map((a) => a.id);

    expect(ids).toEqual([
      "deck-lead",
      "deck-investigate",
      "deck-architect",
      "deck-apply-fast",
      "deck-apply-deep",
      "deck-quality",
      "deck-setup",
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
