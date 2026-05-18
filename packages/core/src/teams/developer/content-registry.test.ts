import { describe, expect, test } from "bun:test";

import { getAgentContent, getTeamSessionInstructions } from "./content-registry";

// ---------------------------------------------------------------------------
// getAgentContent
// ---------------------------------------------------------------------------

describe("getAgentContent", () => {
  test("returns content for orchestrator agent", () => {
    const content = getAgentContent("deck-developer-orchestrator");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Orchestrator Agent");
    expect(content!.skillBody).toContain("# Orchestrator Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
  });

  test("returns content for explorer agent", () => {
    const content = getAgentContent("deck-developer-explorer");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Explorer Agent");
    expect(content!.skillBody).toContain("# Explorer Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
  });

  test("returns real content for proposal agent", () => {
    const content = getAgentContent("deck-developer-proposal");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Proposal Agent");
    expect(content!.skillBody).toContain("# Proposal Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
  });

  test("returns real content for spec agent", () => {
    const content = getAgentContent("deck-developer-spec");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Spec Agent");
    expect(content!.skillBody).toContain("# Spec Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
    // Not placeholder
    expect(content!.agentBody).not.toContain("Placeholder");
    expect(content!.skillBody).not.toContain("Placeholder");
  });

  test("returns real content for design agent", () => {
    const content = getAgentContent("deck-developer-design");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Design Agent");
    expect(content!.skillBody).toContain("# Design Skill");
    expect(content!.agentBody.length).toBeGreaterThan(200);
    expect(content!.skillBody.length).toBeGreaterThan(200);
    // Not placeholder
    expect(content!.agentBody).not.toContain("Placeholder");
    expect(content!.skillBody).not.toContain("Placeholder");
  });

  test("returns content for all 12 agents — no undefined gaps", () => {
    const agentIds = [
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
    ];

    for (const id of agentIds) {
      const content = getAgentContent(id);
      expect(content).toBeDefined();
      expect(content!.agentBody).toBeTruthy();
      expect(content!.skillBody).toBeTruthy();
    }
  });

  test("returns undefined for unknown agent ID", () => {
    expect(getAgentContent("unknown-agent")).toBeUndefined();
    expect(getAgentContent("deck-orchestrator")).toBeUndefined();
  });

  test("all catalog agent content is not placeholder", () => {
    const agentIds = [
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
    ];

    for (const id of agentIds) {
      const content = getAgentContent(id)!;
      expect(content.agentBody).not.toContain("Placeholder");
      expect(content.skillBody).not.toContain("Placeholder");
    }
  });

  test("real agents contain their display name", () => {
    const proposal = getAgentContent("deck-developer-proposal")!;
    expect(proposal.agentBody).toContain("Proposal Agent");

    const verify = getAgentContent("deck-developer-verify")!;
    expect(verify.agentBody).toContain("Verify Agent");
  });
});

// ---------------------------------------------------------------------------
// getTeamSessionInstructions
// ---------------------------------------------------------------------------

describe("getTeamSessionInstructions", () => {
  test("returns real orchestrator session instructions for developer-team", () => {
    const instructions = getTeamSessionInstructions("developer-team");
    expect(instructions).toBeDefined();
    expect(instructions).toContain("# Deck Developer Team");
    expect(instructions).toContain("deck-developer-orchestrator");
    expect(instructions).toContain("Delegation Rules");
    expect(instructions).toContain("Dependency Graph");
    // Not placeholder
    expect(instructions).not.toContain("Follow the team's established workflow");
  });

  test("returns undefined for unknown team", () => {
    expect(getTeamSessionInstructions("unknown-team")).toBeUndefined();
  });

  test("session instructions contain all agent role references", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    expect(instructions).toContain("deck-developer-explorer");
    expect(instructions).toContain("deck-developer-proposal");
    expect(instructions).toContain("deck-developer-spec");
    expect(instructions).toContain("deck-developer-design");
    expect(instructions).toContain("deck-developer-task");
    expect(instructions).toContain("deck-developer-apply-general");
    expect(instructions).toContain("deck-developer-apply-backend");
    expect(instructions).toContain("deck-developer-apply-frontend");
    expect(instructions).toContain("deck-developer-verify");
    expect(instructions).toContain("deck-developer-review");
    expect(instructions).toContain("deck-developer-archive");
  });
});
