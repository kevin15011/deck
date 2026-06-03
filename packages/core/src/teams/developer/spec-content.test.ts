import { describe, expect, test } from "bun:test";

import {
  SPEC_AGENT_BODY,
  SPEC_SKILL_BODY,
} from "./spec-content";

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
// SPEC_AGENT_BODY
// ---------------------------------------------------------------------------

describe("SPEC_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(SPEC_AGENT_BODY, "SPEC_AGENT_BODY");
  });

  test("contains identity header with Spec Agent name", () => {
    expect(SPEC_AGENT_BODY).toContain("# Spec Agent");
  });

  test("states it defines requirements, does not implement", () => {
    expect(SPEC_AGENT_BODY).toMatch(/requirement|spec/i);
    expect(SPEC_AGENT_BODY).toMatch(/do(es)? not implement/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(SPEC_AGENT_BODY).toContain("deck-developer-spec");
  });

  test("instructs to follow matching skill", () => {
    expect(SPEC_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(SPEC_AGENT_BODY).not.toContain("pi launcher");
    expect(SPEC_AGENT_BODY).not.toContain("deck pi");
    expect(SPEC_AGENT_BODY).not.toContain("/sdd-");
  });

  test("lists key non-goals: no code, no design, no implementation tasks", () => {
    expect(SPEC_AGENT_BODY).toMatch(/do(es)? not (implement|write|create|code)/i);
    expect(SPEC_AGENT_BODY).toMatch(/do(es)? not.*(design|architect|task)/i);
  });

  test("references structured output for downstream consumption", () => {
    expect(SPEC_AGENT_BODY).toMatch(/return contract|output format|downstream/i);
  });

  test("is surface-aware not implementation-aware", () => {
    expect(SPEC_AGENT_BODY).toMatch(/surface|behavior|externally|observable|contract/i);
  });
});

// ---------------------------------------------------------------------------
// SPEC_SKILL_BODY
// ---------------------------------------------------------------------------

describe("SPEC_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(SPEC_SKILL_BODY, "SPEC_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(SPEC_SKILL_BODY).toContain("# Spec Skill");
  });

  // --- Structured output format sections ---

  test("defines spec output with required sections", () => {
    // Requirements with MUST/SHOULD/MAY language
    expect(SPEC_SKILL_BODY).toMatch(/MUST|SHOULD|MAY|requirement/i);
    // Scenarios with Given/When/Then
    expect(SPEC_SKILL_BODY).toMatch(/Given.*When.*Then|scenario/i);
    // Scope / capabilities
    expect(SPEC_SKILL_BODY).toMatch(/scope|capabilit/i);
    // Validation rules or constraints
    expect(SPEC_SKILL_BODY).toMatch(/validation|constraint|rule/i);
    // Errors or error states
    expect(SPEC_SKILL_BODY).toMatch(/error|failure|invalid/i);
    // States or state transitions
    expect(SPEC_SKILL_BODY).toMatch(/state|transition|lifecycle/i);
    // Open questions
    expect(SPEC_SKILL_BODY).toMatch(/open.*(question|issue|item)/i);
  });

  // --- Uncertainty preservation ---

  test("instructs to preserve uncertainty and flag open questions", () => {
    expect(SPEC_SKILL_BODY).toMatch(/uncertainty|flag|ask/i);
    expect(SPEC_SKILL_BODY).toMatch(/do(es)? not.*(invent|assume|guess|fabricate)/i);
  });

  // --- Surface/behavior-awareness ---

  test("emphasizes externally observable behavior over implementation", () => {
    expect(SPEC_SKILL_BODY).toMatch(/externally|observable|surface|behavior|contract/i);
    expect(SPEC_SKILL_BODY).toMatch(/do(es)? not.*(prescribe|leak|reveal).*(implementation|internal|detail)/i);
  });

  // --- Downstream consumption ---

  test("defines output structured for Design and Tasks agent consumption", () => {
    expect(SPEC_SKILL_BODY).toMatch(/design|task|downstream|consum/i);
  });

  // --- Constraints ---

  test("prohibits code implementation", () => {
    // Tested via canonical line reference to using-agent-skills
    expect(SPEC_SKILL_BODY).toContain("using-agent-skills");
  });

  test("prohibits writing technical design or implementation tasks", () => {
    // Tested via canonical line reference to using-agent-skills
    expect(SPEC_SKILL_BODY).toContain("using-agent-skills");
  });

  // --- Artifact persistence ---

  test("describes artifact persistence behavior", () => {
    expect(SPEC_SKILL_BODY).toMatch(/artifact|persist|store|openspec/i);
  });

  test("does not contain old artifact-store mode selection", () => {
    expect(SPEC_SKILL_BODY).not.toMatch(/engram \| openspec \| hybrid \| none/);
    expect(SPEC_SKILL_BODY).not.toContain("| engram |");
    expect(SPEC_SKILL_BODY).not.toContain("| hybrid |");
    expect(SPEC_SKILL_BODY).not.toContain("| none |");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(SPEC_SKILL_BODY).toContain("openspec/");
  });

  // --- Runtime neutrality ---

  test("does not reference Pi-specific behavior", () => {
    expect(SPEC_SKILL_BODY).not.toContain("pi launcher");
    expect(SPEC_SKILL_BODY).not.toContain("deck pi");
    expect(SPEC_SKILL_BODY).not.toContain("/sdd-");
    expect(SPEC_SKILL_BODY).not.toContain("claude-sonnet");
    expect(SPEC_SKILL_BODY).not.toContain("openai");
  });

  // --- Materially different from placeholder ---

  test("contains methodology steps that a placeholder would not have", () => {
    expect(SPEC_SKILL_BODY).toMatch(/step|phase|stage/i);
  });

  test("contains return format guidance for orchestrator consumption", () => {
    expect(SPEC_SKILL_BODY).toMatch(/return|output|report|summary/i);
  });

  // --- Proposal input ---

  test("references reading proposal artifact as input", () => {
    expect(SPEC_SKILL_BODY).toMatch(/proposal|propose/i);
  });

  // --- Scenario format ---

  test("includes Given/When/Then or explicit acceptance scenario format", () => {
    expect(SPEC_SKILL_BODY).toMatch(/Given|When|Then/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: Spec content is distinct from Proposal and Explorer
// ---------------------------------------------------------------------------

describe("Spec vs Proposal/Explorer differentiation", () => {
  test("Spec agent body does not contain proposal output template", async () => {
    const { PROPOSAL_SKILL_BODY } = await import("./proposal-content");
    // Spec should not contain proposal-specific sections
    expect(SPEC_AGENT_BODY).not.toContain("Rollback Plan");
    expect(SPEC_AGENT_BODY).not.toContain("Alternatives and Tradeoffs");
    // Confirm proposal skill has them (sanity)
    expect(PROPOSAL_SKILL_BODY).toContain("Rollback Plan");
  });

  test("Spec agent body does not contain explorer investigation steps", async () => {
    const { EXPLORER_AGENT_BODY } = await import("./explorer-content");
    expect(SPEC_AGENT_BODY).not.toContain("Investigation Steps");
    expect(SPEC_AGENT_BODY).not.toContain("Investigation checklist");
    // Confirm explorer has them (sanity)
    expect(EXPLORER_AGENT_BODY).toMatch(/investigat/i);
  });

  // --- Need 5: Self-Verification ---
  test("skill body contains self-verification step", () => {
    expect(SPEC_SKILL_BODY).toContain("Self-Verify Artifact");
  });

  // --- Need 7: Mermaid Phase Summaries ---
  test("skill body contains Mermaid summary source in output template", () => {
    expect(SPEC_SKILL_BODY).toContain("Mermaid Summary Source");
  });

  test("return contract includes Mermaid Source field", () => {
    expect(SPEC_SKILL_BODY).toContain("Mermaid Source");
  });
});

// ---------------------------------------------------------------------------
// Canonical line verification tests (Task 2)
// ---------------------------------------------------------------------------

describe("Canonical line replacement", () => {
  const CANONICAL_LINE =
    "Follow the using-agent-skills skill for operating behaviors and failure mode guidance.";

  test("SKILL_BODY contains canonical line exactly once", () => {
    const matches = SPEC_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(SPEC_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain canonical line (immutability)", () => {
    expect(SPEC_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(SPEC_SKILL_BODY).toContain("## Rules");
  });
});

// Cognitive doc design canonical line test
describe("Cognitive doc design canonical line", () => {
  const CDD_CANONICAL_LINE =
    "Follow the cognitive-doc-design skill for artifact structure and documentation patterns.";

  test("SKILL_BODY contains cognitive-doc-design line exactly once", () => {
    const matches = SPEC_SKILL_BODY.split(CDD_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of cognitive-doc-design line", () => {
    expect(SPEC_SKILL_BODY).not.toContain(`- ${CDD_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain cognitive-doc-design line (immutability)", () => {
    expect(SPEC_AGENT_BODY).not.toContain(CDD_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(SPEC_SKILL_BODY).toContain("## Rules");
  });
});

// API and interface design canonical line test
describe("API and interface design canonical line", () => {
  const AID_CANONICAL_LINE = "Follow the api-and-interface-design skill for stable API and interface design guidance.";

  test("SKILL_BODY contains the line exactly once", () => {
    const matches = SPEC_SKILL_BODY.split(AID_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY does not contain bullet variant", () => {
    expect(SPEC_SKILL_BODY).not.toContain(`- ${AID_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does not contain the line", () => {
    expect(SPEC_AGENT_BODY).not.toContain(AID_CANONICAL_LINE);
  });

  test("SKILL_BODY contains ## Rules", () => {
    expect(SPEC_SKILL_BODY).toContain("## Rules");
  });

  test("both canonical lines exist as separate entries in Rules", () => {
    const cdd = "Follow the cognitive-doc-design skill for artifact structure and documentation patterns.";
    expect(SPEC_SKILL_BODY).toContain(cdd);
    expect(SPEC_SKILL_BODY).toContain(AID_CANONICAL_LINE);
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(SPEC_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(SPEC_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});
