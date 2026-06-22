import { describe, expect, test } from "bun:test";

import {
  APPLY_GENERAL_AGENT_BODY,
  APPLY_GENERAL_SKILL_BODY,
} from "./apply-general-content";

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
// APPLY_GENERAL_AGENT_BODY
// ---------------------------------------------------------------------------

describe("APPLY_GENERAL_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_GENERAL_AGENT_BODY, "APPLY_GENERAL_AGENT_BODY");
  });

  test("contains identity header with General Apply Agent name", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("# General Apply Agent");
  });

  test("describes general implementor role", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toMatch(/general implementor/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("deck-developer-apply-general");
  });

  test("instructs to follow matching skill", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain("pi launcher");
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain("deck pi");
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain("/sdd-");
  });

  test("owns shared contracts without cross-boundary overreach", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toMatch(/shared.*contract|shared.*type|schema/i);
    expect(APPLY_GENERAL_AGENT_BODY).toMatch(/do(es)? not.*force.*backend.*frontend|handoff|boundary/i);
  });
});

// ---------------------------------------------------------------------------
// APPLY_GENERAL_SKILL_BODY
// ---------------------------------------------------------------------------

describe("APPLY_GENERAL_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_GENERAL_SKILL_BODY, "APPLY_GENERAL_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("# General Apply Skill");
  });

  test("references apply-progress artifact under OpenSpec", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("openspec/");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("apply-progress.md");
  });

  test("states terminal behavior: no delegation", () => {
    // Now tested via canonical line reference to using-agent-skills
    expect(APPLY_GENERAL_SKILL_BODY).toContain("using-agent-skills");
  });

  test("describes verification steps (tests, build, typecheck)", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toMatch(/test|build|typecheck/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain("pi launcher");
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain("deck pi");
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toMatch(/## Apply Progress|## Return Summary/i);
  });
});

// REQ-SAE-001 to REQ-SAE-007: Serena enforcement tests
describe("Serena enforcement rules", () => {
  test("contains Serena enforcement section when package selected", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("Serena Enforcement");
  });

  test("mention find_symbol for symbolic operations", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("find_symbol");
  });

  test("mention replace_symbol_body for replacement", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("replace_symbol_body");
  });

  test("mention coexistance with codebase-memory", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("codebase-memory");
  });

  test("mention fallback reporting", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toMatch(/Fallback|report/i);
  });

  test("does NOT validate CLI existence", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("No CLI validation");
  });
});

// ---------------------------------------------------------------------------
// Canonical line verification tests (Task 2)
// ---------------------------------------------------------------------------

// Import excluded files for boundary testing
import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_SKILL_BODY,
} from "./orchestrator-content";
import { EXPLORER_AGENT_BODY } from "./explorer-content";

describe("Canonical line replacement", () => {
  const CANONICAL_LINE =
    "Follow the using-agent-skills skill for operating behaviors and failure mode guidance.";

  test("SKILL_BODY contains canonical line exactly once", () => {
    const matches = APPLY_GENERAL_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain canonical line (immutability)", () => {
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("## Rules");
  });
});

describe("API and interface design canonical line", () => {
  const AID_CANONICAL_LINE = "Follow the api-and-interface-design skill for stable API and interface design guidance.";

  test("SKILL_BODY contains the line exactly once", () => {
    const matches = APPLY_GENERAL_SKILL_BODY.split(AID_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY does not contain bullet variant", () => {
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain(`- ${AID_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does not contain the line", () => {
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain(AID_CANONICAL_LINE);
  });

  test("SKILL_BODY contains ## Rules", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("## Rules");
  });
});

describe("Serena Enforcement preserved", () => {
  test("SKILL_BODY contains ## Serena Enforcement section", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("## Serena Enforcement");
  });
});

describe("Documentation and ADRs canonical line", () => {
  const CANONICAL_LINE =
    "Follow the `documentation-and-adrs` skill for comment guidance (why-vs-what, gotchas, no commented-out code) and ADR-style rationale capture.";

  test("SKILL_BODY contains the canonical line exactly once", () => {
    const matches = APPLY_GENERAL_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain the canonical line (immutability)", () => {
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("## Rules");
  });
});

// Test-driven-development canonical line (Phase 3F: REQ-sel-005)
describe("Test-driven-development canonical line", () => {
  const TDD_CANONICAL_LINE =
    "Follow the test-driven-development skill for RED-GREEN-REFACTOR, Prove-It testing, test pyramid, and real-over-mocks guidance when authoring or changing tests.";

  test("SKILL_BODY contains the TDD line exactly once", () => {
    const matches = APPLY_GENERAL_SKILL_BODY.split(TDD_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of TDD line", () => {
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain(`- ${TDD_CANONICAL_LINE}`);
    expect(APPLY_GENERAL_SKILL_BODY).not.toContain(`* ${TDD_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain the TDD line (immutability)", () => {
    expect(APPLY_GENERAL_AGENT_BODY).not.toContain(TDD_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("## Rules");
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});

// Authorization Card and Self-Rejection Instruction tests (REQ-OA-005, REQ-OA-009)
describe("Authorization Card and Self-Rejection Instruction", () => {
  test("AGENT_BODY contains Authorization Card section header", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("## Authorization Card");
  });

  test("AGENT_BODY contains the orchestrator injection placeholder comment", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain(
      "<!-- Orchestrator will inject renderApplyAuthorizationCard() output here when delegating -->"
    );
  });

  test("AGENT_BODY contains Self-Rejection Instruction section", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("## Self-Rejection Instruction");
  });

  test("AGENT_BODY contains refusal phrase for missing authorization", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("refuse to perform any file modifications");
    expect(APPLY_GENERAL_AGENT_BODY).toContain("Report `blocked` status");
  });

  test("AGENT_BODY contains defense-in-depth warning", () => {
    expect(APPLY_GENERAL_AGENT_BODY).toContain("defense-in-depth measure");
  });
});


describe("repair incident apply behavior", () => {
  test("requires incident consumption, scoped retry accounting, generated-artifact evidence, redaction, and next stage updates", () => {
    expect(APPLY_GENERAL_SKILL_BODY).toContain("repair-incident.md");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("preserve prior Verify evidence");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("update retry accounting");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("Do not start a repair when required manifest fields are missing");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("clarification, replan, or blocked");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("not_generated, checked_in_deterministic, checked_in_environment_sensitive, untracked_build_output, or unknown");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("untracked_build_output requires evidence that it remains untracked/ignored or was removed");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("Redact runner session IDs, absolute user paths, tokens, credentials, and secrets");
    expect(APPLY_GENERAL_SKILL_BODY).toContain("targeted, affected_area, or broad_gate");
  });
});
