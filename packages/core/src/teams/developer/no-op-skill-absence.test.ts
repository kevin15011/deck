/**
 * No-op absence tests for Phase 3F selective skill consolidation.
 *
 * These tests verify that the 10 no-op skills are NOT referenced as
 * `Follow the ...` canonical lines in any of the 6 target Developer Team
 * content surfaces (SKILL_BODY or AGENT_BODY) for:
 *
 *   - apply-backend-content
 *   - apply-frontend-content
 *   - apply-general-content
 *   - review-content
 *   - design-content
 *   - proposal-content
 *
 * The rationale for each no-op skill is documented in
 * `docs/skills-integration-roadmap.md` under "Phase 3F selective no-op
 * decisions". Skills are excluded because they are either:
 *   - interactive (require user conversation)
 *   - phase-mismatch (not applicable to autonomous construction/review)
 *   - negligible-overlap (scope does not overlap with agent responsibilities)
 *
 * REQ coverage: REQ-noop-001, REQ-noop-002, REQ-ver-003, REQ-ver-004
 */
import { describe, expect, test } from "bun:test";

import {
  APPLY_BACKEND_AGENT_BODY,
  APPLY_BACKEND_SKILL_BODY,
} from "./apply-backend-content";
import {
  APPLY_FRONTEND_AGENT_BODY,
  APPLY_FRONTEND_SKILL_BODY,
} from "./apply-frontend-content";
import {
  APPLY_GENERAL_AGENT_BODY,
  APPLY_GENERAL_SKILL_BODY,
} from "./apply-general-content";
import {
  REVIEW_AGENT_BODY,
  REVIEW_SKILL_BODY,
} from "./review-content";
import {
  DESIGN_AGENT_BODY,
  DESIGN_SKILL_BODY,
} from "./design-content";
import {
  PROPOSAL_AGENT_BODY,
  PROPOSAL_SKILL_BODY,
} from "./proposal-content";

// ---------------------------------------------------------------------------
// 10 no-op skills with rationale classification
// ---------------------------------------------------------------------------

type NoopRationale = "interactive" | "phase-mismatch" | "negligible-overlap";

const NOOP_SKILLS: ReadonlyArray<{ skill: string; rationale: NoopRationale }> = [
  // Interactive — requires user conversation
  { skill: "idea-refine", rationale: "interactive" },
  { skill: "interview-me", rationale: "interactive" },
  // Phase-mismatch — not applicable to autonomous construction/review
  { skill: "debugging-and-error-recovery", rationale: "phase-mismatch" },
  { skill: "doubt-driven-development", rationale: "phase-mismatch" },
  { skill: "judgment-day", rationale: "phase-mismatch" },
  // Negligible-overlap — scope does not overlap with agent responsibilities
  { skill: "git-workflow-and-versioning", rationale: "negligible-overlap" },
  { skill: "ci-cd-and-automation", rationale: "negligible-overlap" },
  { skill: "code-simplification", rationale: "negligible-overlap" },
  { skill: "comment-writer", rationale: "negligible-overlap" },
  { skill: "shipping-and-launch", rationale: "negligible-overlap" },
];

const SURFACES = [
  { name: "APPLY_BACKEND_SKILL_BODY", body: APPLY_BACKEND_SKILL_BODY },
  { name: "APPLY_BACKEND_AGENT_BODY", body: APPLY_BACKEND_AGENT_BODY },
  { name: "APPLY_FRONTEND_SKILL_BODY", body: APPLY_FRONTEND_SKILL_BODY },
  { name: "APPLY_FRONTEND_AGENT_BODY", body: APPLY_FRONTEND_AGENT_BODY },
  { name: "APPLY_GENERAL_SKILL_BODY", body: APPLY_GENERAL_SKILL_BODY },
  { name: "APPLY_GENERAL_AGENT_BODY", body: APPLY_GENERAL_AGENT_BODY },
  { name: "REVIEW_SKILL_BODY", body: REVIEW_SKILL_BODY },
  { name: "REVIEW_AGENT_BODY", body: REVIEW_AGENT_BODY },
  { name: "DESIGN_SKILL_BODY", body: DESIGN_SKILL_BODY },
  { name: "DESIGN_AGENT_BODY", body: DESIGN_AGENT_BODY },
  { name: "PROPOSAL_SKILL_BODY", body: PROPOSAL_SKILL_BODY },
  { name: "PROPOSAL_AGENT_BODY", body: PROPOSAL_AGENT_BODY },
];

// ---------------------------------------------------------------------------
// No-op absence verification tests
// ---------------------------------------------------------------------------

describe("Phase 3F no-op skill absence guarantees", () => {
  // Sanity check: the no-op list must contain exactly 10 skills (REQ-noop-001)
  test("NOOP_SKILLS catalog contains exactly 10 skills", () => {
    expect(NOOP_SKILLS.length).toBe(10);
  });

  // For every (noop skill, surface) pair, the surface must not contain
  // a "Follow the {skill} skill" canonical reference.
  for (const { skill, rationale } of NOOP_SKILLS) {
    describe(`no-op skill: ${skill} (${rationale})`, () => {
      const refVariants = [
        `Follow the ${skill} skill`,
        `Follow the \`${skill}\` skill`,
        `Follow the ${skill} for`,
        `Follow the \`${skill}\` for`,
      ];

      for (const surface of SURFACES) {
        test(`${surface.name} does not reference ${skill} as a Follow-the skill`, () => {
          for (const variant of refVariants) {
            expect(
              surface.body.includes(variant),
              `Expected ${surface.name} to NOT contain "${variant}" (no-op skill: ${skill}, rationale: ${rationale})`,
            ).toBe(false);
          }
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Aggregate rationale coverage tests
// ---------------------------------------------------------------------------

describe("No-op rationale classification coverage", () => {
  test("interactive category contains exactly 2 skills", () => {
    const interactive = NOOP_SKILLS.filter((s) => s.rationale === "interactive");
    expect(interactive.map((s) => s.skill).sort()).toEqual(["idea-refine", "interview-me"]);
  });

  test("phase-mismatch category contains exactly 3 skills", () => {
    const phaseMismatch = NOOP_SKILLS.filter((s) => s.rationale === "phase-mismatch");
    expect(phaseMismatch.map((s) => s.skill).sort()).toEqual([
      "debugging-and-error-recovery",
      "doubt-driven-development",
      "judgment-day",
    ]);
  });

  test("negligible-overlap category contains exactly 5 skills", () => {
    const negligible = NOOP_SKILLS.filter((s) => s.rationale === "negligible-overlap");
    expect(negligible.map((s) => s.skill).sort()).toEqual([
      "ci-cd-and-automation",
      "code-simplification",
      "comment-writer",
      "git-workflow-and-versioning",
      "shipping-and-launch",
    ]);
  });
});
