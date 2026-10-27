import { describe, expect, test } from "bun:test";

import { ARCHIVE_COMPACT_AGENT_BODY, ARCHIVE_COMPACT_SKILL_BODY } from "./archive-content";
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

describe("T10 durable warning preservation contract", () => {
  const surfaces = [ARCHIVE_COMPACT_AGENT_BODY, ARCHIVE_COMPACT_SKILL_BODY];

  test("composes the exact finding-disposition authority once on every surface", () => {
    for (const surface of surfaces) {
      expect(surface.split(FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1).length - 1).toBe(1);
    }
  });

  test("allows validated warnings only without blockers and retains canonical archived status", () => {
    for (const surface of surfaces) {
      expect(surface).toMatch(/validated warning/i);
      expect(surface).toMatch(/no blocker|without blockers/i);
    }
    expect(ARCHIVE_COMPACT_SKILL_BODY).toMatch(/archived.*RegistryIntentV1|RegistryIntentV1.*archived/is);
  });
});
