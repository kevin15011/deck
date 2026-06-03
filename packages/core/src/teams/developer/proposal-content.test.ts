import { describe, expect, test } from "bun:test";

import {
  PROPOSAL_AGENT_BODY,
  PROPOSAL_SKILL_BODY,
} from "./proposal-content";

// Import git-safety for rule presence assertion
import { GIT_SAFETY_SENTINEL } from "./git-safety";

// ---------------------------------------------------------------------------
// Placeholder detection — these tests guard against trivial/empty content
// ---------------------------------------------------------------------------

const PLACEHOLDER_SIGNALS = [
  "Placeholder",
  "TODO",
  "TBD",
  "Not yet implemented",
  "Coming soon",
  "placeholder",
];

function assertNotPlaceholder(content: string, label: string) {
  for (const signal of PLACEHOLDER_SIGNALS) {
    expect(content).not.toContain(signal);
  }
  // Must have substantial content (>500 chars means real prompt, not a stub)
  expect(content.length, `${label} should be >500 chars`).toBeGreaterThan(500);
}

// ---------------------------------------------------------------------------
// PROPOSAL_AGENT_BODY
// ---------------------------------------------------------------------------

describe("PROPOSAL_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(PROPOSAL_AGENT_BODY, "PROPOSAL_AGENT_BODY");
  });

  test("contains identity header with Proposal Agent name", () => {
    expect(PROPOSAL_AGENT_BODY).toContain("# Proposal Agent");
  });

  test("states it transforms ideas into proposals, does not implement", () => {
    expect(PROPOSAL_AGENT_BODY).toMatch(/proposal|propose|change/i);
    expect(PROPOSAL_AGENT_BODY).toMatch(/do(es)? not implement/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(PROPOSAL_AGENT_BODY).toContain("deck-developer-proposal");
  });

  test("instructs to follow matching skill", () => {
    expect(PROPOSAL_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(PROPOSAL_AGENT_BODY).not.toContain("pi launcher");
    expect(PROPOSAL_AGENT_BODY).not.toContain("deck pi");
    expect(PROPOSAL_AGENT_BODY).not.toContain("/sdd-");
  });

  test("lists key non-goals: no code, no specs, no design, no implementation", () => {
    expect(PROPOSAL_AGENT_BODY).toMatch(/do(es)? not (implement|write|create|code)/i);
    expect(PROPOSAL_AGENT_BODY).toMatch(/do(es)? not.*(spec|design|task)/i);
  });

  test("references structured output for downstream consumption", () => {
    expect(PROPOSAL_AGENT_BODY).toMatch(/return contract|output format|downstream/i);
  });
});

// ---------------------------------------------------------------------------
// PROPOSAL_SKILL_BODY
// ---------------------------------------------------------------------------

describe("PROPOSAL_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(PROPOSAL_SKILL_BODY, "PROPOSAL_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(PROPOSAL_SKILL_BODY).toContain("# Proposal Skill");
  });

  // --- Structured output format sections ---
  // Proposal must define: problem, goal, scope, non-goals, affected capabilities,
  // proposed approach, alternatives/tradeoffs, risks, dependencies, open questions,
  // acceptance direction.

  test("defines proposal output with required sections", () => {
    // Problem / Intent
    expect(PROPOSAL_SKILL_BODY).toMatch(/intent|problem|why/i);
    // Goal
    expect(PROPOSAL_SKILL_BODY).toMatch(/goal|objective/i);
    // Scope
    expect(PROPOSAL_SKILL_BODY).toMatch(/scope/i);
    // Non-goals / Out of scope
    expect(PROPOSAL_SKILL_BODY).toMatch(/out of scope|non-goal/i);
    // Affected capabilities or areas
    expect(PROPOSAL_SKILL_BODY).toMatch(/capabilit|affected.*(area|module|file)/i);
    // Proposed approach
    expect(PROPOSAL_SKILL_BODY).toMatch(/approach/i);
    // Alternatives/tradeoffs
    expect(PROPOSAL_SKILL_BODY).toMatch(/alternative|tradeoff/i);
    // Risks
    expect(PROPOSAL_SKILL_BODY).toMatch(/risk/i);
    // Dependencies
    expect(PROPOSAL_SKILL_BODY).toMatch(/dependenc/i);
    // Open questions
    expect(PROPOSAL_SKILL_BODY).toMatch(/open.*(question|issue|item)/i);
    // Acceptance direction or success criteria
    expect(PROPOSAL_SKILL_BODY).toMatch(/acceptance|success.*(criteria|direction)/i);
  });

  // --- Uncertainty preservation ---

  test("instructs to preserve uncertainty and flag open questions", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/uncertainty|flag|ask/i);
    expect(PROPOSAL_SKILL_BODY).toMatch(/do(es)? not.*(invent|assume|guess|fabricate)/i);
  });

  // --- Downstream consumption ---

  test("defines output structured for Spec and Design agent consumption", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/spec|design|downstream|consum/i);
  });

  // --- Constraints ---

  test("prohibits code implementation", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/do not (implement|write|create|code)/i);
  });

  test("prohibits writing detailed specs or design", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/do not.*(write|create|produce).*(spec|design|task)/i);
  });

  // --- Artifact persistence ---

  test("describes artifact persistence behavior", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/artifact|persist|store|openspec/i);
  });

  test("does not contain old artifact-store mode selection", () => {
    expect(PROPOSAL_SKILL_BODY).not.toMatch(/engram \| openspec \| hybrid \| none/);
    expect(PROPOSAL_SKILL_BODY).not.toContain("| engram |");
    expect(PROPOSAL_SKILL_BODY).not.toContain("| hybrid |");
    expect(PROPOSAL_SKILL_BODY).not.toContain("| none |");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(PROPOSAL_SKILL_BODY).toContain("openspec/");
  });

  // --- Runtime neutrality ---

  test("does not reference Pi-specific behavior", () => {
    expect(PROPOSAL_SKILL_BODY).not.toContain("pi launcher");
    expect(PROPOSAL_SKILL_BODY).not.toContain("deck pi");
    expect(PROPOSAL_SKILL_BODY).not.toContain("/sdd-");
    expect(PROPOSAL_SKILL_BODY).not.toContain("claude-sonnet");
    expect(PROPOSAL_SKILL_BODY).not.toContain("openai");
  });

  // --- Materially different from placeholder ---

  test("contains methodology steps that a placeholder would not have", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/step|phase|stage/i);
  });

  test("contains return format guidance for orchestrator consumption", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/return|output|report|summary/i);
  });

  // --- Explorer input ---

  test("references reading explorer findings as optional input", () => {
    expect(PROPOSAL_SKILL_BODY).toMatch(/explor|findings/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: Proposal content is distinct from Explorer and Orchestrator
// ---------------------------------------------------------------------------

describe("Proposal vs Explorer/Orchestrator differentiation", () => {
  test("Proposal agent body does not contain orchestrator delegation rules", async () => {
    const { ORCHESTRATOR_AGENT_BODY } = await import("./orchestrator-content");
    expect(PROPOSAL_AGENT_BODY).not.toContain("4-file rule");
    expect(PROPOSAL_AGENT_BODY).not.toContain("Delegation Triggers");
    // Confirm orchestrator has them (sanity)
    expect(ORCHESTRATOR_AGENT_BODY).toContain("Delegation Triggers");
  });

  test("Proposal agent body does not contain explorer investigation steps", async () => {
    const { EXPLORER_AGENT_BODY } = await import("./explorer-content");
    expect(PROPOSAL_AGENT_BODY).not.toContain("Investigation Steps");
    expect(PROPOSAL_AGENT_BODY).not.toContain("Investigation checklist");
    // Confirm explorer has them (sanity)
    expect(EXPLORER_AGENT_BODY).toMatch(/investigat/i);
  });

  // --- Need 5: Self-Verification ---
  test("skill body contains self-verification step", () => {
    expect(PROPOSAL_SKILL_BODY).toContain("Self-Verify Artifact");
  });

  // --- Need 7: Mermaid Phase Summaries ---
  test("skill body contains Mermaid summary source in output template", () => {
    expect(PROPOSAL_SKILL_BODY).toContain("Mermaid Summary Source");
  });

  test("return contract includes Mermaid Source field", () => {
    expect(PROPOSAL_SKILL_BODY).toContain("Mermaid Source");
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(PROPOSAL_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(PROPOSAL_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});
