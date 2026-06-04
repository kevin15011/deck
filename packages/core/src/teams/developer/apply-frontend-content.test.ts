import { describe, expect, test } from "bun:test";

import {
  APPLY_FRONTEND_AGENT_BODY,
  APPLY_FRONTEND_SKILL_BODY,
} from "./apply-frontend-content";

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
  expect(content.length, `${label} should be >500 chars`).toBeGreaterThan(500);
}

// ---------------------------------------------------------------------------
// APPLY_FRONTEND_AGENT_BODY
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// APPLY_FRONTEND_SKILL_BODY
// ---------------------------------------------------------------------------

describe("APPLY_FRONTEND_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_FRONTEND_AGENT_BODY, "APPLY_FRONTEND_AGENT_BODY");
  });

  test("contains identity header with Frontend Apply Agent name", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("# Frontend Apply Agent");
  });

  test("describes frontend implementor role", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/frontend implementor/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("deck-developer-apply-frontend");
  });

  test("instructs to follow matching skill", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain("pi launcher");
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain("deck pi");
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain("/sdd-");
  });

  test("prohibits silently changing backend contracts", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/do(es)? not.*silently.*change.*backend.*contract/i);
  });

  test("prohibits backend implementation", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/do(es)? not.*implement.*backend|server-side|api/i);
  });
});

describe("APPLY_FRONTEND_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_FRONTEND_SKILL_BODY, "APPLY_FRONTEND_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("# Frontend Apply Skill");
  });

test("references apply-progress artifact under OpenSpec", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("openspec/");
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("apply-progress.md");
  });

  test("states terminal behavior: no delegation", () => {
    // Tested via canonical line reference to using-agent-skills
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("using-agent-skills");
  });

  test("describes frontend verification steps", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/frontend.*test|build|typecheck|accessibility/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("pi launcher");
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("deck pi");
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/## Apply Progress|## Return Summary/i);
  });
});

// REQ-SAE-001 to REQ-SAE-007: Serena enforcement tests
describe("Serena enforcement rules", () => {
  test("contains Serena enforcement section when package selected", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("Serena Enforcement");
  });

  test("mention find_symbol for symbolic operations", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("find_symbol");
  });

  test("mention replace_symbol_body for replacement", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("replace_symbol_body");
  });

  test("mention coexistance with codebase-memory", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("codebase-memory");
  });

  test("mention fallback reporting", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/Fallback|report/i);
  });

test("does NOT validate CLI existence", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("No CLI validation");
  });
});

// ---------------------------------------------------------------------------
// APPLY_FRONTEND_AGENT_BODY
// ---------------------------------------------------------------------------

describe("APPLY_FRONTEND_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_FRONTEND_AGENT_BODY, "APPLY_FRONTEND_AGENT_BODY");
  });

  test("contains identity header", () => {
});

  test("contains identity header with Frontend Apply Agent name", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("# Frontend Apply Agent");
  });

  test("describes frontend implementor role", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/frontend implementor/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("deck-developer-apply-frontend");
  });

  test("instructs to follow matching skill", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain("pi launcher");
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain("deck pi");
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain("/sdd-");
  });

  test("prohibits inventing backend contracts", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/do(es)? not.*invent|mock|reshape.*backend.*contract/i);
  });

  test("prohibits backend implementation", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toMatch(/do(es)? not.*implement.*backend|API|service|database/i);
  });
});

// ---------------------------------------------------------------------------
// APPLY_FRONTEND_SKILL_BODY
// ---------------------------------------------------------------------------

describe("APPLY_FRONTEND_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_FRONTEND_SKILL_BODY, "APPLY_FRONTEND_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("# Frontend Apply Skill");
  });

  test("references apply-progress artifact under OpenSpec", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("openspec/");
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("apply-progress.md");
  });

  test("states terminal behavior: no delegation", () => {
    // Tested via canonical line reference to using-agent-skills
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("using-agent-skills");
  });

  test("describes frontend verification steps", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/frontend.*test|build|typecheck|accessibility/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("pi launcher");
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("deck pi");
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/## Apply Progress|## Return Summary/i);
  });
});

// ---------------------------------------------------------------------------
// Canonical line verification tests (Task 2)
// ---------------------------------------------------------------------------

describe("Canonical line replacement", () => {
  const CANONICAL_LINE =
    "Follow the using-agent-skills skill for operating behaviors and failure mode guidance.";

  test("SKILL_BODY contains canonical line exactly once", () => {
    const matches = APPLY_FRONTEND_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain canonical line (immutability)", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("## Rules");
  });
});

describe("Serena Enforcement preserved", () => {
  test("SKILL_BODY contains ## Serena Enforcement section", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("## Serena Enforcement");
  });
});

describe("Documentation and ADRs canonical line", () => {
  const CANONICAL_LINE =
    "Follow the `documentation-and-adrs` skill for comment guidance (why-vs-what, gotchas, no commented-out code) and ADR-style rationale capture.";

  test("SKILL_BODY contains the canonical line exactly once", () => {
    const matches = APPLY_FRONTEND_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain the canonical line (immutability)", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("## Rules");
  });
});

// Frontend UI engineering canonical line (Phase 3F: REQ-sel-001)
describe("Frontend UI engineering canonical line", () => {
  const FEUI_CANONICAL_LINE =
    "Follow the frontend-ui-engineering skill for production-quality UI/component, state, accessibility, responsive, loading/error/empty-state, and frontend quality guidance.";

  test("SKILL_BODY contains the line exactly once", () => {
    const matches = APPLY_FRONTEND_SKILL_BODY.split(FEUI_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain(`- ${FEUI_CANONICAL_LINE}`);
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain(`* ${FEUI_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain the line (immutability)", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain(FEUI_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("## Rules");
  });
});

// Test-driven-development canonical line (Phase 3F: REQ-sel-004)
describe("Test-driven-development canonical line", () => {
  const TDD_CANONICAL_LINE =
    "Follow the test-driven-development skill for RED-GREEN-REFACTOR, Prove-It testing, test pyramid, and real-over-mocks guidance when authoring or changing tests.";

  test("SKILL_BODY contains the TDD line exactly once", () => {
    const matches = APPLY_FRONTEND_SKILL_BODY.split(TDD_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of TDD line", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain(`- ${TDD_CANONICAL_LINE}`);
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain(`* ${TDD_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain the TDD line (immutability)", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).not.toContain(TDD_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain("## Rules");
  });

  test("TDD line is placed after the frontend-ui-engineering line", () => {
    const tddIdx = APPLY_FRONTEND_SKILL_BODY.indexOf(TDD_CANONICAL_LINE);
    const feuiIdx = APPLY_FRONTEND_SKILL_BODY.indexOf(
      "Follow the frontend-ui-engineering skill for production-quality UI/component, state, accessibility, responsive, loading/error/empty-state, and frontend quality guidance.",
    );
    expect(tddIdx).toBeGreaterThan(feuiIdx);
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(APPLY_FRONTEND_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});

// Authorization Card and Self-Rejection Instruction tests (REQ-OA-005, REQ-OA-009)
describe("Authorization Card and Self-Rejection Instruction", () => {
  test("AGENT_BODY contains Authorization Card section header", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("## Authorization Card");
  });

  test("AGENT_BODY contains the orchestrator injection placeholder comment", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain(
      "<!-- Orchestrator will inject renderApplyAuthorizationCard() output here when delegating -->"
    );
  });

  test("AGENT_BODY contains Self-Rejection Instruction section", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("## Self-Rejection Instruction");
  });

  test("AGENT_BODY contains refusal phrase for missing authorization", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("refuse to perform any file modifications");
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("Report `blocked` status");
  });

  test("AGENT_BODY contains defense-in-depth warning", () => {
    expect(APPLY_FRONTEND_AGENT_BODY).toContain("defense-in-depth measure");
  });
});
