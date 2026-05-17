import { describe, expect, test } from "bun:test";

import { ALL_TEAMS, DEVELOPER_TEAM, getTeamById } from "./team-catalog";

describe("Team catalog (canonical)", () => {
  test("DEVELOPER_TEAM has correct fields", () => {
    expect(DEVELOPER_TEAM.id).toBe("developer-team");
    expect(DEVELOPER_TEAM.displayName).toBe("Developer Team");
    expect(DEVELOPER_TEAM.description).toBeTruthy();
  });

  test("ALL_TEAMS includes Developer Team", () => {
    expect(ALL_TEAMS).toHaveLength(1);
    expect(ALL_TEAMS[0].id).toBe("developer-team");
  });

  test("getTeamById returns Developer Team", () => {
    const team = getTeamById("developer-team");
    expect(team).toBeDefined();
    expect(team?.id).toBe("developer-team");
  });

  test("getTeamById returns undefined for unknown team", () => {
    expect(getTeamById("unknown-team")).toBeUndefined();
  });

  test("each team entry has id, displayName, and description", () => {
    for (const team of ALL_TEAMS) {
      expect(team.id).toBeTruthy();
      expect(team.displayName).toBeTruthy();
      expect(team.description).toBeTruthy();
    }
  });
});
