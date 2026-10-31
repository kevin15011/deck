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
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      expect(getAgentContent(agent.id)).toEqual(getAgentContent(agent.id, { promptProfile: "compact" }));
    }
    expect(getTeamSessionInstructions("developer-team")).toBe(
      getTeamSessionInstructions("developer-team", { promptProfile: "compact" }),
    );
  });

  test("keeps Git discard protection exact on every installed agent surface", () => {
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      expect(getAgentContent(agent.id)!.agentBody, agent.id).toContain(GIT_DISCARD_PROTECTION_RULE);
    }
  });

  test("preserves capability provider filtering for the new roles", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);
    const apply = getAgentContent("deck-apply-fast", { capabilityInstructions: bundle })!;
    const investigate = getAgentContent("deck-investigate", { capabilityInstructions: bundle })!;
    expect(`${apply.agentBody}\n${apply.skillBody}`).toContain("Code Economy");
    expect(`${investigate.agentBody}\n${investigate.skillBody}`).not.toContain("Code Economy");
  });

  test("bounds aggregate installed content including the doctrine and setup policy", () => {
    const compact = generatedStaticContent("compact");
    // Includes the <=1.5 KB core on 15 agent, skill and session surfaces.
    expect(Buffer.byteLength(compact)).toBeLessThan(175_000);
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
