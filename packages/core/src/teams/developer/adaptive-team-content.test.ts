import { describe, expect, test } from "bun:test";

import { getDeveloperTeamCatalog } from "./catalog";
import { getAgentContent, getTeamSessionInstructions } from "./content-registry";

describe("adaptive Developer Team installed content", () => {
  test("all seven roles have concise non-placeholder content", () => {
    for (const agent of getDeveloperTeamCatalog()) {
      const content = getAgentContent(agent.id);
      expect(content).toBeDefined();
      expect(content!.agentBody).toContain(agent.displayName);
      expect(content!.agentBody).not.toContain("Placeholder:");
      expect(content!.agentBody).toContain("specialists load the applicable execution skills themselves");
      expect(content!.agentBody).toContain("do not reread content already supplied in their instructions");
      expect(content!.skillBody).toContain("The agent-level Adaptive Developer Team Contract remains binding for this skill");
      expect(content!.agentBody.length).toBeLessThan(agent.id === "deck-setup" ? 24_000 : 12_000);
    }
  });

  test("Lead owns proportional routing, direct deltas, and centralized OpenSpec persistence", () => {
    const session = getTeamSessionInstructions("developer-team")!;
    expect(session).toContain("deck-lead");
    expect(session).toContain("direct");
    expect(session).toContain("delta");
    expect(session).toContain("Working Brief");
    expect(session).toContain("Full SDD");
    expect(session).toContain("centralized writer");
    expect(session).not.toContain("all 14");
    expect(session).not.toContain("one agent per task");
  });

  test("shared Lead surfaces route without preloading specialist execution skills", () => {
    const lead = getAgentContent("deck-lead")!;
    const surfaces = [lead.agentBody, lead.skillBody, getTeamSessionInstructions("developer-team")!];
    for (const body of surfaces) {
      expect(body).toContain("## Skill loading and context ownership");
      expect(body).toContain("Do not load full specialist execution skills merely to select, brief, or monitor a delegate");
      expect(body).toContain("When implementing directly, load the execution skills relevant to your own work");
      expect(body).toContain("Reading a skill in Lead does not load it for the child");
      expect(body).toContain("This does not bypass mandatory safety checks");
      expect(body).not.toContain("Pi background delegation");
    }
    expect(getTeamSessionInstructions("developer-team")).toContain("specialists load the applicable execution skills themselves");
  });

  test("Apply owns proportional TDD and vertical implementation", () => {
    for (const id of ["deck-apply-fast", "deck-apply-deep"]) {
      const body = getAgentContent(id)!.agentBody;
      expect(body).toContain("RED");
      expect(body).toContain("GREEN");
      expect(body).toContain("vertical");
      expect(body).toContain("characterization");
      expect(body).toContain("artificial");
    }
  });

  test("Quality is protected-risk driven and read-only rather than universal", () => {
    const body = getAgentContent("deck-quality")!.agentBody;
    expect(body).toContain("read-only");
    expect(body).toContain("protected");
    expect(body).toContain("not a universal gate");
  });

  test("Setup performs one cached readiness pass and repairs only degraded components", () => {
    const body = getAgentContent("deck-setup")!.agentBody;
    expect(body).toContain("once per session");
    expect(body).toContain("missing");
    expect(body).toContain("stale");
    expect(body).toContain("invalid");
    expect(body).toContain("indeterminate");
    expect(body).toContain(".atl/skill-registry.md");
    expect(body).toContain("Codebase Memory");
    expect(body).toContain("Serena");
  });
});
