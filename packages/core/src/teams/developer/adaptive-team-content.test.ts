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
