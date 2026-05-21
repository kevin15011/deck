import { describe, expect, test } from "bun:test";

import { getTeamsForEnvironment, OPENCODE_DEVELOPMENT_TEAMS } from "./team-catalog";

describe("Team catalog", () => {
  test("OpenCode Development Environment includes Developer Team", () => {
    const teams = getTeamsForEnvironment("opencode-development");

    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe("developer-team");
    expect(teams[0].displayName).toBe("Developer Team");
    expect(teams[0].description).toBeTruthy();
  });

  test("non-OpenCode environments return empty team list", () => {
    expect(getTeamsForEnvironment("unknown")).toHaveLength(0);
    expect(getTeamsForEnvironment("pi-development")).toHaveLength(0);
  });

  test("each team entry has id, displayName, and description", () => {
    for (const team of OPENCODE_DEVELOPMENT_TEAMS) {
      expect(team.id).toBeTruthy();
      expect(team.displayName).toBeTruthy();
      expect(team.description).toBeTruthy();
    }
  });
});