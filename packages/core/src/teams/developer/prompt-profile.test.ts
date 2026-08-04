import { describe, expect, test } from "bun:test";

import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import {
  PROMPT_RUNTIME_CONTROL_MAP_V1,
  getAgentContent,
  getTeamSessionInstructions,
  type DeveloperTeamPromptProfileV1,
} from "./content-registry";
import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety";
import { buildCapabilityInstructionBundle } from "./instruction-bundles";
import {
  consumeExecutionRoleResultV1,
  createInvocationAuthorizationServiceV1,
  createRegistryCoordinatorV1,
  evaluateExecutionDecisionV1,
  evaluateFreshnessPolicyV1,
  selectExecutionLaneV1,
  transitionStagedVerificationV1,
} from "../../../../sdd-runtime/src";

const ROLE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  "deck-lead": ["smallest safe route", "Working Brief"],
  "deck-investigate": ["production path", "compact handoff"],
  "deck-architect": ["Full SDD", "Do not plan by file count"],
  "deck-apply-fast": ["Proportional TDD", "vertical slice"],
  "deck-apply-deep": ["algorithms", "wiring defect"],
  "deck-quality": ["read-only", "not a universal gate"],
  "deck-setup": ["once per session", "Repair only the degraded component"],
};

function generatedStaticContent(profile: DeveloperTeamPromptProfileV1): string {
  const parts = DEVELOPER_TEAM_AGENTS.flatMap((agent) => {
    const content = getAgentContent(agent.id, { promptProfile: profile });
    if (!content) throw new Error(`missing content: ${agent.id}`);
    return [content.agentBody, content.skillBody];
  });
  parts.push(getTeamSessionInstructions("developer-team", { promptProfile: profile }) ?? "");
  return parts.join("\n\0\n");
}

describe("Adaptive Developer Team prompt profile", () => {
  test("uses the adaptive compact profile by default for exactly seven roles", () => {
    expect(DEVELOPER_TEAM_AGENTS).toHaveLength(7);
    expect(Object.keys(ROLE_MARKERS).sort()).toEqual(DEVELOPER_TEAM_AGENTS.map((agent) => agent.id).sort());
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      expect(getAgentContent(agent.id)).toEqual(getAgentContent(agent.id, { promptProfile: "compact" }));
    }
    expect(getTeamSessionInstructions("developer-team")).toBe(
      getTeamSessionInstructions("developer-team", { promptProfile: "compact" }),
    );
  });

  test("materializes a concise role-specific body and shared contract for every role", () => {
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      const content = getAgentContent(agent.id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(content.agentBody, agent.id).toContain("## Adaptive Developer Team Contract");
      expect(content.skillBody, agent.id).toContain("## Team Contract Reference");
      for (const marker of ROLE_MARKERS[agent.id]!) {
        expect(combined, `${agent.id}:${marker}`).toContain(marker);
      }
    }
  });

  test("keeps Git discard protection exact on every installed agent surface", () => {
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      expect(getAgentContent(agent.id)!.agentBody, agent.id).toContain(GIT_DISCARD_PROTECTION_RULE);
    }
  });

  test("preserves adaptive activation instead of recreating a fixed phase chain", () => {
    const lead = getTeamSessionInstructions("developer-team")!;
    expect(lead).toContain("You may implement a clear, reversible, low-risk change directly");
    expect(lead).toContain("Investigate does not force Architect");
    expect(lead).toContain("Quality is not a universal gate");
    expect(lead).toContain("Treat an in-scope reversible follow-up as a delta");
    expect(lead).not.toContain("Proposal → Spec → Design → Tasks");
  });

  test("keeps proportional TDD in both Apply roles", () => {
    for (const agentId of ["deck-apply-fast", "deck-apply-deep"] as const) {
      const combined = Object.values(getAgentContent(agentId)!).join("\n");
      expect(combined).toContain("## Proportional TDD");
      expect(combined).toContain("demonstrate RED");
      expect(combined).toContain("default production composition");
      expect(combined).toContain("never manufacture an artificial RED");
    }
  });

  test("preserves capability provider filtering for the new roles", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);
    const apply = getAgentContent("deck-apply-fast", { capabilityInstructions: bundle })!;
    const investigate = getAgentContent("deck-investigate", { capabilityInstructions: bundle })!;
    expect(`${apply.agentBody}\n${apply.skillBody}`).toContain("Code Economy");
    expect(`${investigate.agentBody}\n${investigate.skillBody}`).not.toContain("Code Economy");
  });

  test("keeps the complete seven-role installed surface below the former static baseline", () => {
    const compact = generatedStaticContent("compact");
    expect(Buffer.byteLength(compact)).toBeLessThan(150_000);
    expect(Buffer.byteLength(compact)).toBeLessThan(518_742);
  });

  test("maps every condensed procedural rule to an active runtime control", () => {
    const activeControls: Record<string, unknown> = {
      "invocation-authorization-service-v1": createInvocationAuthorizationServiceV1,
      "execution-decision-policy-v1": evaluateExecutionDecisionV1,
      "registry-coordinator-v1": createRegistryCoordinatorV1,
      "staged-verification-state-v1": transitionStagedVerificationV1,
      "freshness-policy-v1": evaluateFreshnessPolicyV1,
      "execution-lane-policy-v1": selectExecutionLaneV1,
      "execution-role-result-v1": consumeExecutionRoleResultV1,
    };
    for (const entry of PROMPT_RUNTIME_CONTROL_MAP_V1) {
      if (entry.promptTreatment === "runtime-condensed") {
        expect(entry.runtimeActive, entry.ruleId).toBe(true);
        expect(typeof activeControls[entry.runtimeControl], entry.ruleId).toBe("function");
      } else {
        expect(entry.ruleId).toBe("git-safety");
      }
    }
  });
});
