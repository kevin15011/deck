import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDeveloperTeamInstallPlan } from "./developer-team-install";

let root: string;
let projectRoot: string;
let packageRoot: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-layout-"));
  projectRoot = join(root, "project");
  packageRoot = join(root, "agent", "deck", "package");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("buildDeveloperTeamInstallPlan with a global package layout", () => {
  test("plans agents and skills inside the package, never under the project", () => {
    const plan = buildDeveloperTeamInstallPlan(projectRoot, { layout: { packageRoot } });

    expect(plan.agentsDir).toBe(join(packageRoot, "agents"));
    expect(plan.skillsDir).toBe(join(packageRoot, "skills"));
    const planned = [...plan.agents, ...plan.skills, ...plan.standaloneSkills, ...plan.sddSkillFiles];
    expect(planned.length).toBeGreaterThan(0);
    for (const file of planned) {
      expect(file.absolutePath.startsWith(`${packageRoot}/`)).toBe(true);
      expect(file.absolutePath.includes(projectRoot)).toBe(false);
      expect(file.relativePath.startsWith(".pi/")).toBe(false);
    }
  });

  test("relative paths are package-relative", () => {
    const plan = buildDeveloperTeamInstallPlan(projectRoot, { layout: { packageRoot }, standaloneSkills: [{ skillId: "demo", body: "# demo\n", files: { "references/a.md": "# a\n" } }] });
    expect(plan.agents.map((agent) => agent.relativePath)).toContain("agents/deck-lead.md");
    expect(plan.skills.map((skill) => skill.relativePath)).toContain("skills/deck-lead/SKILL.md");
    expect(plan.standaloneSkills.map((skill) => skill.relativePath).sort()).toEqual(["skills/demo/SKILL.md", "skills/demo/references/a.md"]);
  });

  test("the Lead stub references the global profile rather than a project path", () => {
    const plan = buildDeveloperTeamInstallPlan(projectRoot, { layout: { packageRoot, profileReference: "deck/profiles/<team>/system-prompt.md" } });
    const lead = plan.agents.find((agent) => agent.agent.id === "deck-lead")!;
    expect(lead.content).toContain("deck/profiles/<team>/system-prompt.md");
    expect(lead.content).not.toContain(".deck/pi/profiles");
  });

  test("planning performs no filesystem writes", () => {
    buildDeveloperTeamInstallPlan(projectRoot, { layout: { packageRoot } });
    expect(readdirSync(root)).toEqual([]);
  });

  test("the legacy project layout is unchanged when no layout is given", () => {
    const plan = buildDeveloperTeamInstallPlan(projectRoot);
    expect(plan.agentsDir).toBe(join(projectRoot, ".pi", "agents"));
    expect(plan.agents[0]!.relativePath.startsWith(".pi/agents/")).toBe(true);
  });
});
