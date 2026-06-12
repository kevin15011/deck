import { describe, expect, test } from "bun:test";

import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_PROMPT_GUIDA,
  ORCHESTRATOR_PROMPT_PRAGMATICA,
  ORCHESTRATOR_SKILL_BODY,
  ORCHESTRATOR_SYSTEM_PROMPT,
  PERSONALITY_COMMUNICATION_GUIDA,
  PERSONALITY_COMMUNICATION_PRAGMATICA,
  getOrchestratorSystemPrompt,
} from "./orchestrator-content";

// Import git-safety for rule presence assertion
import { GIT_SAFETY_SENTINEL } from "./git-safety";

describe("ORCHESTRATOR_SYSTEM_PROMPT", () => {
  test("contains team identity header", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("# Deck Developer Team");
  });

  test("contains team-scoped agent IDs", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-orchestrator");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-explorer");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-proposal");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-spec");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-design");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-task");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-apply-general");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-verify");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-review");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("deck-developer-archive");
  });

  test("does not contain old non-team-scoped IDs", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("`deck-orchestrator`");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("`deck-explorer`");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("`deck-archive`");
  });

  test("contains role definition — orchestrator is coordinator, not executor", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("coordinator");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("delegate");
  });

  test("contains delegation rules table with inline vs delegate thresholds", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Delegation Rules");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("4+");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Multi-file");
  });

  test("contains mandatory delegation triggers", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Mandatory Delegation Triggers");
  });

  test("contains SDD dependency graph", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Dependency Graph");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("proposal");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("spec");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("design");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("tasks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("apply");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("verify");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("archive");
  });

  test("requires SDD triage before execution mode", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("SDD Triage Gate");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Direct");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Specialist(s)");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Recommend SDD");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Run SDD");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Do not ask Automatic vs Interactive unless triage says Run SDD");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Documentation-only requests are not automatically SDD");
  });

  test("allows one or more specialists", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("one or more");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Specialist\(s\)/);
  });

  test("contains parallel specialist launch section", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Parallel Specialist Launch");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Safe to parallelize");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Unsafe to parallelize");
  });

  test("dependency graph starts with Explorer", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("SDD flow order: Explore -> Proposal");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Explorer runs **first**");
  });

  // INV-004 strengthened wording — all surfaces
  test("SDD triage gate prohibits modification before classification (INV-004 strengthened)", () => {
    // Key clause: taking/delegating any step that may modify + protected types + prohibition
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Do not modify or delegate modifying work until this classification is made");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Do not ask Automatic vs Interactive unless triage says Run SDD");
  });

  test("contains apply routing to general, backend, or frontend", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("General");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Backend");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Frontend");
  });

  test("references project AI notes under .deck/ai-notes/", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain(".deck/ai-notes/");
  });

  test("references skill injection via Project Standards", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Project Standards");
  });

  test("does not contain runtime-specific model assignment details", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("claude-sonnet-4-20250514");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Model Assignments");
  });

  test("does not reference slash commands (/sdd-new, /sdd-ff)", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-new");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-ff");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("/sdd-continue");
  });

  test("does not contain old artifact-store mode selection", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("| engram |");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("| hybrid |");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("| none |");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toMatch(/engram.*openspec.*hybrid/);
  });

  test("does not contain chained PR or delivery strategy language", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("auto-chain");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("ask-on-risk");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("single-pr");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("exception-ok");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("size:exception");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Delivery Strategy");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).not.toContain("Review Workload Guard");
  });

  test("requires OpenSpec artifacts", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("openspec/");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("required and non-optional");
  });

  test("describes memory as auxiliary", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/memory.*auxiliary|auxiliary.*memory/i);
  });

  // --- Need 1: Apply Batching ---

  test("contains apply batching guidance", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Apply Batching");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Group related tasks");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("ordered task list");
  });

  // --- Need 2: Post-Archive Git Suggestions ---

  test("contains post-Archive Git suggestion guidance", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Post-Archive Git Suggestions");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("NEVER");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("advisory");
  });

  // --- Need 3: Expanded Explorer Triage ---

  test("SDD triage covers workflow and agent config triggers", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("agent configuration");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("workflow internals");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("OpenSpec");
  });

  // --- Need 4: Role-Based Delegation ---

  test("contains SDD vs role-based delegation clarification", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("SDD vs. Role-Based Delegation");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("formal pipeline");
  });
});

describe("ORCHESTRATOR_AGENT_BODY", () => {
  test("contains identity and role header", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("# Orchestrator Agent");
  });

  test("states coordinator role, not executor", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("coordinator");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("delegate");
  });

  test("contains delegation triggers section", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Delegation Triggers");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("4+");
  });

  test("contains instruction to follow matching skill with team-scoped ID", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("deck-developer-orchestrator");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("mentions SDD triage in agent body", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Run SDD triage before asking for execution mode");
  });

  // INV-004 strengthened wording — agent body
  test("SDD triage gate prohibits modification before classification (INV-004 strengthened)", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain("taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files");
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Do not modify or delegate modifying work until this classification is made");
  });

  test("does not contain placeholder comment", () => {
    expect(ORCHESTRATOR_AGENT_BODY).not.toContain("Placeholder");
  });
});

describe("ORCHESTRATOR_SKILL_BODY", () => {
  test("contains skill title", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("# Orchestrator Skill");
  });

  test("contains SDD workflow methodology", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("SDD Workflow");
  });

  test("contains SDD triage categories in skill body", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Triage Gate");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Direct**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Specialist(s)**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Recommend SDD**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("**Run SDD**");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Do not infer full SDD from");
  });

  test("contains team-scoped agent IDs in phase routing table", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-explorer");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-proposal");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-spec");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-design");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-task");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-apply-*");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-verify");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-review");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("deck-developer-archive");
  });

  test("contains artifact persistence policy", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Artifact Persistence");
  });

  test("does not contain old artifact store mode selection", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toMatch(/engram.*openspec.*hybrid.*none/);
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Artifact Store Policy");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("| engram |");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("| hybrid |");
  });

  test("does not contain chained PR or delivery strategy language", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("auto-chain");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("ask-on-risk");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("single-pr");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("exception-ok");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("size:exception");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Delivery Strategy");
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Review Workload");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("openspec/");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("required and non-optional");
  });

  test("describes memory as auxiliary only", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toMatch(/memory.*auxiliary|auxiliary.*memory/i);
  });

  test("contains project AI notes retrieval instructions", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Project AI Notes");
    expect(ORCHESTRATOR_SKILL_BODY).toContain(".deck/ai-notes/");
  });

  test("contains skill resolution instructions", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Skill Resolution");
  });

  test("does not contain placeholder comment", () => {
    expect(ORCHESTRATOR_SKILL_BODY).not.toContain("Placeholder");
  });

  // --- Need 1: Apply Batching ---

  test("skill body contains apply batching guidance", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Apply Batching");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Do NOT default to one agent per task");
  });

  // --- Need 3: Expanded Explorer Triage ---

  test("skill triage covers workflow and agent config triggers", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("agent configuration");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("workflow internals");
  });

  // --- Need 5: Persistence Hardening ---

  test("skill body contains self-verification guidance", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Self-Verification Before Phase Completion");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Orchestrator Verification Before Phase Advancement");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("completion evidence");
  });

  // --- Need 6: Execution Config ---

  test("skill body contains agent execution configuration guidance", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Agent Execution Configuration");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("registered configuration");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("readDeveloperTeamModelAssignments");
  });

  // --- Need 7: Mermaid Phase Summaries ---

  test("skill body contains phase summary diagram guidance", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Phase Summary Diagrams");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("explanatory and non-authoritative");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("runner-agnostic");
  });

  // --- Need 2: Post-Archive Git Suggestions ---

  test("skill body contains post-Archive Git suggestion guidance", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Post-Archive Git Suggestions");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("advisory");
  });

  // INV-004 strengthened wording — skill body aligns with SKILL.md
  test("SDD triage gate prohibits modification before classification (INV-004 strengthened)", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Do not modify or delegate modifying work until this classification is made");
    expect(ORCHESTRATOR_SKILL_BODY).toContain("Do not ask Automatic vs Interactive unless triage says Run SDD");
  });
});

describe("ORCHESTRATOR_PROMPT_GUIDA", () => {
  // INV-004 strengthened wording — guida variant matches strengthened system prompt
  test("SDD triage gate prohibits modification before classification (INV-004 strengthened)", () => {
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("taking/delegating any step that may modify code, configuration, prompts, OpenSpec artifacts, or project files");
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("Do not modify or delegate modifying work until this classification is made");
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("Do not ask Automatic vs Interactive unless triage says Run SDD");
  });

  test("SDD triage gate lists all four categories", () => {
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("**Direct**");
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("**Specialist(s)**");
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("**Recommend SDD**");
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain("**Run SDD**");
  });
});

// ---------------------------------------------------------------------------
// Personality Variants
// ---------------------------------------------------------------------------

describe("getOrchestratorSystemPrompt", () => {
  test("guia variant contains teaching tone indicators", () => {
    const guia = getOrchestratorSystemPrompt("guia");
    expect(guia).toContain("Communication Style — Guia");
    // Core present in composition
    expect(guia).toContain("# Deck Developer Team");
    // Still longer than core
    expect(guia.length).toBeGreaterThan(ORCHESTRATOR_SYSTEM_PROMPT.length);
  });

  test("pragmatica variant is composition (not identity)", () => {
    const pragmatica = getOrchestratorSystemPrompt("pragmatica");
    // Core present
    expect(pragmatica).toContain("# Deck Developer Team");
    // Layer present
    expect(pragmatica).toContain("Communication Style — Pragmatica");
    // No longer equals core
    expect(pragmatica).not.toBe(ORCHESTRATOR_SYSTEM_PROMPT);
  });

  test("default (no arg) returns pragmatica", () => {
    // @ts-expect-error - testing JS behavior where no arg returns pragmatica
    const defaultPrompt = getOrchestratorSystemPrompt();
    // Same as pragmatica variant
    expect(defaultPrompt).toContain("Communication Style — Pragmatica");
    expect(defaultPrompt).toContain("# Deck Developer Team");
  });

  test("both variants (guia and pragmatica) are pairwise distinct", () => {
    const guia = getOrchestratorSystemPrompt("guia");
    const pragmatica = getOrchestratorSystemPrompt("pragmatica");

    // guia is longest (expanded)
    expect(guia.length).toBeGreaterThan(pragmatica.length);
    // All distinct strings
    expect(guia).not.toBe(pragmatica);
  });

  test("ORCHESTRATOR_PROMPT_GUIDA exports the guia variant", () => {
    expect(ORCHESTRATOR_PROMPT_GUIDA).toBe(getOrchestratorSystemPrompt("guia"));
  });

  test("ORCHESTRATOR_PROMPT_PRAGMATICA exports the pragmatica variant", () => {
    // Composition check instead of identity
    expect(ORCHESTRATOR_PROMPT_PRAGMATICA).toContain("# Deck Developer Team");
    expect(ORCHESTRATOR_PROMPT_PRAGMATICA).toContain("Communication Style — Pragmatica");
    expect(ORCHESTRATOR_PROMPT_PRAGMATICA).not.toBe(ORCHESTRATOR_SYSTEM_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// Communication Layer Tests
// ---------------------------------------------------------------------------

describe("PERSONALITY_COMMUNICATION_GUIDA", () => {
  test("contains guia communication style header", () => {
    expect(PERSONALITY_COMMUNICATION_GUIDA).toContain("Communication Style — Guia");
  });

  test("does not contain operational keywords (triage, routing, registry, recovery)", () => {
    // These are actual operational keywords that should NOT appear
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/triage/i);
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/routing/i);
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/registry/i);
    expect(PERSONALITY_COMMUNICATION_GUIDA).not.toMatch(/recovery/i);
  });

  test("has reasonable line count (≤ 40 lines)", () => {
    const lines = PERSONALITY_COMMUNICATION_GUIDA.split("\n").length;
    expect(lines).toBeLessThanOrEqual(40);
  });
});

describe("PERSONALITY_COMMUNICATION_PRAGMATICA", () => {
  test("contains pragmatica communication style header", () => {
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).toContain("Communication Style — Pragmatica");
  });

  test("does not contain operational keywords (triage, routing, registry, recovery)", () => {
    // These are actual operational keywords that should NOT appear
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/triage/i);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/routing/i);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/registry/i);
    expect(PERSONALITY_COMMUNICATION_PRAGMATICA).not.toMatch(/recovery/i);
  });

  test("has reasonable line count (≤ 40 lines)", () => {
    const lines = PERSONALITY_COMMUNICATION_PRAGMATICA.split("\n").length;
    expect(lines).toBeLessThanOrEqual(40);
  });
});

describe("ORCHESTRATOR_PROMPT_GUIDA composition", () => {
  test("starts with ORCHESTRATOR_SYSTEM_PROMPT (idempotency)", () => {
    expect(ORCHESTRATOR_PROMPT_GUIDA.startsWith(ORCHESTRATOR_SYSTEM_PROMPT)).toBe(true);
  });

  test("contains full ORCHESTRATOR_SYSTEM_PROMPT", () => {
    expect(ORCHESTRATOR_PROMPT_GUIDA).toContain(ORCHESTRATOR_SYSTEM_PROMPT);
  });
});

describe("ORCHESTRATOR_PROMPT_PRAGMATICA composition", () => {
  test("starts with ORCHESTRATOR_SYSTEM_PROMPT (idempotency)", () => {
    expect(ORCHESTRATOR_PROMPT_PRAGMATICA.startsWith(ORCHESTRATOR_SYSTEM_PROMPT)).toBe(true);
  });

  test("contains full ORCHESTRATOR_SYSTEM_PROMPT", () => {
    expect(ORCHESTRATOR_PROMPT_PRAGMATICA).toContain(ORCHESTRATOR_SYSTEM_PROMPT);
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(ORCHESTRATOR_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});

// --- Review repair: Semantic static verification for Pre-Delegation Checklist and automatic mode text ---
describe("Pre-Delegation Checklist and Automatic Mode (REQ-OA-004, REQ-OA-006)", () => {
  test("system prompt contains Pre-Delegation Checklist section", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("## Pre-Delegation Checklist");
  });

  test("system prompt contains all six checklist items", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("1. **Classify the request**");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("2. **Confirm SDD workspace**");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("3. **Confirm Explorer-first evidence**");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("4. **Confirm required phase artifacts**");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("5. **Confirm user authorization**");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("6. **Emit blocked outcome if any item is missing**");
  });

  test("system prompt contains semantic blocking wording for triage (INV-004)", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("triage classification is present");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Do not modify or delegate modifying work");
  });

  test("system prompt contains semantic blocking wording for Explorer (INV-006)", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Explorer-first evidence");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Explorer phase completed");
  });

  test("system prompt contains semantic blocking wording for authorization", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("user authorization");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("explicit user consent");
  });

  test("system prompt contains automatic mode non-bypass text (REQ-OA-006)", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Automatic execution mode does NOT bypass");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("triage");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Explorer-first");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("user authorization");
  });

  test("system prompt contains blocked outcome wording", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("Emit blocked outcome");
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("do NOT delegate");
  });
});

// ---------------------------------------------------------------------------
// Preconditions gate tests (Task 4, Task 5)
// ---------------------------------------------------------------------------

describe("Preconditions gate (Task 4, Task 5)", () => {
  test("system prompt contains SDD flow with precondition gate", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/Tasks.*Apply|Tasks.*Preconditions.*Apply/i);
  });

  test("system prompt mentions preconditions gate before Apply", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/precondition.*gate|Gate.*precondition/i);
  });

  test("system prompt contains gate pass/block rules", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/pass.*block|blocked.*Apply/i);
  });

  test("system prompt mentions preconditions.md artifact", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain("preconditions.md");
  });

  test("system prompt accepts None as passing result", () => {
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toMatch(/None.*pass|pass.*None/i);
  });

  test("skill body contains preconditions gate evaluation", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toMatch(/precondition.*gate|gate.*precondition/i);
  });

  test("skill body contains gate pass/block rules", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toMatch(/pass.*block|blocked.*Apply/i);
  });

  test("skill body contains registry event guidance for gate result", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toMatch(/gate.*event|event.*gate|registry.*event/i);
  });

  test("skill body contains anti-bureaucracy constraints", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toMatch(/anti-bureaucracy|fast.*gate|None.*valid/i);
  });

  test("skill body mentions preconditions.md existence requirement", () => {
    expect(ORCHESTRATOR_SKILL_BODY).toContain("preconditions.md");
  });
});
