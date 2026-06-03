import { describe, expect, test } from "bun:test";

import {
  ARCHIVE_AGENT_BODY,
  ARCHIVE_SKILL_BODY,
} from "./archive-content";

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
    // Tested via canonical line reference to using-agent-skills
    expect(ARCHIVE_SKILL_BODY).toContain("using-agent-skills");
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

  // --- Need 2: Post-Archive Git Suggestions ---
  test("skill body contains diff context preparation step", () => {
    expect(ARCHIVE_SKILL_BODY).toContain("Prepare Diff Context");
    expect(ARCHIVE_SKILL_BODY).toContain("Git Suggestion Context");
  });

  // --- Need 5: Self-Verification ---
  test("skill body contains self-verification step", () => {
    expect(ARCHIVE_SKILL_BODY).toContain("Self-Verify Artifact");
  });
});

// ---------------------------------------------------------------------------
// Canonical line verification tests (Task 2)
// ---------------------------------------------------------------------------

describe("Canonical line replacement", () => {
  const CANONICAL_LINE =
    "Follow the using-agent-skills skill for operating behaviors and failure mode guidance.";

  test("SKILL_BODY contains canonical line exactly once", () => {
    const matches = ARCHIVE_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(ARCHIVE_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain canonical line (immutability)", () => {
    expect(ARCHIVE_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(ARCHIVE_SKILL_BODY).toContain("## Rules");
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(ARCHIVE_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(ARCHIVE_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});
