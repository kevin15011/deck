import { describe, expect, test } from "bun:test";

import {
  APPLY_BACKEND_AGENT_BODY,
  APPLY_BACKEND_SKILL_BODY,
} from "./apply-backend-content";

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
// APPLY_BACKEND_AGENT_BODY
// ---------------------------------------------------------------------------

describe("APPLY_BACKEND_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_BACKEND_AGENT_BODY, "APPLY_BACKEND_AGENT_BODY");
  });

  test("contains identity header with Backend Apply Agent name", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toContain("# Backend Apply Agent");
  });

  test("describes backend implementor role", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toMatch(/backend implementor/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toContain("deck-developer-apply-backend");
  });

  test("instructs to follow matching skill", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toMatch(/artifact|persist|store/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_BACKEND_AGENT_BODY).not.toContain("pi launcher");
    expect(APPLY_BACKEND_AGENT_BODY).not.toContain("deck pi");
    expect(APPLY_BACKEND_AGENT_BODY).not.toContain("/sdd-");
  });

  test("prohibits silently changing frontend-facing contracts", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toMatch(/do(es)? not.*silently.*change.*frontend.*contract/i);
  });

  test("prohibits frontend implementation", () => {
    expect(APPLY_BACKEND_AGENT_BODY).toMatch(/do(es)? not.*implement.*frontend|UI|client-side/i);
  });
});

// ---------------------------------------------------------------------------
// APPLY_BACKEND_SKILL_BODY
// ---------------------------------------------------------------------------

describe("APPLY_BACKEND_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(APPLY_BACKEND_SKILL_BODY, "APPLY_BACKEND_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toContain("# Backend Apply Skill");
  });

  test("references apply-progress artifact under OpenSpec", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toContain("openspec/");
    expect(APPLY_BACKEND_SKILL_BODY).toContain("apply-progress.md");
  });

  test("states terminal behavior: no delegation", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("describes backend verification steps", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toMatch(/backend.*test|build|typecheck/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(APPLY_BACKEND_SKILL_BODY).not.toContain("pi launcher");
    expect(APPLY_BACKEND_SKILL_BODY).not.toContain("deck pi");
    expect(APPLY_BACKEND_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toMatch(/## Apply Progress|## Return Summary/i);
  });
});

// REQ-SAE-001 to REQ-SAE-007: Serena enforcement tests
describe("Serena enforcement rules", () => {
  test("contains Serena enforcement section when package selected", () => {
    // Apply content should mention Serena for enforcement
    expect(APPLY_BACKEND_SKILL_BODY).toContain("Serena Enforcement");
  });

  test("mention find_symbol for symbolic operations", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toContain("find_symbol");
  });

  test("mention replace_symbol_body for replacement", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toContain("replace_symbol_body");
  });

  test("mention coexistance with codebase-memory", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toContain("codebase-memory");
  });

  test("mention fallback reporting", () => {
    expect(APPLY_BACKEND_SKILL_BODY).toMatch(/Fallback|report/i);
  });

  test("does NOT validate CLI existence", () => {
    // The enforcement section explicitly says NOT to validate CLI - check the negation is present
    expect(APPLY_BACKEND_SKILL_BODY).toContain("No CLI validation");
  });
});
