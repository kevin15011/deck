import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import {
  PROMPT_RUNTIME_CONTROL_MAP_V1,
  getAgentContent,
  getTeamSessionInstructions,
  type DeveloperTeamPromptProfileV1,
} from "./content-registry";
import { buildCapabilityInstructionBundle } from "./instruction-bundles";
import { getOrchestratorSystemPrompt } from "./orchestrator-content";
import { DEFAULT_ORCHESTRATOR_PERSONALITY } from "../../config/deck-config";
import {
  consumeExecutionRoleResultV1,
  createInvocationAuthorizationServiceV1,
  createRegistryCoordinatorV1,
  evaluateExecutionDecisionV1,
  evaluateFreshnessPolicyV1,
  selectExecutionLaneV1,
  transitionStagedVerificationV1,
} from "../../../../sdd-runtime/src";

const LEGACY_BYTES = 365_023;
const LEGACY_LEXICAL_TOKENS = 79_051;
const LEGACY_SHA256 = "4eb4caaeb12ff0242c2e753e211cdd76bb9d3b24b610c2c512f1976ecfbc9e36";

const CONTROL_PLANE_AGENT_IDS = [
  "deck-developer-orchestrator",
  "deck-developer-apply-general",
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
  "deck-developer-verify",
  "deck-developer-review",
] as const;

const COMPACT_ROLE_MARKERS: Readonly<Record<string, readonly string[]>> = {
  "deck-developer-orchestrator": ["Triage before modifying work", "independent Verify"],
  "deck-developer-explorer": ["exploration.md", "Do not implement"],
  "deck-developer-proposal": ["proposal.md", "scope"],
  "deck-developer-spec": ["spec.md", "Given/When/Then"],
  "deck-developer-design": ["design.md", "tradeoffs"],
  "deck-developer-task": ["tasks.md", "execution"],
  "deck-developer-apply-general": ["Modification Gate", "Authorized Batch"],
  "deck-developer-apply-backend": ["Modification Gate", "Execute the Authorized Batch"],
  "deck-developer-apply-frontend": ["Modification Gate", "Execute the Authorized Batch"],
  "deck-developer-verify": ["independent Verify", "targeted"],
  "deck-developer-review": ["independent Review", "A blocking finding"],
  "deck-developer-archive": ["archive", "Archive"],
  "deck-init": ["openspec/config.yaml", "initialized"],
  "deck-onboard": ["onboarding", "interactive"],
};

function generatedStaticContent(profile: DeveloperTeamPromptProfileV1): string {
  const parts: string[] = [];
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    const content = getAgentContent(agent.id, { promptProfile: profile });
    if (!content) throw new Error(`missing content: ${agent.id}`);
    parts.push(`${agent.id}:agent\n${content.agentBody}`, `${agent.id}:skill\n${content.skillBody}`);
  }
  parts.push(`developer-team:session\n${getTeamSessionInstructions("developer-team", { promptProfile: profile })}`);
  return parts.join("\n\0\n");
}

function lexicalTokens(value: string): number {
  return value.match(/[\p{L}\p{N}_]+|[^\s]/gu)?.length ?? 0;
}

describe("Developer Team prompt profiles", () => {
  test("uses compact by default while preserving explicit legacy content", () => {
    for (const agent of DEVELOPER_TEAM_AGENTS) {
      expect(getAgentContent(agent.id)).toEqual(getAgentContent(agent.id, { promptProfile: "compact" }));
    }
    expect(getTeamSessionInstructions("developer-team", { promptProfile: "compact" }))
      .toBe(getTeamSessionInstructions("developer-team"));
    expect(getOrchestratorSystemPrompt(DEFAULT_ORCHESTRATOR_PERSONALITY))
      .toBe(getOrchestratorSystemPrompt(DEFAULT_ORCHESTRATOR_PERSONALITY, "compact"));

    const legacy = generatedStaticContent("legacy");
    expect(Buffer.byteLength(legacy)).toBe(LEGACY_BYTES);
    expect(lexicalTokens(legacy)).toBe(LEGACY_LEXICAL_TOKENS);
    expect(createHash("sha256").update(legacy).digest("hex")).toBe(LEGACY_SHA256);
  });

  test("provides a dedicated compact body for every Developer Team role", () => {
    expect(Object.keys(COMPACT_ROLE_MARKERS).sort()).toEqual(DEVELOPER_TEAM_AGENTS.map((agent) => agent.id).sort());

    for (const agent of DEVELOPER_TEAM_AGENTS) {
      const compact = getAgentContent(agent.id, { promptProfile: "compact" })!;
      const legacy = getAgentContent(agent.id, { promptProfile: "legacy" })!;
      const combined = `${compact.agentBody}\n${compact.skillBody}`;

      expect(combined, agent.id).toContain("Runtime-Enforced Team Contract");
      expect(compact.skillBody, agent.id).toContain("Runtime Contract Reference");
      expect(Buffer.byteLength(combined), agent.id)
        .toBeLessThan(Buffer.byteLength(`${legacy.agentBody}\n${legacy.skillBody}`));
      for (const marker of COMPACT_ROLE_MARKERS[agent.id]!) {
        expect(combined, `${agent.id}:${marker}`).toContain(marker);
      }
    }
  });

  test("maps every condensed procedural rule to an active runtime control", () => {
    const required = [
      "authorization",
      "decision-routing",
      "registry-writes",
      "staged-verification",
      "role-freshness",
      "risk-lanes",
      "git-safety",
      "result-envelopes",
    ];
    expect(PROMPT_RUNTIME_CONTROL_MAP_V1.map((entry) => entry.ruleId)).toEqual(required);
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
        expect(entry.runtimeActive).toBe(false);
      }
      expect(entry.runtimeControl.length, entry.ruleId).toBeGreaterThan(0);
      expect(entry.evidence.length, entry.ruleId).toBeGreaterThan(0);
    }
  });

  test("retains permanent safety and normalized return invariants in every compact role", () => {
    for (const { id: agentId } of DEVELOPER_TEAM_AGENTS) {
      const content = getAgentContent(agentId, { promptProfile: "compact" });
      expect(content, agentId).toBeDefined();
      const combined = `${content!.agentBody}\n${content!.skillBody}`;
      expect(combined, agentId).toContain("Runtime-Enforced Team Contract");
      expect(combined, agentId).toContain("OpenSpec artifacts and Spec Registry remain authoritative");
      expect(combined, agentId).toContain("Prompt text never expands modification authority");
      expect(combined, agentId).toContain("immutable phase result");
      expect(combined, agentId).toContain("FailureManifestV1");
      expect(combined, agentId).toContain("RegistryIntentV1");
      expect(combined, agentId).toContain("state.yaml");
      expect(combined, agentId).toContain("events.yaml");
      expect(combined, agentId).toContain("Git discard");
      expect(combined, agentId).toContain("matching role skill");
      expect(combined, agentId).toContain("runner-capability-standardization");
    }
  });

  test("keeps Apply modification gates usable and independent quality gates anchored", () => {
    for (const agentId of CONTROL_PLANE_AGENT_IDS.filter((id) => id.includes("apply-"))) {
      const combined = Object.values(getAgentContent(agentId, { promptProfile: "compact" })!).join("\n");
      expect(combined, agentId).toContain("Modification Gate");
      expect(combined, agentId).toContain("explicitly authorizes modifying work");
      expect(combined, agentId).not.toContain("Orchestrator will inject renderApplyAuthorizationCard()");
      expect(combined, agentId).not.toContain("If the marker remains");
      expect(combined, agentId).toContain("test-driven-development");
    }
    const verify = Object.values(getAgentContent("deck-developer-verify", { promptProfile: "compact" })!).join("\n");
    expect(verify).toContain("independent Verify");
    expect(verify).toContain("targeted");
    expect(verify).toContain("affected_area");
    expect(verify).toContain("broad");

    const review = Object.values(getAgentContent("deck-developer-review", { promptProfile: "compact" })!).join("\n");
    expect(review).toContain("independent Review");
    expect(review).toContain("explicit requirement ID");
    expect(review).toContain("related regression");
    expect(review).toContain("optional new scope");
  });

  test("removes direct centralized registry authority from compact specialists", () => {
    for (const agentId of DEVELOPER_TEAM_AGENTS.map((agent) => agent.id).filter((id) => id !== "deck-developer-orchestrator")) {
      const combined = Object.values(getAgentContent(agentId, { promptProfile: "compact" })!).join("\n");
      expect(combined, agentId).not.toContain("Update Spec Registry state/event entries");
      expect(combined, agentId).not.toContain("perform the merge/append registry update yourself");
      expect(combined, agentId).toContain("coordinator");
    }
  });

  test("preserves capability provider filtering in compact content", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);
    const apply = getAgentContent("deck-developer-apply-general", { promptProfile: "compact", capabilityInstructions: bundle })!;
    const verify = getAgentContent("deck-developer-verify", { promptProfile: "compact", capabilityInstructions: bundle })!;
    expect(`${apply.agentBody}\n${apply.skillBody}`).toContain("Code Economy");
    expect(`${verify.agentBody}\n${verify.skillBody}`).not.toContain("Code Economy");
  });

  test("reduces generated compact bytes and lexical tokens by at least 30 percent", () => {
    const legacy = generatedStaticContent("legacy");
    const compact = generatedStaticContent("compact");
    expect(Buffer.byteLength(compact)).toBeLessThanOrEqual(Math.floor(Buffer.byteLength(legacy) * 0.7));
    expect(lexicalTokens(compact)).toBeLessThanOrEqual(Math.floor(lexicalTokens(legacy) * 0.7));
  });
});
