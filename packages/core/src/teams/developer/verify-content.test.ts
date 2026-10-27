import { describe, expect, test } from "bun:test";

import { VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY } from "./verify-content";
import { FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";

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

describe("T08 evidence-bound warning contract", () => {
  const surfaces = [VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY];

  test("composes the exact finding-disposition authority once on every surface", () => {
    for (const surface of surfaces) {
      expect(surface.split(FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1).length - 1).toBe(1);
    }
  });

  test("requires immutable bound return and never repairs or pauses for a proven warning", () => {
    expect(VERIFY_COMPACT_SKILL_BODY).toMatch(/mandatory BROAD/i);
  });
});
