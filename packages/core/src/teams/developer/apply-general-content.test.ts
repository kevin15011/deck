import { describe, expect, test } from "bun:test";

import {
  APPLY_GENERAL_AGENT_BODY,
  APPLY_GENERAL_SKILL_BODY,
} from "./apply-general-content";

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
    expect(APPLY_GENERAL_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
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
