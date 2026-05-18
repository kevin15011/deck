import { describe, expect, test } from "bun:test";

import {
  APPLY_FRONTEND_AGENT_BODY,
  APPLY_FRONTEND_SKILL_BODY,
} from "./apply-frontend-content";

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
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
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
