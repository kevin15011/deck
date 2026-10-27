import { describe, expect, test } from "bun:test";

import { APPLY_BACKEND_COMPACT_SKILL_BODY } from "./apply-backend-content";

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


describe("backend pre-QA functional validation", () => {
  test("requires real backend behavior exercise without claiming independent QA", () => {
    for (const body of [APPLY_BACKEND_COMPACT_SKILL_BODY]) {
      expect(body).toContain("focused local proof");
      expect(body).toContain("backend functional exercise");
      expect(body).toContain("fix and retest");
      expect(body).toContain("non-independent");
      expect(body).toContain("conditional target");
      expect(body).toContain("fresh independent QA");
    }
    expect(APPLY_BACKEND_COMPACT_SKILL_BODY).not.toContain("scheduled targeted, affected-area, and broad checks");
  });
});
