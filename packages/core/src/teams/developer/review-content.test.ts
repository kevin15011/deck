import { describe, expect, test } from "bun:test";

import { REVIEW_COMPACT_AGENT_BODY, REVIEW_COMPACT_SKILL_BODY } from "./review-content";
import { FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";

describe("T09 independent warning judgment contract", () => {
  const surfaces = [REVIEW_COMPACT_AGENT_BODY, REVIEW_COMPACT_SKILL_BODY];

  test("composes the exact finding-disposition authority once on every surface", () => {
    for (const surface of surfaces) {
      expect(surface.split(FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1).length - 1).toBe(1);
    }
  });
});
