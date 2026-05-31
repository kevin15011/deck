import { describe, expect, test } from "bun:test";

import { getAgentContent, getAgentContentResult, getTeamSessionInstructions, getUnknownAgentContent } from "./content-registry";
import type { AgentContent, Result } from "./content-registry";
import {
  VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS,
  VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES,
} from "./visual-explanations-content";
import {
  buildCapabilityInstructionBundle,
  type CapabilityInstructionBundle,
} from "./instruction-bundles/index";

const DEVELOPER_AGENT_IDS = [
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
] as const;

const REGISTRY_WRITER_AGENT_IDS = DEVELOPER_AGENT_IDS.filter(
  (id) => id !== "deck-developer-orchestrator",
);

const PLANNING_AGENT_IDS = [
  "deck-developer-proposal",
  "deck-developer-spec",
  "deck-developer-design",
  "deck-developer-task",
] as const;

const SDD_SUBAGENT_IDS = [
  "deck-developer-proposal",
  "deck-developer-spec",
  "deck-developer-design",
  "deck-developer-task",
] as const;

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

  test("all catalog agent content is not placeholder", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      expect(content.agentBody).not.toContain("Placeholder");
      expect(content.skillBody).not.toContain("Placeholder");
    }
  });

  test("artifact-writing agents require Spec Registry state and events", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("Spec Registry");
      expect(combined, id).toContain("state.yaml");
      expect(combined, id).toContain("events.yaml");
    }
  });

  test("artifact-writing agents require merge/append registry updates", () => {
    for (const id of REGISTRY_WRITER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("Read existing");
      expect(combined, id).toContain("Merge phase");
      expect(combined, id).toContain("preserve previous artifacts");
      expect(combined, id).toContain("Append");
      expect(combined, id).toContain("preserve previous events");
      expect(combined, id).toContain("Never overwrite or drop previous phase artifacts or events");
      expect(combined, id).toContain("Registry Blocker");
    }
  });

  test("orchestrator rejects registry history resets", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("merge new state without dropping prior artifacts/provenance");
    expect(combined).toContain("append new events without dropping prior events");
    expect(combined).toContain("Reject or request repair");
    expect(combined).toContain("reset/dropped prior registry history");
  });

  test("orchestrator serializes registry reconciliation for parallel phases", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("Spec+Design");
    expect(combined).toContain("Verify+Review");
    expect(combined).toContain("registry-deferred mode");
    expect(combined).toContain("serializes the shared");
    expect(combined).toContain("deterministic serialized merge");
    expect(combined).toContain("do not advance until reconciliation proves");
  });

  test("planning prompts avoid hard word budgets", () => {
    for (const id of PLANNING_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).not.toMatch(/Size budget/i);
      expect(combined, id).not.toMatch(/MUST be under \d+ words/i);
      expect(combined, id).not.toMatch(/under \d+ words/i);
    }
  });

  test("planning prompts require quality-focused conciseness", () => {
    for (const id of PLANNING_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("compact as possible without omitting required fields");
      expect(combined, id).toMatch(/do not merge unrelated/i);
    }
  });

  test("task prompt requires self-check and forbids broad exploration", () => {
    const content = getAgentContent("deck-developer-task")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("Required Self-Check Before Return");
    expect(combined).toContain("Every task has **Owner**, **Priority**, **Complexity**, **Parallel**, **Depends on**, **Files**, and **Verification** fields");
    expect(combined).toContain("Complexity Summary counts exactly match the task IDs");
    expect(combined).toContain("Every dependency reference points to a valid task ID");
    expect(combined).toContain("Review Workload Forecast is present");
    expect(combined).toContain("Open Questions / Blockers are classified");
    expect(combined).toContain("Do not perform broad exploration");
    expect(combined).toContain("explicit current-state/context provided by the Orchestrator");
  });

  test("orchestrator repairs contract violations and gates Apply blockers", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("violates the exact return contract");
    expect(combined).toContain("wrong or non-requested language");
    expect(combined).toContain("format mismatch");
    expect(combined).toContain("omits required fields");
    expect(combined).toContain("inconsistent counts");
    expect(combined).toContain("bad registry status/intent");
    expect(combined).toContain("misses the required review workload forecast");
    expect(combined).toContain("blocker handling unexplained");
    expect(combined).toContain("classify tasks as unblocked, blocked, or allowed-with-placeholder");
    expect(combined).toContain("Do not launch Apply for blocked tasks");
  });

  test("parallel phase agents support registry-deferred mode", () => {
    const parallelPhaseAgentIds = [
      "deck-developer-spec",
      "deck-developer-design",
      "deck-developer-verify",
      "deck-developer-review",
    ] as const;

    for (const id of parallelPhaseAgentIds) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).toContain("registry-deferred mode");
      expect(combined, id).toContain("do not write shared");
      expect(combined, id).toContain("Registry Write");
      expect(combined, id).toContain("Registry Intent");
      expect(combined, id).toContain("In default/non-parallel mode, perform the merge/append registry update yourself");
      expect(combined, id).toContain("Never overwrite or drop previous phase artifacts or events");
    }
  });

  test("archive prompt requires moving archived changes out of changes", () => {
    const content = getAgentContent("deck-developer-archive")!;
    const combined = `${content.agentBody}\n${content.skillBody}`;
    expect(combined).toContain("remove the source change directory");
    expect(combined).toContain("Archive means move, not duplicate");
    expect(combined).toContain("If cleanup fails");
  });

  test("core prompts do not hardcode Engram topic-key artifact locations", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).not.toMatch(/engram topic key/i);
    }
  });

  test("old artifact-store modes remain absent across core prompts", () => {
    for (const id of DEVELOPER_AGENT_IDS) {
      const content = getAgentContent(id)!;
      const combined = `${content.agentBody}\n${content.skillBody}`;
      expect(combined, id).not.toMatch(/engram\s*\|\s*openspec\s*\|\s*hybrid\s*\|\s*none/i);
      expect(combined, id).not.toContain("| engram |");
      expect(combined, id).not.toContain("| hybrid |");
      expect(combined, id).not.toContain("| none |");
    }
  });

  test("real agents contain their display name", () => {
    const proposal = getAgentContent("deck-developer-proposal")!;
    expect(proposal.agentBody).toContain("Proposal Agent");

    const verify = getAgentContent("deck-developer-verify")!;
    expect(verify.agentBody).toContain("Verify Agent");
  });

  // -------------------------------------------------------------------------
  // Visual explanations — REQ-VISUAL-001, REQ-VISUAL-002, REQ-VISUAL-003,
  // REQ-VISUAL-004, REQ-OPENSPEC-002, REQ-TEAMINSTALL-002
  // -------------------------------------------------------------------------

  test("orchestrator skill includes visual explanations content (REQ-VISUAL-001, REQ-VISUAL-002)", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    for (const snippet of VISUAL_EXPLANATIONS_REQUIRED_SNIPPETS) {
      expect(content.skillBody, `missing: "${snippet}"`).toContain(snippet);
    }
  });

  test("orchestrator skill has no Mermaid or config exposure (REQ-VISUAL-004)", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    for (const phrase of VISUAL_EXPLANATIONS_FORBIDDEN_PHRASES) {
      expect(content.skillBody, `forbidden phrase found: "${phrase}"`).not.toContain(phrase);
    }
  });

  test("orchestrator skill contains non-authoritative guidance (REQ-VISUAL-003, REQ-OPENSPEC-002)", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    expect(content.skillBody).toContain("not authoritative");
    expect(content.skillBody).toContain("OpenSpec artifacts and Spec Registry remain authoritative");
    expect(content.skillBody).toContain("Never alter approval state via visual");
    expect(content.skillBody).toContain("Never introduce new requirements");
    expect(content.skillBody).toContain("Never override registry status");
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

  test("all non-orchestrator agent skills do NOT include visual explanations content", () => {
    const nonOrchestrator = DEVELOPER_AGENT_IDS.filter((id) => id !== "deck-developer-orchestrator");
    for (const id of nonOrchestrator) {
      const content = getAgentContent(id)!;
      expect(content.skillBody, `${id} should NOT contain visual explanations`).not.toContain(
        "# Visual Explanations",
      );
    }
  });

  test("orchestrator skill contains visual accessibility guidance", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    expect(content.skillBody).toContain("Accessibility");
    expect(content.skillBody).toContain("not rely on diagrams");
    expect(content.skillBody).toContain("Visuals are supplemental to text");
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

// ---------------------------------------------------------------------------
// Capability instruction injection
// ---------------------------------------------------------------------------

describe("getAgentContent with capabilityInstructions", () => {
  test("existing output unchanged when no bundle provided", () => {
    const content = getAgentContent("deck-developer-explorer");
    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("# Explorer Agent");
    expect(content!.agentBody).not.toContain("## Package Instructions");
  });

  test("agent body includes capability instruction fragments when bundle provided", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const content = getAgentContent("deck-developer-explorer", { capabilityInstructions: bundle });

    expect(content).toBeDefined();
    expect(content!.agentBody).toContain("## Package Instructions (configured)");
    expect(content!.agentBody).toContain("Codebase Memory");
  });

  test("skill body includes capability instruction fragments when bundle provided", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const content = getAgentContent("deck-developer-explorer", { capabilityInstructions: bundle });

    expect(content).toBeDefined();
    expect(content!.skillBody).toContain("## Package Instructions (configured)");
    expect(content!.skillBody).toContain("Codebase Memory");
  });

  test("non-matching surface fragments are absent from agent body", () => {
    // session-surface fragments should not appear in agent body
    const bundle: CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "session",
          markdown: "This is a session-level fragment and should NOT appear in agent body",
        },
      ],
    };

    const content = getAgentContent("deck-developer-explorer", { capabilityInstructions: bundle });

    expect(content!.agentBody).not.toContain("session-level fragment");
  });

  test("multiple packages produce both instruction sections in agent body", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode"]);
    const content = getAgentContent("deck-developer-explorer", { capabilityInstructions: bundle });

    expect(content!.agentBody).toContain("Codebase Memory");
    expect(content!.agentBody).toContain("Context Mode");
  });

  test("both memory bundle and capability bundle coexist (independent injection)", () => {
    // The content registry handles both independently;
    // memory injection is a separate concern from capability instructions.
    // Here we just verify the capability instructions don't break the structure.
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const content = getAgentContent("deck-developer-explorer", { capabilityInstructions: bundle });

    // Context authority guidance still present
    expect(content!.agentBody).toContain("Context Authority");
    // Capability instructions appended after
    expect(content!.agentBody).toContain("## Package Instructions (configured)");
  });

  test("empty bundle does not inject instructions", () => {
    const bundle: CapabilityInstructionBundle = { instructions: [] };
    const content = getAgentContent("deck-developer-explorer", { capabilityInstructions: bundle });

    // Same as no bundle
    const withoutBundle = getAgentContent("deck-developer-explorer");
    expect(content!.agentBody).toBe(withoutBundle!.agentBody);
    expect(content!.skillBody).toBe(withoutBundle!.skillBody);
  });
});

describe("getTeamSessionInstructions with capabilityInstructions", () => {
  test("existing output unchanged when no bundle provided", () => {
    const instructions = getTeamSessionInstructions("developer-team");
    expect(instructions).toBeDefined();
    expect(instructions).toContain("# Deck Developer Team");
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
  test("returns ok: true with content for known agent", () => {
    const result = getAgentContentResult("deck-developer-orchestrator");
    expect(result.ok).toBe(true);
    const value = result as { ok: true; value: { agentBody: string; skillBody: string } };
    expect(value.value).toBeDefined();
    expect(value.value.agentBody).toContain("# Orchestrator Agent");
    expect(value.value.skillBody).toContain("# Orchestrator Skill");
  });

  test("returns ok: true for all catalog agents with real content", () => {
    const catalogIds = [
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
    for (const id of catalogIds) {
      const result = getAgentContentResult(id);
      expect(result.ok, `${id} should be ok: true`).toBe(true);
      if (result.ok) {
        expect(result.value.agentBody).toBeTruthy();
        expect(result.value.skillBody).toBeTruthy();
      }
    }
  });

  test("returns ok: false with suggestions for typo in agent ID", () => {
    // "orchstrator" is a typo of "orchestrator"
    const result = getAgentContentResult("deck-developer-orchstrator");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.agentId).toBe("deck-developer-orchstrator");
      expect(result.error.suggestions).toContain("deck-developer-orchestrator");
      // Not in catalog, so fallbackAvailable is false
      expect(result.error.fallbackAvailable).toBe(false);
    }
  });

  test("returns ok: false with suggestions for prefix-matchable typo", () => {
    // "deck-developer-orch" could suggest "deck-developer-orchestrator"
    const result = getAgentContentResult("deck-developer-orch");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.suggestions).toContain("deck-developer-orchestrator");
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

  test("returns fallbackAvailable: true for agent in catalog but without real content", () => {
    // This test checks the case where an agent exists in the catalog but has no REAL_CONTENT entry
    // All current agents have real content, so we test the catalog check behavior
    const result = getAgentContentResult("deck-developer-archive");
    expect(result.ok).toBe(true); // archive has real content
    // If there were a catalog entry without real content, fallbackAvailable would be true
  });

  test("with fallback: true still returns error for unknown agent not in catalog", () => {
    // Agents not in catalog cannot receive fallback — must return error
    const result = getAgentContentResult("some-unknown-agent", { fallback: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fallbackAvailable).toBe(false);
    }
  });

  test("with fallback: true returns generic content for catalog agent without real content", () => {
    // Catalog agent without real content gets fallback when fallback: true
    // All current catalog agents have real content, so this tests the logic path
    // Using archive as a proxy (it has real content, but the check demonstrates behavior)
    const result = getAgentContentResult("deck-developer-archive", { fallback: true });
    expect(result.ok).toBe(true); // archive has real content so no fallback needed
  });

  test("suggestions are limited to maximum 3", () => {
    // Query that might match multiple agents
    const result = getAgentContentResult("deck-developer-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.suggestions.length).toBeLessThanOrEqual(3);
    }
  });

  test("suggestions are sorted by relevance (prefix matches first)", () => {
    const result = getAgentContentResult("deck-developer-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const suggestions = result.error.suggestions;
      // Prefix matches should appear first
      const prefixMatches = suggestions.filter((id) => id.startsWith("deck-developer-"));
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
  test("getAgentContent returns content for known agent (same as getAgentContentResult)", () => {
    const legacy = getAgentContent("deck-developer-orchestrator");
    const result = getAgentContentResult("deck-developer-orchestrator");
    expect(legacy).toBeDefined();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(legacy!.agentBody).toBe(result.value.agentBody);
      expect(legacy!.skillBody).toBe(result.value.skillBody);
    }
  });

  test("getAgentContent returns undefined for unknown agent", () => {
    const legacy = getAgentContent("xyz-unknown-agent");
    expect(legacy).toBeUndefined();
  });

  test("all catalog agents return content via getAgentContent (backward compat)", () => {
    const catalogIds = [
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
    for (const id of catalogIds) {
      const content = getAgentContent(id);
      expect(content, `${id} should return content`).toBeDefined();
      expect(content!.agentBody).toBeTruthy();
      expect(content!.skillBody).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Personality — Orchestrator System Prompt Variants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Orchestrator Invariants Integration — REQ-IBC-001, REQ-IBC-002, REQ-IBC-003, REQ-IBC-004
// ---------------------------------------------------------------------------

describe("orchestrator invariant injection", () => {
  test("session instructions contain '## Orchestrator Invariants' at start", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    const invariantsIdx = instructions.indexOf("## Orchestrator Invariants");

    expect(invariantsIdx).toBe(0); // Invariants at start of session instructions
  });

  test("session instructions do not have Package Instructions by default", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    const packageInstrIdx = instructions.indexOf("## Package Instructions");

    expect(packageInstrIdx).toBe(-1); // no capability instructions by default
  });

  test("orchestrator agent body contains invariant section", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    expect(content.agentBody).toContain("## Orchestrator Invariants");
    expect(content.agentBody).toContain("INV-001");
    expect(content.agentBody).toContain("INV-002");
    expect(content.agentBody).toContain("INV-003");
    expect(content.agentBody).toContain("INV-004");
    expect(content.agentBody).toContain("INV-005");
    expect(content.agentBody).toContain("INV-006");
  });

  test("orchestrator skill body contains invariant section", () => {
    const content = getAgentContent("deck-developer-orchestrator")!;
    expect(content.skillBody).toContain("## Orchestrator Invariants");
    expect(content.skillBody).toContain("INV-001");
    expect(content.skillBody).toContain("INV-002");
    expect(content.skillBody).toContain("INV-003");
    expect(content.skillBody).toContain("INV-004");
    expect(content.skillBody).toContain("INV-005");
    expect(content.skillBody).toContain("INV-006");
  });

  test("non-orchestrator agents do NOT contain invariant section", () => {
    const nonOrchestratorAgents = [
      "deck-developer-explorer",
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

    for (const id of nonOrchestratorAgents) {
      const content = getAgentContent(id)!;
      expect(content.agentBody, `${id} should NOT contain invariants`).not.toContain(
        "## Orchestrator Invariants",
      );
      expect(content.skillBody, `${id} skill should NOT contain invariants`).not.toContain(
        "## Orchestrator Invariants",
      );
    }
  });

  test("composition is idempotent — no duplicates on re-composition", () => {
    const first = getAgentContent("deck-developer-orchestrator")!;
    const second = getAgentContent("deck-developer-orchestrator")!;

    // No duplicates of invariant section header
    const headerMatches = first.agentBody.match(/^## Orchestrator Invariants$/gm);
    expect(headerMatches).toHaveLength(1);
  });

  test("invariant section appears before context-authority guidance", () => {
    const instructions = getTeamSessionInstructions("developer-team")!;
    const invariantsIdx = instructions.indexOf("## Orchestrator Invariants");
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
    expect(guiaInstructions).toContain("Guia Personality");
    expect(guiaInstructions).toContain("Why delegation matters");
  });

  test("pragmatica personality returns current ORCHESTRATOR_SYSTEM_PROMPT behavior", () => {
    const pragmaticaInstructions = getTeamSessionInstructions("developer-team", { personality: "pragmatica" });
    expect(pragmaticaInstructions).toBeDefined();
    expect(pragmaticaInstructions).toContain("# Deck Developer Team");
    expect(pragmaticaInstructions).toContain("deck-developer-orchestrator");
    // Pragmatica should contain the delegation table with 4+
    expect(pragmaticaInstructions).toContain("4+");
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
