import { describe, expect, test } from "bun:test";

import { VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY } from "./verify-content";
import { FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";

describe("T08 evidence-bound warning contract", () => {
  const surfaces = [VERIFY_COMPACT_AGENT_BODY, VERIFY_COMPACT_SKILL_BODY];

  test("composes the exact finding-disposition authority once on every surface", () => {
    for (const surface of surfaces) {
      expect(surface.split(FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1).length - 1).toBe(1);
    }
  });
});
