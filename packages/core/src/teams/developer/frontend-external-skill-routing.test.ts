import { describe, expect, test } from "bun:test";

import { APPLY_BACKEND_SKILL_BODY } from "./apply-backend-content";
import { APPLY_FRONTEND_SKILL_BODY } from "./apply-frontend-content";
import { APPLY_GENERAL_SKILL_BODY } from "./apply-general-content";
import { ARCHIVE_SKILL_BODY } from "./archive-content";
import { DESIGN_SKILL_BODY } from "./design-content";
import { EXPLORER_SKILL_BODY } from "./explorer-content";
import {
  ORCHESTRATOR_AGENT_BODY,
  ORCHESTRATOR_SKILL_BODY,
  ORCHESTRATOR_SYSTEM_PROMPT,
} from "./orchestrator-content";
import { PROPOSAL_SKILL_BODY } from "./proposal-content";
import { REVIEW_SKILL_BODY } from "./review-content";
import { SPEC_SKILL_BODY } from "./spec-content";
import { TASK_SKILL_BODY } from "./task-content";
import { VERIFY_SKILL_BODY } from "./verify-content";

const ROUTINE_FRONTEND_SKILLS = [
  "ui-skills-root",
  "frontend-design",
  "baseline-ui",
  "fixing-accessibility",
  "fixing-motion-performance",
  "fixing-metadata",
  "playwright-cli",
] as const;

const QA_FRONTEND_SKILLS = [
  "baseline-ui",
  "fixing-accessibility",
  "fixing-motion-performance",
  "fixing-metadata",
  "web-quality-audit",
  "playwright-cli",
] as const;

function expectMentions(body: string, skills: readonly string[]) {
  for (const skill of skills) {
    expect(body).toContain(skill);
  }
}

function expectNoDefaultHeavyGuidance(body: string) {
  expect(body).not.toMatch(/Follow the design-lab skill/i);
  expect(body).not.toMatch(/Follow the web-quality-audit skill/i);
  expect(body).not.toMatch(/default daily.*design-lab/i);
  expect(body).not.toMatch(/default daily.*web-quality-audit/i);
}

describe("frontend external skill routing guidance", () => {
  test("orchestrator routes UI-scoped work through ui-skills-root without weakening gates", () => {
    for (const body of [
      ORCHESTRATOR_SYSTEM_PROMPT,
      ORCHESTRATOR_AGENT_BODY,
      ORCHESTRATOR_SKILL_BODY,
    ]) {
      expect(body).toContain("ui-skills-root");
      expect(body).toMatch(/router for UI/i);
      expect(body).toContain("Do not modify or delegate modifying work until this classification is made");
      expectNoDefaultHeavyGuidance(body);
    }
  });

  test("frontend apply gets day-to-day UI skill awareness without heavy or audit defaults", () => {
    expectMentions(APPLY_FRONTEND_SKILL_BODY, ROUTINE_FRONTEND_SKILLS);
    expect(APPLY_FRONTEND_SKILL_BODY).toMatch(/not.*load every downstream UI skill/i);
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("design-lab");
    expect(APPLY_FRONTEND_SKILL_BODY).not.toContain("web-quality-audit");
    expectNoDefaultHeavyGuidance(APPLY_FRONTEND_SKILL_BODY);
  });

  test("review and verify reserve web-quality-audit for audit or predeploy QA", () => {
    for (const body of [REVIEW_SKILL_BODY, VERIFY_SKILL_BODY]) {
      expectMentions(body, QA_FRONTEND_SKILLS);
      expect(body).toMatch(/audit|predeploy|broad quality review/i);
      expectNoDefaultHeavyGuidance(body);
    }
  });

  test("explorer and design scope design-lab to substantial redesign exploration", () => {
    for (const body of [EXPLORER_SKILL_BODY, DESIGN_SKILL_BODY]) {
      expect(body).toContain("ui-skills-root");
      expect(body).toContain("frontend-design");
      expect(body).toContain("design-lab");
      expect(body).toMatch(/substantial redesign|major redesign|structured exploration/i);
      expectNoDefaultHeavyGuidance(body);
    }
  });

  test("proposal, spec, and task use conditional planning wording", () => {
    for (const body of [PROPOSAL_SKILL_BODY, SPEC_SKILL_BODY, TASK_SKILL_BODY]) {
      expect(body).toContain("ui-skills-root");
      expect(body).toMatch(/when UI|if UI|UI-scoped/i);
      expectNoDefaultHeavyGuidance(body);
    }
  });

  test("backend, general, and archive roles remain free from frontend skill bloat", () => {
    for (const body of [APPLY_BACKEND_SKILL_BODY, APPLY_GENERAL_SKILL_BODY, ARCHIVE_SKILL_BODY]) {
      for (const skill of ["ui-skills-root", ...ROUTINE_FRONTEND_SKILLS, "design-lab", "web-quality-audit"]) {
        expect(body).not.toContain(skill);
      }
    }
  });
});
