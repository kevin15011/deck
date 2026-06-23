import { describe, expect, test } from "bun:test";

import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import { getStandaloneSkills } from "@deck/core/skills/external";

const FRONTEND_SKILL_IDS = [
  "ui-skills-root",
  "frontend-design",
  "baseline-ui",
  "fixing-accessibility",
  "fixing-motion-performance",
  "fixing-metadata",
  "web-quality-audit",
  "playwright-cli",
  "design-lab",
] as const;

describe("OpenCode RunnerAdapter developer team install plan", () => {
  test("includes complete standalone external skills by default", () => {
    const adapter = createOpenCodeRunnerAdapter();
    const plan = adapter.buildDeveloperTeamInstallPlan({
      projectRoot: "/tmp/deck-opencode-runner-adapter-test",
      environmentId: "opencode-development",
    });

    const standaloneFiles = plan.files.filter((file) => file.kind === "standalone-skill");
    const installedSkillIds = new Set(standaloneFiles.map((file) => file.skillId));

    expect(installedSkillIds.size).toBe(getStandaloneSkills().length);
    for (const skillId of FRONTEND_SKILL_IDS) {
      expect(installedSkillIds).toContain(skillId);
      expect(standaloneFiles).toContainEqual(expect.objectContaining({
        kind: "standalone-skill",
        skillId,
        packagePath: "SKILL.md",
        path: `skills/${skillId}/SKILL.md`,
      }));
    }

    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      skillId: "web-quality-audit",
      packagePath: "scripts/analyze.sh",
      path: "skills/web-quality-audit/scripts/analyze.sh",
    }));
    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      skillId: "playwright-cli",
      packagePath: "references/tracing.md",
      path: "skills/playwright-cli/references/tracing.md",
    }));
    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      skillId: "design-lab",
      packagePath: "DESIGN_PRINCIPLES.md",
      path: "skills/design-lab/DESIGN_PRINCIPLES.md",
    }));
  });
});
