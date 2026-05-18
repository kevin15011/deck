import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildOpenCodeDeveloperTeamInstallPlan,
  applyOpenCodeDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyOpenCodeDeveloperTeamInstall,
} from "./developer-team-install";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "deck-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

function ensureOpenCodeDirs(projectRoot: string) {
  mkdirSync(join(projectRoot, ".opencode", "agents"), { recursive: true });
  mkdirSync(join(projectRoot, ".opencode", "skills"), { recursive: true });
}

describe("buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("includes all 12 agents, 12 skills, and project .opencode paths", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/my-project");

    expect(plan.projectRoot).toBe("/tmp/my-project");
    expect(plan.agentsDir).toBe("/tmp/my-project/.opencode/agents");
    expect(plan.skillsDir).toBe("/tmp/my-project/.opencode/skills");
    expect(plan.agents).toHaveLength(12);
    expect(plan.skills).toHaveLength(12);

    const agentIds = plan.agents.map((a) => a.agent.id);
    expect(agentIds).toContain("deck-developer-orchestrator");
    expect(agentIds).toContain("deck-developer-archive");
    expect(agentIds).toContain("deck-developer-apply-general");
    expect(agentIds).toContain("deck-developer-apply-backend");
    expect(agentIds).toContain("deck-developer-apply-frontend");

    const skillIds = plan.skills.map((s) => s.agent.id);
    expect(skillIds).toEqual(agentIds);
  });

  test("each planned agent has .opencode/agents relative path with team-scoped ID and valid content", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      expect(planned.relativePath).toMatch(/^\.opencode\/agents\/deck-developer-.*\.md$/);
      expect(planned.absolutePath).toBe(join("/tmp/project", planned.relativePath));
      expect(planned.content).toContain("---");
      expect(planned.content).toContain(`name: ${planned.agent.name}`);
      expect(planned.content).toContain(`description: ${planned.agent.description}`);
    }
  });

  test("each agent prompt explicitly references its matching skillId", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      expect(planned.content).toContain(`skill: ${planned.agent.skillId}`);
    }
  });

  test("each planned skill has .opencode/skills/<team-scoped-id>/SKILL.md path and valid content", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.skills) {
      expect(planned.relativePath).toMatch(/^\.opencode\/skills\/deck-developer-[^/]+\/SKILL\.md$/);
      expect(planned.absolutePath).toBe(join("/tmp/project", planned.relativePath));
      expect(planned.content).toContain("---");
      expect(planned.content).toContain(`description: ${planned.agent.description}`);
      // Derive expected heading from core registry — no agent-specific branching needed
      const registryContent = getAgentContent(planned.agent.id)!;
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      expect(headingMatch).toBeTruthy();
      expect(planned.content).toContain(headingMatch![0]);
    }
  });

  test("does not contain .pi paths", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      expect(planned.relativePath).not.toContain(".pi");
      expect(planned.absolutePath).not.toContain(".pi");
    }
    for (const planned of plan.skills) {
      expect(planned.relativePath).not.toContain(".pi");
      expect(planned.absolutePath).not.toContain(".pi");
    }
  });
});

describe("applyOpenCodeDeveloperTeamInstall", () => {
  test("writes valid agent and skill files to temp directory", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      const result = applyOpenCodeDeveloperTeamInstall(plan);

      expect(result.results).toHaveLength(24);
      expect(result.results.filter((r) => r.kind === "agent")).toHaveLength(12);
      expect(result.results.filter((r) => r.kind === "skill")).toHaveLength(12);
      expect(result.results.every((r) => r.status === "created")).toBe(true);

      // Spot-check one agent file has valid frontmatter and body
      const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
      const content = orchestrator.content;
      expect(content).toContain("name: deck-developer-orchestrator");
      expect(content).toContain("description:");
      expect(content).toContain("# Orchestrator Agent");
      expect(content).toContain("## Project Standards (auto-resolved)");

      // Spot-check one skill file — orchestrator has real content
      const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
      const skillContent = orchestratorSkill.content;
      expect(skillContent).toContain("# Orchestrator Skill");
      expect(skillContent).toContain("SDD Workflow");

      // Explorer skill has real (non-placeholder) content
      const explorerSkill = plan.skills.find((s) => s.agent.id === "deck-developer-explorer")!;
      expect(explorerSkill.content).toContain("# Explorer Skill");
      expect(explorerSkill.content).toContain("Investigation Steps");
      expect(explorerSkill.content).not.toContain("Placeholder");

      // Explorer agent has real (non-placeholder) content
      const explorerAgent = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
      expect(explorerAgent.content).toContain("# Explorer Agent");
      expect(explorerAgent.content).toContain("investigator, not an implementor");
      expect(explorerAgent.content).not.toContain("Placeholder");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("re-applying unchanged files is idempotent", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);

      // First apply
      const first = applyOpenCodeDeveloperTeamInstall(plan);
      expect(first.results.every((r) => r.status === "created")).toBe(true);

      // Second apply — same plan, same content
      const second = applyOpenCodeDeveloperTeamInstall(plan);
      expect(second.results.every((r) => r.status === "unchanged")).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("detects updated files when content differs", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);

      // First apply
      applyOpenCodeDeveloperTeamInstall(plan);

      // Corrupt one agent file
      const target = plan.agents[0];
      writeFileSync(target.absolutePath, "corrupted", "utf-8");

      // Re-apply
      const result = applyOpenCodeDeveloperTeamInstall(plan);
      const targetResult = result.results.find((r) => r.agentId === target.agent.id && r.kind === "agent");
      expect(targetResult?.status).toBe("updated");

      // Others unchanged
      const others = result.results.filter((r) => r.agentId !== target.agent.id || r.kind !== "agent");
      expect(others.every((r) => r.status === "unchanged")).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("verifyOpenCodeDeveloperTeamInstall", () => {
  test("passes when all agent and skill files exist with correct content", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      applyOpenCodeDeveloperTeamInstall(plan);

      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.agentResults).toHaveLength(12);
      expect(verifyResult.agentResults.every((r) => r.valid)).toBe(true);
      expect(verifyResult.skillResults).toHaveLength(12);
      expect(verifyResult.skillResults.every((r) => r.valid)).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("catches missing agent files", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);

      // Don't apply — verify should fail
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.agentResults).toHaveLength(12);
      expect(verifyResult.agentResults.every((r) => !r.valid)).toBe(true);
      expect(verifyResult.skillResults).toHaveLength(12);
      expect(verifyResult.skillResults.every((r) => !r.valid)).toBe(true);

      // Each should report missing file
      for (const r of verifyResult.agentResults) {
        expect(r.issues).toContain("File does not exist.");
      }
      for (const r of verifyResult.skillResults) {
        expect(r.issues).toContain("File does not exist.");
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  test("catches name/description mismatch in agent frontmatter", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      applyOpenCodeDeveloperTeamInstall(plan);

      // Corrupt the name in one agent file
      const target = plan.agents[0];
      const content = readFileSync(target.absolutePath, "utf-8");
      writeFileSync(target.absolutePath, content.replace(`name: ${target.agent.name}`, "name: wrong-name"), "utf-8");

      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);

      const targetResult = verifyResult.agentResults.find((r) => r.agentId === target.agent.id);
      expect(targetResult?.valid).toBe(false);
      expect(targetResult?.issues.length).toBeGreaterThan(0);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("catches corrupted skill files", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      applyOpenCodeDeveloperTeamInstall(plan);

      // Corrupt one skill file
      const target = plan.skills[0];
      writeFileSync(target.absolutePath, "corrupted", "utf-8");

      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);

      const targetResult = verifyResult.skillResults.find((r) => r.agentId === target.agent.id);
      expect(targetResult?.valid).toBe(false);
      expect(targetResult?.issues.length).toBeGreaterThan(0);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("backupDeveloperTeamFiles", () => {
  test("captures existing file content and records null for missing files", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      ensureOpenCodeDirs(projectRoot);

      // Pre-create one agent file
      writeFileSync(plan.agents[0].absolutePath, "old-content", "utf-8");

      const backup = backupDeveloperTeamFiles(plan);
      expect(backup.entries).toHaveLength(24); // 12 agents + 12 skills

      // The pre-existing file should have its content captured
      const existingEntry = backup.entries.find((e) => e.absolutePath === plan.agents[0].absolutePath)!;
      expect(existingEntry.previousContent).toBe("old-content");

      // Files that didn't exist should have null
      const missingEntries = backup.entries.filter((e) => e.previousContent === null);
      expect(missingEntries).toHaveLength(23);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("captures all null when project is empty", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      const backup = backupDeveloperTeamFiles(plan);

      expect(backup.entries.every((e) => e.previousContent === null)).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("rollbackDeveloperTeamFiles", () => {
  test("restores overwritten file content", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      ensureOpenCodeDirs(projectRoot);
      writeFileSync(plan.agents[0].absolutePath, "original-content", "utf-8");

      const backup = backupDeveloperTeamFiles(plan);

      // Overwrite via apply
      applyOpenCodeDeveloperTeamInstall(plan);
      expect(readFileSync(plan.agents[0].absolutePath, "utf-8")).not.toBe("original-content");

      // Rollback
      rollbackDeveloperTeamFiles(backup);
      expect(readFileSync(plan.agents[0].absolutePath, "utf-8")).toBe("original-content");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("removes newly-created agent and skill files", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      const backup = backupDeveloperTeamFiles(plan);

      // Apply creates all files
      applyOpenCodeDeveloperTeamInstall(plan);
      expect(existsSync(plan.agents[0].absolutePath)).toBe(true);
      expect(existsSync(plan.skills[0].absolutePath)).toBe(true);

      // Rollback removes them
      rollbackDeveloperTeamFiles(backup);
      expect(existsSync(plan.agents[0].absolutePath)).toBe(false);
      expect(existsSync(plan.skills[0].absolutePath)).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("returns tree to previous state after partial apply", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      ensureOpenCodeDirs(projectRoot);

      // Also create the skill subdirectory for skills[0]
      mkdirSync(join(projectRoot, ".opencode", "skills", plan.skills[0].agent.id), { recursive: true });

      // Pre-create some files with known content
      writeFileSync(plan.agents[0].absolutePath, "agent-0-original", "utf-8");
      writeFileSync(plan.skills[0].absolutePath, "skill-0-original", "utf-8");

      const backup = backupDeveloperTeamFiles(plan);

      // Simulate partial apply: only write a few files
      mkdirSync(join(projectRoot, ".opencode", "skills", plan.skills[1].agent.id), { recursive: true });
      writeFileSync(plan.agents[0].absolutePath, "agent-0-new", "utf-8");
      writeFileSync(plan.agents[1].absolutePath, "agent-1-new", "utf-8");
      writeFileSync(plan.skills[1].absolutePath, "skill-1-new", "utf-8");

      // Rollback
      rollbackDeveloperTeamFiles(backup);

      // Pre-existing files restored
      expect(readFileSync(plan.agents[0].absolutePath, "utf-8")).toBe("agent-0-original");
      expect(readFileSync(plan.skills[0].absolutePath, "utf-8")).toBe("skill-0-original");

      // Newly-created files removed
      expect(existsSync(plan.agents[1].absolutePath)).toBe(false);
      expect(existsSync(plan.skills[1].absolutePath)).toBe(false);

      // Files never touched still don't exist
      expect(existsSync(plan.skills[2].absolutePath)).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });
});
