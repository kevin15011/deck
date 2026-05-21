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
import { DEFAULT_OPENCODE_MODELS } from "./model-config";

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck-opencode-test-"));
  mkdirSync(join(dir, ".opencode", "skills"), { recursive: true });
  return dir;
}

function createTempConfigDir(projectRoot: string): string {
  const configDir = join(projectRoot, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  return configDir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("generates 12 agent entries for opencode.json", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(Object.keys(plan.agentEntries)).toHaveLength(12);
  });

  test("orchestrator has mode: primary", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.agentEntries["deck-developer-orchestrator"].mode).toBe("primary");
  });

  test("subagents have mode: subagent and hidden: true", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const subagentIds = Object.keys(plan.agentEntries).filter((id) => id !== "deck-developer-orchestrator");
    for (const id of subagentIds) {
      expect(plan.agentEntries[id].mode).toBe("subagent");
      expect(plan.agentEntries[id].hidden).toBe(true);
    }
  });

  test("orchestrator has permission.task deny-by-default + allowlist", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const perm = plan.agentEntries["deck-developer-orchestrator"].permission?.task;
    expect(perm).toBeDefined();
    expect(perm!["*"]).toBe("deny");
    expect(perm!["deck-developer-explorer"]).toBe("allow");
    expect(perm!["deck-developer-proposal"]).toBe("allow");
  });

  test("subagents have correct tool whitelist", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const explorer = plan.agentEntries["deck-developer-explorer"];
    expect(explorer.tools).toEqual({ bash: true, edit: true, read: true, write: true });
  });

  test("orchestrator has delegation tools", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const tools = plan.agentEntries["deck-developer-orchestrator"].tools;
    expect(tools!.delegate).toBe(true);
    expect(tools!.delegation_list).toBe(true);
    expect(tools!.delegation_read).toBe(true);
  });

  test("model assignments match DEFAULT_OPENCODE_MODELS", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const [agentId, defaults] of Object.entries(DEFAULT_OPENCODE_MODELS)) {
      expect(plan.agentEntries[agentId].model).toBe(defaults.model);
    }
  });

  test("orchestrator has reasoningEffort: high", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.agentEntries["deck-developer-orchestrator"].reasoningEffort).toBe("high");
  });

  test("prompt references use {file:/absolute/path} format", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const [agentId, entry] of Object.entries(plan.agentEntries)) {
      expect(entry.prompt).toMatch(/^\{file:\//);
      expect(entry.prompt).toContain(agentId);
    }
  });

  test("generates prompt generation plan with 12 files", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.promptGenerationPlan).toHaveLength(12);
  });

  test("generates command generation plan with 14 commands", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.commandGenerationPlan).toHaveLength(14);
  });

  test("generates skill files for all 12 agents", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.skills).toHaveLength(12);
    for (const skill of plan.skills) {
      expect(skill.content).toContain("disable-model-invocation: true");
      expect(skill.content).toContain("user-invocable: false");
      expect(skill.content).toContain("delegate_only: true");
    }
  });

  test("skill content comes from core registry", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).toContain("SDD Workflow");
    expect(orchestratorSkill.content).toContain("Visual Explanations");
  });
});

describe("applyOpenCodeDeveloperTeamInstall", () => {
  test("writes skill files to .opencode/skills/ with correct content", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
      expect(existsSync(orchestratorSkill.absolutePath)).toBe(true);
      const content = readFileSync(orchestratorSkill.absolutePath, "utf-8");
      expect(content).toContain("disable-model-invocation: true");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("writes prompt files to configDir/prompts/deck-developer/", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      for (const planned of plan.promptGenerationPlan) {
        expect(existsSync(planned.absolutePath)).toBe(true);
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  test("writes command files to configDir/commands/", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      for (const planned of plan.commandGenerationPlan) {
        expect(existsSync(planned.absolutePath)).toBe(true);
        const content = readFileSync(planned.absolutePath, "utf-8");
        expect(content).toContain("agent: deck-developer-orchestrator");
        expect(content).toContain("subtask: true");
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  test("writes opencode.json with agent entries", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const configPath = join(configDir, "opencode.json");
      expect(existsSync(configPath)).toBe(true);
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.agent).toBeDefined();
      expect(config.agent["deck-developer-orchestrator"]).toBeDefined();
      expect(config.agent["deck-developer-orchestrator"].mode).toBe("primary");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("injects mermaid plugin when missing", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const configPath = join(configDir, "opencode.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(config.plugin).toContain("opencode-mermaid-renderer");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("idempotent — re-applying does not duplicate entries", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const configPath = join(configDir, "opencode.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const keys = Object.keys(config.agent ?? {});
      expect(keys.filter((k) => k.startsWith("deck-developer-"))).toHaveLength(12);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("verifyOpenCodeDeveloperTeamInstall", () => {
  test("passes when all skill files exist with correct frontmatter", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("fails when skill file is missing", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot);
      // Don't apply
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("catches missing disable-model-invocation frontmatter", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      // Corrupt one skill file
      const target = plan.skills[0];
      writeFileSync(target.absolutePath, "corrupted content", "utf-8");
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("backupDeveloperTeamFiles", () => {
  test("captures existing skill file content", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const backup = backupDeveloperTeamFiles(plan);
      expect(backup.entries.every((e) => e.previousContent !== null)).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("rollbackDeveloperTeamFiles", () => {
  test("restores overwritten skill files", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const backup = backupDeveloperTeamFiles(plan);
      // Corrupt
      writeFileSync(plan.skills[0].absolutePath, "CORRUPTED", "utf-8");
      rollbackDeveloperTeamFiles(backup);
      const content = readFileSync(plan.skills[0].absolutePath, "utf-8");
      expect(content).not.toBe("CORRUPTED");
    } finally {
      cleanup(projectRoot);
    }
  });
});