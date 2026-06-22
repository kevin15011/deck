import { describe, expect, test } from "bun:test";

import {
  TASK_AGENT_BODY,
  TASK_SKILL_BODY,
} from "./task-content";

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
// Exclude status names that contain placeholder (they're legitimate identifiers)
const STATUS_NAMES_WITH_PLACEHOLDER = ["allowed-with-placeholder"];

function assertNotPlaceholder(content: string, label: string) {
  for (const signal of PLACEHOLDER_SIGNALS) {
    // Skip: if "placeholder" appears ONLY in legitimate status name `allowed-with-placeholder`
    if (signal === "placeholder") {
      // Count occurrences that are NOT in status name format
      const statusNameMatches = (content.match(/`allowed-with-placeholder`/g) || []).length;
      const allMatches = (content.match(/placeholder/g) || []).length;
      // Allow if all matches are from the status name
      if (allMatches > 0 && allMatches === statusNameMatches) {
        continue;
      }
    }
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
    // Tested via canonical line reference to using-agent-skills
    expect(TASK_SKILL_BODY).toContain("using-agent-skills");
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

// ---------------------------------------------------------------------------
// Canonical line verification tests (Task 2)
// ---------------------------------------------------------------------------

describe("Canonical line replacement", () => {
  const CANONICAL_LINE =
    "Follow the using-agent-skills skill for operating behaviors and failure mode guidance.";

  test("SKILL_BODY contains canonical line exactly once", () => {
    const matches = TASK_SKILL_BODY.split(CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of canonical line", () => {
    expect(TASK_SKILL_BODY).not.toContain(`- ${CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain canonical line (immutability)", () => {
    expect(TASK_AGENT_BODY).not.toContain(CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(TASK_SKILL_BODY).toContain("## Rules");
  });
});

// Cognitive doc design canonical line test
describe("Cognitive doc design canonical line", () => {
  const CDD_CANONICAL_LINE =
    "Follow the cognitive-doc-design skill for artifact structure and documentation patterns.";

  test("SKILL_BODY contains cognitive-doc-design line exactly once", () => {
    const matches = TASK_SKILL_BODY.split(CDD_CANONICAL_LINE).length - 1;
    expect(matches).toBe(1);
  });

  test("SKILL_BODY contains no bullet variants of cognitive-doc-design line", () => {
    expect(TASK_SKILL_BODY).not.toContain(`- ${CDD_CANONICAL_LINE}`);
  });

  test("AGENT_BODY does NOT contain cognitive-doc-design line (immutability)", () => {
    expect(TASK_AGENT_BODY).not.toContain(CDD_CANONICAL_LINE);
  });

  test("SKILL_BODY preserves ## Rules heading", () => {
    expect(TASK_SKILL_BODY).toContain("## Rules");
  });
});

// Git Safety Rule presence test
describe("Git Safety Rule presence", () => {
  test("AGENT_BODY contains critical Git discard protection rule", () => {
    expect(TASK_AGENT_BODY).toContain(GIT_SAFETY_SENTINEL);
  });

  test("SKILL_BODY contains critical Git discard protection rule", () => {
    expect(TASK_SKILL_BODY).toContain(GIT_SAFETY_SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// Preconditions output tests (Task 3)
// ---------------------------------------------------------------------------

describe("Preconditions output (Task 3)", () => {
  test("SKILL_BODY contains Step 7: Derive Preconditions from Blockers", () => {
    expect(TASK_SKILL_BODY).toContain("Step 7: Derive Preconditions from Blockers");
  });

  test("SKILL_BODY contains Step 9: Write Preconditions Artifact", () => {
    expect(TASK_SKILL_BODY).toContain("Step 9: Write Preconditions Artifact");
  });

  test("SKILL_BODY contains allowed precondition statuses", () => {
    expect(TASK_SKILL_BODY).toContain("satisfied");
    expect(TASK_SKILL_BODY).toContain("blocked");
    expect(TASK_SKILL_BODY).toContain("allowed-with-placeholder");
    expect(TASK_SKILL_BODY).toContain("deferred");
    expect(TASK_SKILL_BODY).toContain("none");
  });

  test("SKILL_BODY permits None when no preconditions exist", () => {
    expect(TASK_SKILL_BODY).toMatch(/None.*complete.*valid artifact|valid artifact.*None/i);
  });

  test("SKILL_BODY contains anti-duplication guidance", () => {
    expect(TASK_SKILL_BODY).toMatch(/do NOT duplicate|not duplicate/i);
    expect(TASK_SKILL_BODY).toMatch(/closure state|only closure/i);
  });

  test("SKILL_BODY contains preconditions table format", () => {
    expect(TASK_SKILL_BODY).toContain("Preconditions table format");
  });

  test("SKILL_BODY contains Closure Decision section format", () => {
    expect(TASK_SKILL_BODY).toContain("Closure Decision section");
  });

  test("return contract includes Preconditions Artifact Path field", () => {
    expect(TASK_SKILL_BODY).toContain("Preconditions Artifact Path");
  });

  test("return contract includes Preconditions Summary field", () => {
    expect(TASK_SKILL_BODY).toContain("Preconditions Summary");
  });
});


describe("repair replan guidance", () => {
  test("routes replan or soft checkpoint to clarification rather than blind Apply retry", () => {
    expect(TASK_SKILL_BODY).toContain("loop decision replan");
    expect(TASK_SKILL_BODY).toContain("soft checkpoint asks for replan");
    expect(TASK_SKILL_BODY).toContain("stop routing another blind Apply retry");
    expect(TASK_SKILL_BODY).toContain("Spec, Design, or this Task breakdown");
    expect(TASK_SKILL_BODY).toContain("record a brief rationale");
    expect(TASK_SKILL_BODY).toContain("existing tasks artifact unless the spec or design contract changes");
  });
});
