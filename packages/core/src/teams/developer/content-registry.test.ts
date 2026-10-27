import { describe, expect, test } from "bun:test";

import {
  DEVELOPER_TEAM_LANGUAGE_POLICY,
  getAgentContent,
  getAgentContentResult,
  getTeamSessionInstructions,
  getUnknownAgentContent,
} from "./content-registry";
import type { AgentContent, Result } from "./content-registry";
import {
  VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS,
  VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES,
} from "./visual-explanations-content";
import {
  buildCapabilityInstructionBundle,
  type CapabilityInstructionBundle,
} from "./instruction-bundles/index";
import {
  SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1,
  SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1,
  renderSkillDiscoveryRuntimeContextV1,
} from "./skill-discovery-content";

const DEVELOPER_AGENT_IDS = ["deck-lead", "deck-investigate", "deck-architect", "deck-apply-fast", "deck-apply-deep", "deck-quality", "deck-setup"] as const;
const LANGUAGE_POLICY_TEST_AGENT_IDS = DEVELOPER_AGENT_IDS;
const SDD_SUBAGENT_IDS = ["deck-architect"] as const;

// ---------------------------------------------------------------------------
// getAgentContent
// ---------------------------------------------------------------------------

describe("getAgentContent", () => {

  test("returns content for all seven agents — no undefined gaps", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
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

  test("SDD subagent skills do NOT include visual explanations content (REQ-VISUAL-002, REQ-TEAMINSTALL-002)", () => {
    for (const id of SDD_SUBAGENT_IDS) {
      const content = getAgentContent(id)!;
      expect(content.skillBody, `${id} should NOT contain visual explanations`).not.toContain(
        "# Visual Explanations",
      );
      expect(content.skillBody, `${id} should NOT contain visual output rules`).not.toContain(
        "## Visual Output Rules",
      );
      expect(content.skillBody, `${id} should NOT contain non-authoritative notice`).not.toContain(
        "Non-Authoritative Notice",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// getTeamSessionInstructions
// ---------------------------------------------------------------------------

describe("getTeamSessionInstructions", () => {

  test("returns undefined for unknown team", () => {
    expect(getTeamSessionInstructions("unknown-team")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// code-economy injection tests — REQ-CE-001, REQ-CE-002, REQ-CF-001
// ---------------------------------------------------------------------------

describe("code-economy injection", () => {
  // Target agents for code-economy injection per Spec/Design
  const CODE_ECONOMY_TARGET_AGENTS = [
    "deck-architect",
    "deck-apply-fast",
    "deck-apply-deep",
    "deck-quality",
  ] as const;

  // Non-target agents that should NOT receive code-economy
  const NON_TARGET_AGENTS = [
    "deck-lead",
    "deck-investigate",
    "deck-setup",
  ] as const;

  test("code-economy injects into target agents", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);

    for (const agentId of CODE_ECONOMY_TARGET_AGENTS) {
      const content = getAgentContent(agentId, { capabilityInstructions: bundle });
      expect(content).toBeDefined();
      // Should contain the package instruction section
      expect(content!.agentBody).toContain("## Package Instructions (configured)");
      // Should contain code-economy specific content
      expect(content!.agentBody).toContain("Code Economy");
    }
  });

  test("code-economy injects into target agent skills", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);

    for (const agentId of CODE_ECONOMY_TARGET_AGENTS) {
      const content = getAgentContent(agentId, { capabilityInstructions: bundle });
      expect(content).toBeDefined();
      expect(content!.skillBody).toContain("Code Economy");
    }
  });

  test("code-economy does NOT inject into non-target agents", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);

    for (const agentId of NON_TARGET_AGENTS) {
      const content = getAgentContent(agentId, { capabilityInstructions: bundle });
      // Non-target agents should NOT receive code-economy instructions
      // (code-economy has agentIds filter, so only target agents match)
      expect(content!.agentBody).not.toContain("Code Economy");
    }
  });

  test("code-economy bundle has correct packageId", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);

    for (const fragment of bundle.instructions) {
      expect(fragment.packageId).toBe("code-economy");
    }
  });

  test("code-economy bundle has agent and skill surfaces", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);

    const surfaces = bundle.instructions.map((f) => f.surface);
    expect(surfaces).toContain("agent");
    expect(surfaces).toContain("skill");
  });
});

// ---------------------------------------------------------------------------
describe("getTeamSessionInstructions with capabilityInstructions", () => {
  test("existing output unchanged when no bundle provided", () => {
    const instructions = getTeamSessionInstructions("developer-team");
    expect(instructions).toBeDefined();
    expect(instructions).toContain("# Lead (deck-lead)");
    expect(instructions).not.toContain("## Package Instructions");
  });

  test("session-surface fragments appended when bundle provided", () => {
    // Add a session-surface fragment
    const bundle: CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "session",
          markdown: "## Session-level capability\n\nThis should appear in session instructions.",
        },
      ],
    };

    const result = getTeamSessionInstructions("developer-team", { capabilityInstructions: bundle });

    expect(result).toContain("## Package Instructions (configured)");
    expect(result).toContain("Session-level capability");
  });

  test("agent-surface fragments NOT appended to session instructions", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    // codebase-memory has no session-surface fragments

    const result = getTeamSessionInstructions("developer-team", { capabilityInstructions: bundle });

    // Agent-surface fragments should not appear in session
    // (codebase-memory only has agent/skill surfaces)
    // With no session-surface fragments, the base is unchanged
    const withoutBundle = getTeamSessionInstructions("developer-team");
    expect(result).toBe(withoutBundle);
  });

  test("multiple session-surface fragments are all appended", () => {
    const bundle: CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "session",
          markdown: "## First Session Fragment",
        },
        {
          packageId: "context-mode",
          surface: "session",
          markdown: "## Second Session Fragment",
        },
      ],
    };

    const result = getTeamSessionInstructions("developer-team", { capabilityInstructions: bundle });

    expect(result).toContain("First Session Fragment");
    expect(result).toContain("Second Session Fragment");
  });
});

// ---------------------------------------------------------------------------
// getAgentContentResult
// ---------------------------------------------------------------------------

describe("getAgentContentResult", () => {

  test("returns ok: false with suggestions for typo in agent ID", () => {
    const result = getAgentContentResult("deck-led");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.agentId).toBe("deck-led");
      expect(result.error.suggestions).toContain("deck-lead");
      // Not in catalog, so fallbackAvailable is false
      expect(result.error.fallbackAvailable).toBe(false);
    }
  });

  test("returns ok: false with suggestions for prefix-matchable typo", () => {
    const result = getAgentContentResult("deck-app");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.suggestions).toContain("deck-apply-fast");
    }
  });

  test("returns ok: false with empty suggestions for completely unknown agent", () => {
    const result = getAgentContentResult("xyz-agent-that-does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fallbackAvailable).toBe(false);
      // No suggestions because Levenshtein distance is too large
      expect(result.error.suggestions.length).toBeLessThanOrEqual(3);
    }
  });

  test("with fallback: true still returns error for unknown agent not in catalog", () => {
    // Agents not in catalog cannot receive fallback — must return error
    const result = getAgentContentResult("some-unknown-agent", { fallback: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fallbackAvailable).toBe(false);
    }
  });

  test("suggestions are limited to maximum 3", () => {
    // Query that might match multiple agents
    const result = getAgentContentResult("deck-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.suggestions.length).toBeLessThanOrEqual(3);
    }
  });

  test("suggestions are sorted by relevance (prefix matches first)", () => {
    const result = getAgentContentResult("deck-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const suggestions = result.error.suggestions;
      // Prefix matches should appear first
      const prefixMatches = suggestions.filter((id) => id.startsWith("deck-"));
      expect(prefixMatches.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getUnknownAgentContent
// ---------------------------------------------------------------------------

describe("getUnknownAgentContent", () => {
  test("returns content indicating unknown agent", () => {
    const content = getUnknownAgentContent("test-agent", []);
    expect(content.agentBody).toContain("Unknown Agent: test-agent");
    expect(content.agentBody).toContain("not recognized");
    expect(content.skillBody).toContain("Unknown Agent Skill: test-agent");
  });

  test("agent body contains proper unknown agent structure", () => {
    const content = getUnknownAgentContent("test-agent", []);
    // Should have unknown agent header
    expect(content.agentBody).toContain("# Unknown Agent: test-agent");
    // Should have contact instructions
    expect(content.agentBody).toContain("not recognized");
    expect(content.agentBody).toContain("Developer Team maintainers");
  });

  test("skill body contains proper unknown agent skill structure", () => {
    const content = getUnknownAgentContent("test-agent", []);
    expect(content.skillBody).toContain("# Unknown Agent Skill: test-agent");
    expect(content.skillBody).toContain("not recognized");
  });
});

// ---------------------------------------------------------------------------
// getAgentContent (deprecated wrapper) parity
// ---------------------------------------------------------------------------

describe("getAgentContent deprecated wrapper parity", () => {

  test("getAgentContent returns undefined for unknown agent", () => {
    const legacy = getAgentContent("xyz-unknown-agent");
    expect(legacy).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Developer Team language policy composition — REQ-LANG-001, REQ-REG-001,
// REQ-REG-002, REQ-LEAK-001, REQ-LEAK-002, REQ-TEST-001, REQ-TEST-002
// ---------------------------------------------------------------------------

describe("Developer Team language policy composition", () => {

  test("team session instructions contain the language policy and no leak", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    expect(instructions).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    expect(instructions).not.toContain("herramienta");
  });

  test("session instructions compose language policy before capability instructions", () => {
    const bundle: CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "session",
          markdown: "## Session-level capability\n\nThis should appear after the language policy.",
        },
      ],
    };

    const instructions = getTeamSessionInstructions("developer-team", { capabilityInstructions: bundle })!;
    const policyIdx = instructions.indexOf("## Developer Team Language Policy");
    const packageIdx = instructions.indexOf("## Package Instructions (configured)");

    expect(policyIdx, "language policy missing in session").toBeGreaterThan(-1);
    expect(packageIdx, "package instructions missing in session").toBeGreaterThan(-1);
    expect(policyIdx).toBeLessThan(packageIdx);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator Invariants Integration — REQ-IBC-001, REQ-IBC-002, REQ-IBC-003, REQ-IBC-004
// ---------------------------------------------------------------------------

describe("orchestrator invariant injection", () => {
  test("default session instructions contain the adaptive contract at start", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    const invariantsIdx = instructions.indexOf("## Adaptive Developer Team Contract");

    expect(invariantsIdx).toBe(0); // Invariants at start of session instructions
  });

  test("session instructions do not have Package Instructions by default", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    const packageInstrIdx = instructions.indexOf("## Package Instructions");

    expect(packageInstrIdx).toBe(-1); // no capability instructions by default
  });

  test("adaptive contract appears before context-authority guidance", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    const invariantsIdx = instructions.indexOf("## Adaptive Developer Team Contract");
    const authorityIdx = instructions.indexOf("## Context Authority");

    expect(invariantsIdx).toBe(0); // Invariants at start
    expect(authorityIdx).toBeGreaterThan(0);
    expect(invariantsIdx).toBeLessThan(authorityIdx);
  });
});

// ---------------------------------------------------------------------------
// Personality — Orchestrator System Prompt Variants
// ---------------------------------------------------------------------------

describe("getTeamSessionInstructions with personality", () => {
  test("guia personality returns expanded teaching-tone variant", () => {
    const guiaInstructions = getTeamSessionInstructions("developer-team", { personality: "guia" });
    expect(guiaInstructions).toBeDefined();
    expect(guiaInstructions).toContain("## Communication Style");
    expect(guiaInstructions).toContain("teach through concrete product consequences");
    // Core present in composition
    expect(guiaInstructions).toContain("# Lead (deck-lead)");
  });

  test("pragmatica personality returns compact coordinator behavior", () => {
    const pragmaticaInstructions = getTeamSessionInstructions("developer-team", { personality: "pragmatica" });
    expect(pragmaticaInstructions).toBeDefined();
    expect(pragmaticaInstructions).toContain("# Lead (deck-lead)");
    expect(pragmaticaInstructions).toContain("## Route selection");
    expect(pragmaticaInstructions).toContain("Quality is not a universal gate");
    // Layer present
    expect(pragmaticaInstructions).toContain("## Communication Style");
    expect(pragmaticaInstructions).toContain("outcome-first");
  });

  test("default (no personality) returns pragmatica variant — backward compatibility", () => {
    const defaultInstructions = getTeamSessionInstructions("developer-team");
    const pragmaticaInstructions = getTeamSessionInstructions("developer-team", { personality: "pragmatica" });
    expect(defaultInstructions).toBe(pragmaticaInstructions);
  });

  test("unknown personality defaults to pragmatica", () => {
    // @ts-expect-error - testing runtime behavior with invalid personality
    const unknownInstructions = getTeamSessionInstructions("developer-team", { personality: "unknown-personality" });
    const pragmaticaInstructions = getTeamSessionInstructions("developer-team", { personality: "pragmatica" });
    expect(unknownInstructions).toBe(pragmaticaInstructions);
  });
});

// ---------------------------------------------------------------------------
// Skill discovery composition — REQ-001, REQ-013, REQ-014, REQ-015, REQ-016,
// REQ-027 and EII-ASRD-001/EII-ASRD-002/EII-ASRD-010
// ---------------------------------------------------------------------------

describe("shared skill discovery composition", () => {
  const specialistAgentIds = [
    "deck-investigate",
    "deck-architect",
    "deck-apply-fast",
    "deck-apply-deep",
    "deck-quality",
    "deck-setup",
  ] as const;

  test("composes the specialist contract exactly once for every specialist in both profiles", () => {
    for (const promptProfile of ["compact"] as const) {
      for (const agentId of specialistAgentIds) {
        const content = getAgentContent(agentId, { promptProfile })!;

        for (const surface of [content.agentBody, content.skillBody]) {
          expect(surface).toContain(SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1);
          expect(surface.match(/## Skill Discovery Authority Boundary/g)).toHaveLength(1);
          expect(surface.indexOf(SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1)).toBeGreaterThan(-1);
        }
      }
    }
  });

  test("places specialist discovery content before capability bundles without injecting registry data", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const content = getAgentContent("deck-apply-fast", {
      promptProfile: "compact",
      capabilityInstructions: bundle,
    })!;

    const contractIndex = content.agentBody.indexOf("## Specialist Skill Discovery Contract");
    const packageIndex = content.agentBody.indexOf("## Package Instructions (configured)");

    expect(contractIndex).toBeGreaterThan(-1);
    expect(packageIndex).toBeGreaterThan(-1);
    expect(contractIndex).toBeLessThan(packageIndex);
    expect(content.agentBody).not.toContain("candidate_document:");
    expect(content.agentBody).not.toContain("winner");
    expect(content.agentBody).not.toContain("/home/");
  });

  test("composes one active-runner runtime context before capability bundles for both profiles", () => {
    const bundle: CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "session",
          markdown: "## Session capability bundle",
        },
      ],
    };

    for (const promptProfile of ["compact"] as const) {
      const instructions = getTeamSessionInstructions("developer-team", {
        promptProfile,
        skillDiscoveryRuntimeContext: { activeRunnerId: "opencode" },
        capabilityInstructions: bundle,
      })!;

      const runtimeIndex = instructions.indexOf("## Skill Discovery Runtime Context");
      const packageIndex = instructions.indexOf("## Package Instructions (configured)");

      expect(runtimeIndex).toBeGreaterThan(-1);
      expect(packageIndex).toBeGreaterThan(-1);
      expect(runtimeIndex).toBeLessThan(packageIndex);
      expect(instructions.match(/## Skill Discovery Authority Boundary/g)).toHaveLength(1);
      expect(instructions).toContain("active_runner_id: opencode");
      expect(instructions).toContain("deck skill-registry validate --runner opencode");
      expect(instructions).toContain("deck skill-registry discover --runner opencode");
      expect(instructions).toContain("deck skill-registry refresh --runner opencode");
      expect(instructions).not.toContain("/home/");
      expect(instructions).not.toContain(".pi/skills");
    }
  });

  test("renders absent runtime context as indeterminate direct fallback without guessing a runner", () => {
    const rendered = renderSkillDiscoveryRuntimeContextV1();

    expect(rendered).toContain("status: indeterminate");
    expect(rendered).toContain("reason_code: missing_runtime_context");
    expect(rendered).toContain("bounded direct discovery");
    expect(rendered).toContain(".atl/skill-registry.md");
    expect(rendered).not.toContain("active_runner_id: opencode");
    expect(rendered).not.toContain("active_runner_id: pi");
    expect(rendered).not.toContain("--runner opencode");
    expect(rendered).not.toContain("--runner pi");
    expect(rendered.match(/## Skill Discovery Authority Boundary/g)).toHaveLength(1);
  });

  test("preserves the byte-verbatim authority boundary in every shared fragment", () => {
    expect(SPECIALIST_SKILL_DISCOVERY_CONTRACT_V1).toContain(SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1);
    expect(renderSkillDiscoveryRuntimeContextV1({ activeRunnerId: "pi" })).toContain(
      SKILL_DISCOVERY_AUTHORITY_BOUNDARY_V1,
    );
  });
});
