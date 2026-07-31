import { describe, expect, test } from "bun:test";

import {
  APPLY_BACKEND_AGENT_BODY,
  APPLY_BACKEND_COMPACT_AGENT_BODY,
  APPLY_BACKEND_COMPACT_SKILL_BODY,
  APPLY_BACKEND_SKILL_BODY,
} from "./apply-backend-content";
import {
  APPLY_FRONTEND_AGENT_BODY,
  APPLY_FRONTEND_COMPACT_AGENT_BODY,
  APPLY_FRONTEND_COMPACT_SKILL_BODY,
  APPLY_FRONTEND_SKILL_BODY,
} from "./apply-frontend-content";
import {
  APPLY_GENERAL_AGENT_BODY,
  APPLY_GENERAL_COMPACT_AGENT_BODY,
  APPLY_GENERAL_COMPACT_SKILL_BODY,
  APPLY_GENERAL_SKILL_BODY,
} from "./apply-general-content";
import { APPLY_CONTINUOUS_DELTA_RULE_V1 } from "./continuous-development";

const SURFACES = [
  APPLY_GENERAL_AGENT_BODY,
  APPLY_GENERAL_SKILL_BODY,
  APPLY_GENERAL_COMPACT_AGENT_BODY,
  APPLY_GENERAL_COMPACT_SKILL_BODY,
  APPLY_BACKEND_AGENT_BODY,
  APPLY_BACKEND_SKILL_BODY,
  APPLY_BACKEND_COMPACT_AGENT_BODY,
  APPLY_BACKEND_COMPACT_SKILL_BODY,
  APPLY_FRONTEND_AGENT_BODY,
  APPLY_FRONTEND_SKILL_BODY,
  APPLY_FRONTEND_COMPACT_AGENT_BODY,
  APPLY_FRONTEND_COMPACT_SKILL_BODY,
] as const;

describe("Apply continuous conversational development", () => {
  test("all Apply surfaces continue authorized deltas without lifecycle restarts", () => {
    for (const surface of SURFACES) {
      expect(surface).toContain(APPLY_CONTINUOUS_DELTA_RULE_V1);
      expect(surface).toContain("There is no arbitrary revision-cycle limit");
      expect(surface).toContain("never replace fresh independent Verify or Review");
    }
  });
});
