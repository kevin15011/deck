import { describe, expect, test } from "bun:test";

import {
  REVIEW_AGENT_BODY,
  REVIEW_SKILL_BODY,
} from "./review-content";

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
// REVIEW_AGENT_BODY
// ---------------------------------------------------------------------------

describe("REVIEW_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(REVIEW_AGENT_BODY, "REVIEW_AGENT_BODY");
  });

  test("contains identity header with Review Agent name", () => {
    expect(REVIEW_AGENT_BODY).toContain("# Review Agent");
  });

  test("describes engineering quality gate role", () => {
    expect(REVIEW_AGENT_BODY).toMatch(/engineering quality gate/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(REVIEW_AGENT_BODY).toContain("deck-developer-review");
  });

  test("instructs to follow matching skill", () => {
    expect(REVIEW_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(REVIEW_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(REVIEW_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(REVIEW_AGENT_BODY).not.toContain("pi launcher");
    expect(REVIEW_AGENT_BODY).not.toContain("deck pi");
    expect(REVIEW_AGENT_BODY).not.toContain("/sdd-");
  });

  test("distinguishes itself from Verify Agent", () => {
    expect(REVIEW_AGENT_BODY).toMatch(/not.*Verify Agent|Verify Agent's job/i);
  });

  test("mentions scoped review dimensions", () => {
    expect(REVIEW_AGENT_BODY).toMatch(/architecture|security|scalability|maintainability/i);
  });
});

// ---------------------------------------------------------------------------
// REVIEW_SKILL_BODY
// ---------------------------------------------------------------------------

describe("REVIEW_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(REVIEW_SKILL_BODY, "REVIEW_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(REVIEW_SKILL_BODY).toContain("# Review Skill");
  });

  test("references review-report artifact under OpenSpec", () => {
    expect(REVIEW_SKILL_BODY).toContain("openspec/");
    expect(REVIEW_SKILL_BODY).toContain("review-report.md");
  });

  test("states terminal behavior: no delegation", () => {
    expect(REVIEW_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("describes severity classification", () => {
    expect(REVIEW_SKILL_BODY).toMatch(/BLOCKER|MAJOR|MINOR|NIT/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(REVIEW_SKILL_BODY).not.toContain("pi launcher");
    expect(REVIEW_SKILL_BODY).not.toContain("deck pi");
    expect(REVIEW_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(REVIEW_SKILL_BODY).toMatch(/## Review Report|## Return Summary/i);
  });
});
