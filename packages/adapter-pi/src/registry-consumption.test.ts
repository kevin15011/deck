import { describe, expect, test } from "bun:test";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { getAgentContent, getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";
import { buildDeveloperTeamInstallPlan } from "./developer-team-install";
import { buildTeamSystemPrompt } from "./pi-team-profile";

describe("Pi adapter consumes the canonical core registry", () => {
  test("materializes exactly the seven registry-backed agents and paired skills", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.agents.map(({ agent }) => agent.id)).toEqual(DEVELOPER_TEAM_AGENTS.map(({ id }) => id));
    expect(plan.skills.map(({ agent }) => agent.id)).toEqual(DEVELOPER_TEAM_AGENTS.map(({ id }) => id));

    for (const planned of plan.skills) {
      const registry = getAgentContent(planned.agent.id)!;
      expect(planned.content, planned.agent.id).toContain(registry.skillBody);
    }
    for (const planned of plan.agents.filter(({ agent }) => agent.id !== "deck-lead")) {
      const registry = getAgentContent(planned.agent.id)!;
      expect(planned.content, planned.agent.id).toContain(registry.agentBody);
      expect(planned.content).not.toContain("Placeholder");
    }
  });

  test("uses a lightweight Lead launch stub backed by the canonical profile", () => {
    const lead = buildDeveloperTeamInstallPlan("/tmp/project").agents
      .find(({ agent }) => agent.id === "deck-lead")!;

    expect(lead.content).toContain("# Deck Lead");
    expect(lead.content).toContain(".deck/pi/profiles/<team>/system-prompt.md");
    expect(lead.content).toContain("# Lead (deck-lead)");
    expect(lead.content).toContain("Implement clear low-risk changes directly");
  });

  test("builds the Pi system prompt from core session instructions", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toBe(getTeamSessionInstructions("developer-team", {
      skillDiscoveryRuntimeContext: { activeRunnerId: "pi" },
    })!);
  });
});
