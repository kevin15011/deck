import { describe, expect, test } from "bun:test";

import {
  DESIGN_AGENT_BODY,
  DESIGN_SKILL_BODY,
} from "./design-content";

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
// DESIGN_AGENT_BODY
// ---------------------------------------------------------------------------

describe("DESIGN_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(DESIGN_AGENT_BODY, "DESIGN_AGENT_BODY");
  });

  test("contains identity header with Design Agent name", () => {
    expect(DESIGN_AGENT_BODY).toContain("# Design Agent");
  });

  test("states it defines architecture, does not implement", () => {
    expect(DESIGN_AGENT_BODY).toMatch(/design|architect/i);
    expect(DESIGN_AGENT_BODY).toMatch(/do(es)? not implement/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(DESIGN_AGENT_BODY).toContain("deck-developer-design");
  });

  test("instructs to follow matching skill", () => {
    expect(DESIGN_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(DESIGN_AGENT_BODY).not.toContain("pi launcher");
    expect(DESIGN_AGENT_BODY).not.toContain("deck pi");
    expect(DESIGN_AGENT_BODY).not.toContain("/sdd-");
  });

  test("lists key non-goals: no code, no specs, no tasks", () => {
    expect(DESIGN_AGENT_BODY).toMatch(/do(es)? not (implement|write|create|code)/i);
    expect(DESIGN_AGENT_BODY).toMatch(/do(es)? not.*(spec|task|requirement)/i);
  });

  test("references structured output for downstream consumption", () => {
    expect(DESIGN_AGENT_BODY).toMatch(/return contract|output format|downstream/i);
  });

  test("references relationship with Spec and Proposal", () => {
    expect(DESIGN_AGENT_BODY).toMatch(/spec|proposal/i);
  });
});

// ---------------------------------------------------------------------------
// DESIGN_SKILL_BODY
// ---------------------------------------------------------------------------

describe("DESIGN_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(DESIGN_SKILL_BODY, "DESIGN_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(DESIGN_SKILL_BODY).toContain("# Design Skill");
  });

  // --- Structured output format sections ---

  test("defines design output with required architecture sections", () => {
    // Current architecture context
    expect(DESIGN_SKILL_BODY).toMatch(/current.*(state|architecture|context)/i);
    // Proposed architecture / approach
    expect(DESIGN_SKILL_BODY).toMatch(/proposed.*(architecture|approach|design)/i);
    // Component/module boundaries
    expect(DESIGN_SKILL_BODY).toMatch(/component|module|boundary|boundary/i);
    // Data flow
    expect(DESIGN_SKILL_BODY).toMatch(/data.*(flow|model|schema)/i);
    // API/contract implications
    expect(DESIGN_SKILL_BODY).toMatch(/api|contract|interface/i);
    // Tradeoffs
    expect(DESIGN_SKILL_BODY).toMatch(/tradeoff|alternative/i);
    // Risks
    expect(DESIGN_SKILL_BODY).toMatch(/risk/i);
    // Open questions
    expect(DESIGN_SKILL_BODY).toMatch(/open.*(question|issue|item|decision)/i);
  });

  test("covers file impact expectations", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/file.*(impact|change|affected|touched)/i);
  });

  test("covers testing strategy when relevant", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/test.*(strategy|approach|plan)/i);
  });

  test("covers state/persistence implications when relevant", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/state|persist|storage|database|migration/i);
  });

  test("covers backward compatibility when relevant", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/backward|compatib|migrat/i);
  });

  // --- Uncertainty preservation ---

  test("instructs to preserve uncertainty and flag open questions", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/uncertainty|flag|ask/i);
    expect(DESIGN_SKILL_BODY).toMatch(/do(es)? not.*(invent|assume|guess|fabricate)/i);
  });

  // --- Domain/stack awareness ---

  test("is domain-aware and stack-aware", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/domain|stack|language|framework|convention/i);
  });

  // --- Downstream consumption ---

  test("defines output structured for Task agent consumption", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/task|downstream|consum/i);
  });

  // --- Constraints ---

  test("prohibits code implementation", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/do not (implement|write|create|code)/i);
  });

  test("prohibits writing detailed specs or task breakdowns", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/do not.*(write|create|produce).*(spec|task|requirement)/i);
  });

  // --- Artifact persistence ---

  test("describes artifact persistence behavior", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/artifact|persist|store|openspec/i);
  });

  test("does not contain old artifact-store mode selection", () => {
    expect(DESIGN_SKILL_BODY).not.toMatch(/engram \| openspec \| hybrid \| none/);
    expect(DESIGN_SKILL_BODY).not.toContain("| engram |");
    expect(DESIGN_SKILL_BODY).not.toContain("| hybrid |");
    expect(DESIGN_SKILL_BODY).not.toContain("| none |");
  });

  test("requires OpenSpec artifact persistence", () => {
    expect(DESIGN_SKILL_BODY).toContain("openspec/");
  });

  // --- Runtime neutrality ---

  test("does not reference Pi-specific behavior", () => {
    expect(DESIGN_SKILL_BODY).not.toContain("pi launcher");
    expect(DESIGN_SKILL_BODY).not.toContain("deck pi");
    expect(DESIGN_SKILL_BODY).not.toContain("/sdd-");
    expect(DESIGN_SKILL_BODY).not.toContain("claude-sonnet");
    expect(DESIGN_SKILL_BODY).not.toContain("openai");
  });

  // --- Materially different from placeholder ---

  test("contains methodology steps that a placeholder would not have", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/step|phase|stage/i);
  });

  test("contains return format guidance for orchestrator consumption", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/return|output|report|summary/i);
  });

  // --- Proposal input ---

  test("references reading proposal artifact as input", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/proposal|propose/i);
  });

  // --- Relationship with Spec ---

  test("documents parallel relationship with Spec Agent", () => {
    expect(DESIGN_SKILL_BODY).toMatch(/spec|parallel|independent/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: Design content is distinct from Proposal and Spec
// ---------------------------------------------------------------------------

describe("Design vs Proposal/Spec differentiation", () => {
  test("Design agent body does not contain proposal output template", async () => {
    const { PROPOSAL_SKILL_BODY } = await import("./proposal-content");
    // Design should not contain proposal-specific sections
    expect(DESIGN_AGENT_BODY).not.toContain("Rollback Plan");
    expect(DESIGN_AGENT_BODY).not.toContain("Alternatives and Tradeoffs");
    expect(DESIGN_AGENT_BODY).not.toContain("Affected Capabilities");
    // Confirm proposal skill has them (sanity)
    expect(PROPOSAL_SKILL_BODY).toContain("Rollback Plan");
  });

  test("Design agent body does not contain spec Given/When/Then sections", async () => {
    const { SPEC_SKILL_BODY } = await import("./spec-content");
    expect(DESIGN_AGENT_BODY).not.toContain("Given/When/Then");
    expect(DESIGN_AGENT_BODY).not.toContain("REQ-");
    // Confirm spec skill has them (sanity)
    expect(SPEC_SKILL_BODY).toMatch(/Given.*When.*Then/i);
  });

  // --- Need 5: Self-Verification ---
  test("skill body contains self-verification step", () => {
    expect(DESIGN_SKILL_BODY).toContain("Self-Verify Artifact");
  });

  // --- Need 7: Mermaid Phase Summaries ---
  test("skill body contains Mermaid summary source in output template", () => {
    expect(DESIGN_SKILL_BODY).toContain("Mermaid Summary Source");
  });

  test("return contract includes Mermaid Source field", () => {
    expect(DESIGN_SKILL_BODY).toContain("Mermaid Source");
  });
});

// ---------------------------------------------------------------------------
// Canonical line verification tests (Task 2)
// ---------------------------------------------------------------------------

describe("Canonical line replacement", () => {
  const CANONICAL_LINE =
    "Follow the using-agent-skills skill for operating behaviors and failure mode guidance.";

  test("SKILL_BODY contains canonical line exactly once", () => {
    const matches = DESIGN_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(DESIGN_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain canonical line (immutability)", () => {
    expect(DESIGN_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(DESIGN_SKILL_BODY).toContain("## Rules");
  });
});

// Cognitive doc design canonical line test
describe("Cognitive doc design canonical line", () => {
  const CDD_CANONICAL_LINE =
    "Follow the cognitive-doc-design skill for artifact structure and documentation patterns.";

  test("SKILL_BODY contains cognitive-doc-design line exactly once", () => {
    const matches = DESIGN_SKILL_BODY.split(CDD_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of cognitive-doc-design line", () => {
    expect(DESIGN_SKILL_BODY).not.toContain(`- ${CDD_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain cognitive-doc-design line (immutability)", () => {
    expect(DESIGN_AGENT_BODY).not.toContain(CDD_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(DESIGN_SKILL_BODY).toContain("## Rules");
  });
});

// API and interface design canonical line test
describe("API and interface design canonical line", () => {
  const AID_CANONICAL_LINE = "Follow the api-and-interface-design skill for stable API and interface design guidance.";

  test("SKILL_BODY contains the line exactly once", () => {
    const matches = DESIGN_SKILL_BODY.split(AID_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY does not contain bullet variant", () => {
    expect(DESIGN_SKILL_BODY).not.toContain(`- ${AID_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does not contain the line", () => {
    expect(DESIGN_AGENT_BODY).not.toContain(AID_CANONICAL_LINE);
  });

  test("SKILL_BODY contains ## Rules", () => {
    expect(DESIGN_SKILL_BODY).toContain("## Rules");
  });

  test("both canonical lines exist as separate entries in Rules", () => {
    const cdd = "Follow the cognitive-doc-design skill for artifact structure and documentation patterns.";
    expect(DESIGN_SKILL_BODY).toContain(cdd);
    expect(DESIGN_SKILL_BODY).toContain(AID_CANONICAL_LINE);
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(DESIGN_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(DESIGN_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});
