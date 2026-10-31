import { describe, expect, test } from "bun:test";

import {
  getDeveloperTeamCatalog,
} from "./catalog";

describe("Developer Team catalog (canonical)", () => {
  test("includes exactly the seven approved agents with unique IDs", () => {
    const catalog = getDeveloperTeamCatalog();

    expect(catalog).toHaveLength(7);

    const ids = catalog.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(7);
  });

  test("all canonical IDs are short Deck IDs without the developer namespace", () => {
    const catalog = getDeveloperTeamCatalog();

    for (const agent of catalog) {
      expect(agent.id).toMatch(/^deck-[a-z-]+$/);
      expect(agent.id).not.toContain("developer");
      expect(agent.name).toBe(agent.id);
      expect(agent.skillId).toBe(agent.id);
    }
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
