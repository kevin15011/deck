import { describe, expect, test } from "bun:test";

import {
  VERIFY_AGENT_BODY,
  VERIFY_SKILL_BODY,
} from "./verify-content";

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
// VERIFY_AGENT_BODY
// ---------------------------------------------------------------------------

describe("VERIFY_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(VERIFY_AGENT_BODY, "VERIFY_AGENT_BODY");
  });

  test("contains identity header with Verify Agent name", () => {
    expect(VERIFY_AGENT_BODY).toContain("# Verify Agent");
  });

  test("describes compliance and test gate role", () => {
    expect(VERIFY_AGENT_BODY).toMatch(/compliance|test gate/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(VERIFY_AGENT_BODY).toContain("deck-developer-verify");
  });

  test("instructs to follow matching skill", () => {
    expect(VERIFY_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(VERIFY_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(VERIFY_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(VERIFY_AGENT_BODY).not.toContain("pi launcher");
    expect(VERIFY_AGENT_BODY).not.toContain("deck pi");
    expect(VERIFY_AGENT_BODY).not.toContain("/sdd-");
  });

  test("distinguishes itself from Review Agent", () => {
    expect(VERIFY_AGENT_BODY).toMatch(/not.*Review Agent|Review Agent's job/i);
  });
});

// ---------------------------------------------------------------------------
// VERIFY_SKILL_BODY
// ---------------------------------------------------------------------------

describe("VERIFY_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(VERIFY_SKILL_BODY, "VERIFY_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(VERIFY_SKILL_BODY).toContain("# Verify Skill");
  });

  test("references verify-report artifact under OpenSpec", () => {
    expect(VERIFY_SKILL_BODY).toContain("openspec/");
    expect(VERIFY_SKILL_BODY).toContain("verify-report.md");
  });

  test("states terminal behavior: no delegation", () => {
    expect(VERIFY_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("describes compliance matrix", () => {
    expect(VERIFY_SKILL_BODY).toMatch(/compliance matrix/i);
  });

  test("describes test, build, and typecheck execution", () => {
    expect(VERIFY_SKILL_BODY).toMatch(/test|build|typecheck/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(VERIFY_SKILL_BODY).not.toContain("pi launcher");
    expect(VERIFY_SKILL_BODY).not.toContain("deck pi");
    expect(VERIFY_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(VERIFY_SKILL_BODY).toMatch(/## Verify Report|## Return Summary/i);
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(VERIFY_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(VERIFY_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});
