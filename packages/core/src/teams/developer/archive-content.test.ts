import { describe, expect, test } from "bun:test";

import {
  ARCHIVE_AGENT_BODY,
  ARCHIVE_SKILL_BODY,
} from "./archive-content";

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
// ARCHIVE_AGENT_BODY
// ---------------------------------------------------------------------------

describe("ARCHIVE_AGENT_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(ARCHIVE_AGENT_BODY, "ARCHIVE_AGENT_BODY");
  });

  test("contains identity header with Archive Agent name", () => {
    expect(ARCHIVE_AGENT_BODY).toContain("# Archive Agent");
  });

  test("describes change closer role", () => {
    expect(ARCHIVE_AGENT_BODY).toMatch(/change closer|close completed/i);
  });

  test("contains team-scoped ID reference", () => {
    expect(ARCHIVE_AGENT_BODY).toContain("deck-developer-archive");
  });

  test("instructs to follow matching skill", () => {
    expect(ARCHIVE_AGENT_BODY).toContain("Follow the matching skill");
  });

  test("states terminal behavior: no delegation", () => {
    expect(ARCHIVE_AGENT_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("references artifact persistence behavior", () => {
    expect(ARCHIVE_AGENT_BODY).toMatch(/artifact|persist|store|OpenSpec directory/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(ARCHIVE_AGENT_BODY).not.toContain("pi launcher");
    expect(ARCHIVE_AGENT_BODY).not.toContain("deck pi");
    expect(ARCHIVE_AGENT_BODY).not.toContain("/sdd-");
  });

  test("mentions traceability report", () => {
    expect(ARCHIVE_AGENT_BODY).toMatch(/traceability/i);
  });
});

// ---------------------------------------------------------------------------
// ARCHIVE_SKILL_BODY
// ---------------------------------------------------------------------------

describe("ARCHIVE_SKILL_BODY", () => {
  test("is not placeholder content", () => {
    assertNotPlaceholder(ARCHIVE_SKILL_BODY, "ARCHIVE_SKILL_BODY");
  });

  test("contains skill title", () => {
    expect(ARCHIVE_SKILL_BODY).toContain("# Archive Skill");
  });

  test("references archive artifact under OpenSpec", () => {
    expect(ARCHIVE_SKILL_BODY).toContain("openspec/");
    expect(ARCHIVE_SKILL_BODY).toContain("archive-report.md");
  });

  test("states terminal behavior: no delegation", () => {
    expect(ARCHIVE_SKILL_BODY).toMatch(/terminal|do(es)? not delegate/i);
  });

  test("describes traceability matrix", () => {
    expect(ARCHIVE_SKILL_BODY).toMatch(/traceability matrix/i);
  });

  test("does not reference Pi-specific launcher behavior", () => {
    expect(ARCHIVE_SKILL_BODY).not.toContain("pi launcher");
    expect(ARCHIVE_SKILL_BODY).not.toContain("deck pi");
    expect(ARCHIVE_SKILL_BODY).not.toContain("/sdd-");
  });

  test("contains structured return format for orchestrator consumption", () => {
    expect(ARCHIVE_SKILL_BODY).toMatch(/## Archive Report|## Return Summary/i);
  });
});
