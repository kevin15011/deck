import { describe, expect, test } from "bun:test";

import { getAgentContent, getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";

import { buildDeveloperTeamInstallPlan } from "./developer-team-install";
import { buildTeamSystemPrompt } from "./pi-team-profile";

/**
 * These tests verify that the adapter consumes the core registry
 * instead of hardcoding agent/team content branches.
 *
 * The contract: adapter file content MUST match what the registry returns.
 * If the registry changes, adapter output changes automatically.
 */

// ---------------------------------------------------------------------------
// Table-driven helper for real-content agents
// ---------------------------------------------------------------------------

const REAL_CONTENT_AGENTS: ReadonlyArray<{
  id: string;
  agentTitle: string;
  skillTitle: string;
}> = [
  { id: "deck-developer-orchestrator", agentTitle: "# Orchestrator Agent", skillTitle: "# Orchestrator Skill" },
  { id: "deck-developer-explorer", agentTitle: "# Explorer Agent", skillTitle: "# Explorer Skill" },
  { id: "deck-developer-proposal", agentTitle: "# Proposal Agent", skillTitle: "# Proposal Skill" },
  { id: "deck-developer-spec", agentTitle: "# Spec Agent", skillTitle: "# Spec Skill" },
  { id: "deck-developer-design", agentTitle: "# Design Agent", skillTitle: "# Design Skill" },
];

describe("Adapter consumes core registry for agent content", () => {
  // Task 7.2: orchestrator uses stub content instead of full registry body
  const AGENTS_WITH_FULL_BODY = REAL_CONTENT_AGENTS.filter((a) => a.id !== "deck-developer-orchestrator");

  for (const { id, agentTitle, skillTitle } of AGENTS_WITH_FULL_BODY) {
    test(`${id}: agent body matches core registry`, () => {
      const plan = buildDeveloperTeamInstallPlan("/tmp/project");
      const agent = plan.agents.find((a) => a.agent.id === id)!;
      const registry = getAgentContent(id)!;

      expect(agent.content).toContain(registry.agentBody);
    });

    test(`${id}: skill body matches core registry`, () => {
      const plan = buildDeveloperTeamInstallPlan("/tmp/project");
      const skill = plan.skills.find((s) => s.agent.id === id)!;
      const registry = getAgentContent(id)!;

      expect(skill.content).toContain(registry.skillBody);
    });

    test(`${id}: no placeholder signals in agent or skill`, () => {
      const plan = buildDeveloperTeamInstallPlan("/tmp/project");
      const agent = plan.agents.find((a) => a.agent.id === id)!;
      const skill = plan.skills.find((s) => s.agent.id === id)!;

      expect(agent.content).not.toContain("Placeholder");
      expect(agent.content).toContain(agentTitle);
      expect(agent.content).toContain(id);
      expect(skill.content).not.toContain("Placeholder");
      expect(skill.content).toContain(skillTitle);
    });
  }

  // Task 7.2: orchestrator has stub content referencing profile system prompt
  test("deck-developer-orchestrator: uses stub content (Task 7.2)", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;

    // Orchestrator stub references the profile's system prompt
    expect(orchestrator.content).toContain("session context loaded from the team profile");
    expect(orchestrator.content).toContain(".deck/pi/profiles/<team>/system-prompt.md");
    expect(orchestrator.content).toContain("--system-prompt");
    // Does NOT contain full registry body
    expect(orchestrator.content).not.toContain("## Orchestrator Invariants");
  });

  test("all non-orchestrator agent file bodies come from core registry", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      if (planned.agent.id === "deck-developer-orchestrator") continue; // Task 7.2: stub content
      const registry = getAgentContent(planned.agent.id);
      expect(registry).toBeDefined();
      expect(planned.content).toContain(registry!.agentBody);
    }
  });

  test("all skill file bodies come from core registry", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.skills) {
      const registry = getAgentContent(planned.agent.id);
      expect(registry).toBeDefined();
      expect(planned.content).toContain(registry!.skillBody);
    }
  });
});

describe("Adapter consumes core registry for team session instructions", () => {
  test("developer-team system prompt matches core registry (without memory)", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    const registry = getTeamSessionInstructions("developer-team")!;

    expect(content).toBe(registry);
  });
});