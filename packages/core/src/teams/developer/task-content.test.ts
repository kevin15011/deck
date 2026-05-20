import { describe, expect, test } from "bun:test";

import {
  TASK_AGENT_BODY,
  TASK_SKILL_BODY,
} from "./task-content";

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
// TASK_AGENT_BODY
// ---------------------------------------------------------------------------

describe("TASK_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(TASK_AGENT_BODY, "TASK_AGENT_BODY");
  });

  test("contains identity header with Task Agent name", () => {
    expect(TASK_AGENT_BODY).toContain("# Task Agent");
  });

  test("describes task router role, not implementor", () => {
    expect(TASK_AGENT_BODY).toMatch(/task router|not an implementor/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(TASK_AGENT_BODY).toContain("deck-developer-task");
  });

  test("instructs to follow matching skill", () => {
    expect(TASK_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(TASK_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(TASK_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(TASK_AGENT_BODY).not.toContain("pi launcher");
    expect(TASK_AGENT_BODY).not.toContain("deck pi");
    expect(TASK_AGENT_BODY).not.toContain("/sdd-");
  });
});

// ---------------------------------------------------------------------------
// TASK_SKILL_BODY
// ---------------------------------------------------------------------------

describe("TASK_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(TASK_SKILL_BODY, "TASK_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(TASK_SKILL_BODY).toContain("# Task Skill");
  });

  test("defines owner routing rules for three Apply agents", () => {
    expect(TASK_SKILL_BODY).toContain("General Apply");
    expect(TASK_SKILL_BODY).toContain("Backend Apply");
    expect(TASK_SKILL_BODY).toContain("Frontend Apply");
  });

  test("prescribes shared/contracts first, then backend, then frontend", () => {
    expect(TASK_SKILL_BODY).toMatch(/shared.*contract/i);
    expect(TASK_SKILL_BODY).toMatch(/backend/i);
    expect(TASK_SKILL_BODY).toMatch(/frontend/i);
  });

  test("prevents frontend from inventing or reshaping backend contracts", () => {
    expect(TASK_SKILL_BODY).toMatch(/invent or reshape that contract|invent.*backend.*contract/i);
  });

  test("routes shared types/schemas to General Apply first", () => {
    expect(TASK_SKILL_BODY).toMatch(/route.*shared.*General Apply|General Apply.*shared/i);
  });

  test("enforces explicit dependency documentation", () => {
    expect(TASK_SKILL_BODY).toMatch(/depend|block|coupling/i);
  });

  test("references OpenSpec artifact persistence", () => {
    expect(TASK_SKILL_BODY).toContain("openspec/");
  });

  test("states terminal behavior: no delegation", () => {
    expect(TASK_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(TASK_SKILL_BODY).not.toContain("pi launcher");
    expect(TASK_SKILL_BODY).not.toContain("deck pi");
    expect(TASK_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured output template for orchestrator consumption", () => {
    expect(TASK_SKILL_BODY).toMatch(/## Tasks Created|## Return Summary/i);
  });

  test("includes review workload forecast", () => {
    expect(TASK_SKILL_BODY).toMatch(/review.*workload|400-line|changed.*line/i);
  });

  // --- Need 5: Self-Verification ---
  test("skill body contains self-verification step", () => {
    expect(TASK_SKILL_BODY).toContain("Self-Verify Artifact");
  });

  // --- Need 7: Mermaid Phase Summaries ---
  test("skill body contains Mermaid summary source in output template", () => {
    expect(TASK_SKILL_BODY).toContain("Mermaid Summary Source");
  });

  test("return contract includes Mermaid Source field", () => {
    expect(TASK_SKILL_BODY).toContain("Mermaid Source");
  });
});
