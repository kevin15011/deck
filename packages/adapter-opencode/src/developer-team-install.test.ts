import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import {
  buildOpenCodeDeveloperTeamInstallPlan,
  applyOpenCodeDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyOpenCodeDeveloperTeamInstall,
} from "./developer-team-install";
import { DEVELOPER_TEAM_LANGUAGE_POLICY, getAgentContent } from "@deck/core/teams/developer/content-registry";
import { buildCapabilityInstructionBundle, getDefaultDeckConfig } from "@deck/core";
import { getStandaloneSkill, STANDALONE_SKILLS } from "@deck/core/skills/external";
import { DEFAULT_OPENCODE_MODELS } from "./model-config";
import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import { type ModificationAuthorization } from "../../core/src/teams/developer/orchestrator-invariants";
import type {
  AdaptiveMemoryProvider,
  MemoryInjectionBundle,
} from "@deck/core/memory/adaptive-memory";
import type {
  AdaptiveMemoryAdapter,
  AdaptiveMemoryProviderIdentity,
  AdaptiveMemoryHealthResult,
  AdaptiveMemoryCommitResult,
  AdaptiveMemoryContextResult,
} from "@deck/core/memory/adaptive-memory-contract";

// ---------------------------------------------------------------------------
// Runner Isolation Verification
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS = [
  // Named imports from @deck/core or @deck/sdd-runtime
  /import\s+.*\s+from\s+["']@deck\/core["']/,
  /import\s+.*\s+from\s+["']@deck\/sdd-runtime["']/,
  // Side-effect imports from @deck packages
  /import\s+["']@deck\/core["']/,
  /import\s+["']@deck\/sdd-runtime["']/,
  // Require calls for @deck packages
  /require\s*\(\s*["']@deck\/core["']\s*\)/,
  /require\s*\(\s*["']@deck\/sdd-runtime["']\s*\)/,
  // Dynamic imports for @deck packages
  /import\s*\(\s*["']@deck\/core["']\s*\)/,
  /import\s*\(\s*["']@deck\/sdd-runtime["']\s*\)/,
  // Relative imports into packages/core or packages/sdd-runtime
  /from\s+["']\.\.\/packages\/core["']/,
  /from\s+["']\.\.\/packages\/sdd-runtime["']/,
  /from\s+["']\.\/packages\/core["']/,
  /from\s+["']\.\/packages\/sdd-runtime["']/,
  /from\s+["'][^"']*\/packages\/core["']/,
  /from\s+["'][^"']*\/packages\/sdd-runtime["']/,
  // Absolute-path imports into deck packages
  /from\s+["']\/.*packages\/core["']/,
  /from\s+["']\/.*packages\/sdd-runtime["']/,
];

/** Scans all content strings for forbidden import/require patterns. */
function findForbiddenImports(content: string, fileLabel: string): string[] {
  const violations: string[] = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(`[${fileLabel}] Forbidden pattern matched: ${pattern}`);
    }
  }
  return violations;
}

function verifyRunnerIsolation(): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  // Build the plan (uses default pragmatica personality, no config file)
  const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/fake-project-for-isolation-test");

  // Check skill file contents
  for (const skill of plan.skills) {
    violations.push(...findForbiddenImports(skill.content, skill.relativePath));
  }

  // Check prompt file contents (absolutePath used for label)
  for (const planned of plan.promptGenerationPlan) {
    violations.push(...findForbiddenImports(planned.content, planned.absolutePath));
  }

  // Check command file contents (absolutePath used for label)
  for (const planned of plan.commandGenerationPlan) {
    violations.push(...findForbiddenImports(planned.content, planned.absolutePath));
  }

  // Check standalone skill contents
  for (const skill of plan.standaloneSkills) {
    violations.push(...findForbiddenImports(skill.content, skill.relativePath));
  }

  return { valid: violations.length === 0, violations };
}

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "deck-opencode-test-"));
  mkdirSync(join(dir, ".opencode", "skills"), { recursive: true });
  return dir;
}

function initCanonicalGitRemote(projectRoot: string): void {
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
}

function createTempConfigDir(projectRoot: string): string {
  const configDir = join(projectRoot, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  return configDir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

const completeStandaloneSkills = STANDALONE_SKILLS.map(({ skillId }) => {
  const bundle = getStandaloneSkill(skillId);
  return { skillId, body: bundle.SKILL, files: bundle.files };
});

const compactPromptActivation = {
  schema: "prompt-profile-activation-v1" as const,
  status: "eligible" as const,
  requestedProfile: "compact" as const,
  effectiveProfile: "compact" as const,
  reasonCodes: [] as const,
  evidenceDigest: `sha256:${"a".repeat(64)}` as const,
};

describe("buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("generates the seven desired agent entries for opencode.json", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(Object.keys(plan.agentEntries)).toHaveLength(7);
  });

  test("installs compact content by default regardless of obsolete rollout receipts", () => {
    const compact = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const eligible = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      promptProfileActivation: compactPromptActivation,
    });
    const paused = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      promptProfileActivation: { ...compactPromptActivation, status: "rollout-paused" },
    });
    const expected = getAgentContent("deck-apply-fast", { promptProfile: "compact" })!;
    const compactPrompt = compact.promptGenerationPlan.find(
      (planned) => planned.agent.id === "deck-apply-fast",
    )!;
    const compactSkill = compact.skills.find(
      (planned) => planned.agent.id === "deck-apply-fast",
    )!;

    expect(compact.promptProfile).toBe("compact");
    expect(eligible.promptProfile).toBe("compact");
    expect(paused.promptProfile).toBe("compact");
    expect(paused.promptGenerationPlan).toEqual(compact.promptGenerationPlan);
    expect(compactPrompt.content).toContain(expected.agentBody);
    expect(compactSkill.content).toContain(expected.skillBody);
  });

  test("orchestrator has mode: primary", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.agentEntries["deck-lead"].mode).toBe("primary");
  });

  test("subagents have mode: subagent and hidden: true", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    // Filter out orchestrator (primary mode)
    const subagentIds = Object.keys(plan.agentEntries).filter(
      (id) => id !== "deck-lead",
    );
    for (const id of subagentIds) {
      expect(plan.agentEntries[id].mode).toBe("subagent");
      expect(plan.agentEntries[id].hidden).toBe(true);
    }
  });

  test("orchestrator has permission.task deny-by-default + allowlist", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const perm = plan.agentEntries["deck-lead"].permission?.task;
    expect(perm).toBeDefined();
    expect(perm!["*"]).toBe("deny");
    expect(perm!["deck-investigate"]).toBe("allow");
    expect(perm!["deck-architect"]).toBe("allow");
  });

  test("subagents have correct tool whitelist", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const explorer = plan.agentEntries["deck-investigate"];
    expect(explorer.tools).toEqual({ bash: true, edit: true, read: true, write: true });
  });

  test("orchestrator has delegation tools", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const tools = plan.agentEntries["deck-lead"].tools;
    expect(tools!.delegate).toBe(true);
    expect(tools!.delegation_list).toBe(true);
    expect(tools!.delegation_read).toBe(true);
  });

  test("no model assignments without explicit config (REQ-MC-005)", () => {
    // REQ-MC-005: No hardcoded defaults - models must be explicitly configured
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const [agentId, entry] of Object.entries(plan.agentEntries)) {
      // Without explicit config, model should be undefined
      expect(entry.model).toBeUndefined();
    }
  });

  test("no reasoningEffort without explicit config", () => {
    // REQ-MC-005: No hardcoded defaults
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.agentEntries["deck-lead"].reasoningEffort).toBeUndefined();
  });

  test("explicit model override from config flows to agent entries", () => {
    // REQ-MC-005: Explicit config override takes precedence
    const configOverrides = {
      "deck-lead": "anthropic/claude-sonnet-4-20250514",
    };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
      changedAgentIds: ["deck-lead"],
    });

    expect(plan.agentEntries["deck-lead"].model).toBe("anthropic/claude-sonnet-4-20250514");
    // Other agents should not have model
    expect(plan.agentEntries["deck-investigate"].model).toBeUndefined();
  });

  test("changed OpenCode model and variant overrides use the native variant field", () => {
    // REQ-MC-005: Explicit reasoning override works when model is also set
    const configOverrides = { "deck-lead": "anthropic/claude-sonnet-4" };
    const reasoningOverrides = { "deck-lead": "high" as const };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
      reasoningEffortOverrides: reasoningOverrides,
      changedAgentIds: ["deck-lead"],
    });

    expect(plan.agentEntries["deck-lead"].model).toBe("anthropic/claude-sonnet-4");
    expect(plan.agentEntries["deck-lead"].variant).toBe("high");
    expect(plan.agentEntries["deck-lead"].reasoningEffort).toBeUndefined();
    // Other agents should not have reasoningEffort
    expect(plan.agentEntries["deck-investigate"].reasoningEffort).toBeUndefined();
  });

  test("multiple explicit model overrides for different agents", () => {
    const configOverrides = {
      "deck-lead": "anthropic/claude-sonnet-4-20250514",
      "deck-apply-deep": "openai/gpt-4o",
    };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
      changedAgentIds: ["deck-lead", "deck-apply-deep"],
    });

    expect(plan.agentEntries["deck-lead"].model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(plan.agentEntries["deck-apply-deep"].model).toBe("openai/gpt-4o");
    expect(plan.agentEntries["deck-investigate"].model).toBeUndefined();
  });

  test("explicit model and reasoning overrides coexist", () => {
    const configOverrides = {
      "deck-lead": "anthropic/claude-sonnet-4",
    };
    const reasoningOverrides = {
      "deck-lead": "high" as const,
    };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
      reasoningEffortOverrides: reasoningOverrides,
      changedAgentIds: ["deck-lead"],
    });

    const orchestrator = plan.agentEntries["deck-lead"];
    expect(orchestrator.model).toBe("anthropic/claude-sonnet-4");
    expect(orchestrator.variant).toBe("high");
    expect(orchestrator.reasoningEffort).toBeUndefined();
  });


  test("writes a changed OpenCode assignment with native variant only", () => {
    const agentId = "deck-lead";
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: { [agentId]: "anthropic/claude-sonnet-4" },
      reasoningEffortOverrides: { [agentId]: "custom-fast" },
      changedAgentIds: [agentId],
    });

    expect(plan.agentEntries[agentId]).toMatchObject({
      model: "anthropic/claude-sonnet-4",
      variant: "custom-fast",
    });
    expect(plan.agentEntries[agentId]?.reasoningEffort).toBeUndefined();
  });

  test("persists a runner-only non-canonical variant as the exact native key", () => {
    const projectRoot = createTempProject();
    const agentId = "deck-lead";
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        configModelOverrides: { [agentId]: "runner-plugin/runner-only-model" },
        reasoningEffortOverrides: { [agentId]: "exact/runner-key" },
        changedAgentIds: [agentId],
      });

      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const config = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8"));
      expect(config.agent[agentId]).toMatchObject({
        model: "runner-plugin/runner-only-model",
        variant: "exact/runner-key",
      });
      expect(config.agent[agentId].reasoningEffort).toBeUndefined();
    } finally {
      cleanup(projectRoot);
    }
  });

  test("prompt references use {file:/absolute/path} format", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const [agentId, entry] of Object.entries(plan.agentEntries)) {
      expect(entry.prompt).toMatch(/^\{file:\//);
      expect(entry.prompt).toContain(agentId);
    }
  });

  test("generates one prompt for each of the seven agents", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.promptGenerationPlan).toHaveLength(7);
  });

  test("does not generate OpenCode sdd-* command files", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.commandGenerationPlan).toEqual([]);
    expect(plan.commandGenerationPlan.some((p) => p.commandId.startsWith("sdd-"))).toBe(false);
  });

  test("generates paired skills for all seven agents", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.skills).toHaveLength(7);
    for (const skill of plan.skills) {
      expect(skill.content).toContain("disable-model-invocation: true");
      expect(skill.content).toContain("user-invocable: false");
      expect(skill.content).toContain("delegate_only: true");
    }
  });

  test("does not install OpenCode SDD skills as Deck artifacts", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.skills.some((skill) => skill.agent.skillId.startsWith("sdd-"))).toBe(false);
    expect(plan.standaloneSkills.some((skill) => skill.skillId.startsWith("sdd-"))).toBe(false);
  });

  test("expands all standalone skill packages including support files", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      standaloneSkills: completeStandaloneSkills,
    });

    const plannedSkillIds = new Set(plan.standaloneSkills.map((skill) => skill.skillId));
    expect(plannedSkillIds.size).toBe(31);
    expect(plannedSkillIds.has("deck-onboard")).toBe(true);
    expect(plannedSkillIds.has("deck-archive")).toBe(true);
    for (const { skillId } of STANDALONE_SKILLS) {
      expect(plannedSkillIds.has(skillId)).toBe(true);
      expect(plan.standaloneSkills).toContainEqual(expect.objectContaining({
        skillId,
        packagePath: "SKILL.md",
        relativePath: `skills/${skillId}/SKILL.md`,
      }));
    }
    expect(plan.standaloneSkills).toContainEqual(expect.objectContaining({
      skillId: "web-quality-audit",
      packagePath: "scripts/analyze.sh",
      relativePath: "skills/web-quality-audit/scripts/analyze.sh",
    }));
    expect(plan.standaloneSkills).toContainEqual(expect.objectContaining({
      skillId: "design-lab",
      packagePath: "DESIGN_PRINCIPLES.md",
      relativePath: "skills/design-lab/DESIGN_PRINCIPLES.md",
    }));
    expect(plan.commandGenerationPlan).toEqual([]);
  });

  test("rejects unsafe standalone skill package paths", () => {
    expect(() => buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      standaloneSkills: [{ skillId: "safe-skill", body: "# Safe", files: { "../escape.md": "nope" } }],
    })).toThrow(/Invalid standalone skill package path/);
    expect(() => buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      standaloneSkills: [{ skillId: "../unsafe", body: "# Unsafe" }],
    })).toThrow(/Invalid skillId/);
  });

  test("skill content comes from core registry", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-lead")!;
    expect(orchestratorSkill.content).toContain("# Lead Skill");
    expect(orchestratorSkill.content).toContain("select the smallest safe route");
  });
});

describe("applyOpenCodeDeveloperTeamInstall", () => {
  test("writes skill files to configDir/skills/ with correct content", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-lead")!;
      expect(existsSync(orchestratorSkill.absolutePath)).toBe(true);
      const content = readFileSync(orchestratorSkill.absolutePath, "utf-8");
      expect(content).toContain("disable-model-invocation: true");
      // Skills should be under configDir, not projectRoot
      expect(orchestratorSkill.absolutePath).toContain(`${configDir}/skills/`);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("writes prompt files to configDir/prompts/deck-team/", () => {
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

  test("silently writes standalone support files and nested directories", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        standaloneSkills: completeStandaloneSkills,
      });

      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const supportFile = plan.standaloneSkills.find((file) => file.skillId === "web-quality-audit" && file.packagePath === "scripts/analyze.sh")!;
      expect(existsSync(supportFile.absolutePath)).toBe(true);
      expect(readFileSync(supportFile.absolutePath, "utf-8")).toBe(supportFile.content);
      expect(supportFile.absolutePath).toContain(`${configDir}/skills/web-quality-audit/scripts/analyze.sh`);
      expect(plan.commandGenerationPlan).toEqual([]);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("does not write or manage OpenCode sdd-* command files", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      expect(plan.commandGenerationPlan).toEqual([]);
      expect(existsSync(join(configDir, "commands", "sdd-apply.md"))).toBe(false);
      expect(existsSync(join(configDir, "commands", "sdd-verify.md"))).toBe(false);
      expect(existsSync(join(configDir, "commands", "sdd-continue.md"))).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("leaves pre-existing user sdd-* command files untouched", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      const commandsDir = join(configDir, "commands");
      mkdirSync(commandsDir, { recursive: true });
      const existingCommandPath = join(commandsDir, "sdd-apply.md");
      const existingContent = "# user-owned legacy command\n";
      writeFileSync(existingCommandPath, existingContent, "utf-8");

      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      expect(readFileSync(existingCommandPath, "utf-8")).toBe(existingContent);
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
      expect(config.agent["deck-lead"]).toBeDefined();
      expect(config.agent["deck-lead"].mode).toBe("primary");
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
      expect(keys).toEqual(expect.arrayContaining([
        "deck-lead",
        "deck-investigate",
        "deck-architect",
        "deck-apply-fast",
        "deck-apply-deep",
        "deck-quality",
        "deck-setup",
      ]));
      expect(keys).toHaveLength(7);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("re-applying unchanged files is idempotent", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const firstResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Second run should have changedCount === 0
      expect(secondResult.changedCount).toBe(0);
      expect(secondResult.unchangedCount).toBe(firstResult.changedCount + firstResult.unchangedCount);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("second apply produces changedCount === 0", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      expect(secondResult.changedCount).toBe(0);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("file status is 'unchanged' when content matches", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // All fileResults should have status 'unchanged' on second run
      for (const file of secondResult.fileResults) {
        expect(file.status).toBe("unchanged");
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  test("first apply produces changedCount === total files + configMerge", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const totalFileResults = result.fileResults.length;
      // configMergeResult contributes to counts (status is 'created' on first run)
      const configMergeContributes = result.configMergeResult?.status !== "unchanged" ? 1 : 0;
      expect(result.changedCount).toBe(totalFileResults + configMergeContributes);
      expect(result.unchangedCount).toBe(0);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("changedCount includes configMergeResult contribution", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = join(projectRoot, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // configMergeResult should have status 'created' on first apply
      expect(result.configMergeResult?.status).toBe("created");
      // changedCount should include the configMerge contribution
      expect(result.changedCount).toBeGreaterThan(result.fileResults.length);
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
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      // Don't apply - skill files do not exist in configDir
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

  test("fails when a standalone support file is missing or stale", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        standaloneSkills: completeStandaloneSkills,
      });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const supportFile = plan.standaloneSkills.find((file) => file.skillId === "web-quality-audit" && file.packagePath === "scripts/analyze.sh")!;
      writeFileSync(supportFile.absolutePath, "stale", "utf-8");

      const staleResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(staleResult.valid).toBe(false);
      expect(staleResult.skillResults.some((result) => result.issues.some((issue) => issue.includes("web-quality-audit/scripts/analyze.sh")))).toBe(true);
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
      for (const planned of [...plan.skills, ...plan.standaloneSkills, ...plan.promptGenerationPlan]) {
        expect(backup.entries.find((entry) => entry.absolutePath === planned.absolutePath)?.previousContent).not.toBeNull();
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  test("captures standalone package support files", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        standaloneSkills: completeStandaloneSkills,
      });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const backup = backupDeveloperTeamFiles(plan);
      const supportFile = plan.standaloneSkills.find((file) => file.skillId === "web-quality-audit" && file.packagePath === "scripts/analyze.sh")!;
      expect(backup.entries).toContainEqual(expect.objectContaining({
        absolutePath: supportFile.absolutePath,
        previousContent: supportFile.content,
      }));
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

describe("legacy Developer Team upgrade", () => {
  test("promotes seven roles, preserves user agents, and quarantines exact legacy files", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const legacySkill = join(configDir, "skills", "deck-developer-explorer", "SKILL.md");
      const legacyPrompt = join(configDir, "prompts", "deck-developer", "deck-developer-explorer.md");
      mkdirSync(join(legacySkill, ".."), { recursive: true });
      mkdirSync(join(legacyPrompt, ".."), { recursive: true });
      writeFileSync(legacySkill, "legacy skill", "utf-8");
      writeFileSync(legacyPrompt, "legacy prompt", "utf-8");
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        agent: {
          "deck-developer-explorer": { mode: "subagent", model: "legacy/model" },
          "user-agent": { mode: "subagent", prompt: "user-owned" },
        },
      }), "utf-8");

      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const config = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8"));

      expect(Object.keys(plan.agentEntries)).toHaveLength(7);
      expect(config.agent["deck-developer-explorer"]).toBeUndefined();
      expect(config.agent["user-agent"]).toEqual({ mode: "subagent", prompt: "user-owned" });
      expect(existsSync(legacySkill)).toBe(false);
      expect(existsSync(legacyPrompt)).toBe(false);
      expect(readFileSync(join(configDir, "deck-backups", "developer-team-v2", "skills", "deck-developer-explorer", "SKILL.md"), "utf-8")).toBe("legacy skill");
      expect(readFileSync(join(configDir, "deck-backups", "developer-team-v2", "prompts", "deck-developer", "deck-developer-explorer.md"), "utf-8")).toBe("legacy prompt");
      expect(result.legacyFilesRetired).toEqual(expect.arrayContaining([legacySkill, legacyPrompt]));
      expect(verifyOpenCodeDeveloperTeamInstall(plan).valid).toBe(true);

      expect(applyOpenCodeDeveloperTeamInstall(plan, { configDir }).legacyFilesRetired).toEqual([]);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("file rollback restores legacy discovery paths and removes newly promoted files", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const legacySkill = join(configDir, "skills", "deck-init", "SKILL.md");
      mkdirSync(join(legacySkill, ".."), { recursive: true });
      writeFileSync(legacySkill, "legacy init", "utf-8");
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const backup = backupDeveloperTeamFiles(plan);

      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      rollbackDeveloperTeamFiles(backup);

      expect(readFileSync(legacySkill, "utf-8")).toBe("legacy init");
      expect(existsSync(plan.skills[0].absolutePath)).toBe(false);
      expect(existsSync(plan.promptGenerationPlan[0].absolutePath)).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("an intermediate write failure restores config and active files", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const configPath = join(configDir, "opencode.json");
      const previousConfig = JSON.stringify({ agent: { "deck-developer-explorer": { description: "legacy", mode: "subagent", prompt: "legacy" } } });
      writeFileSync(configPath, previousConfig, "utf-8");
      const legacySkill = join(configDir, "skills", "deck-developer-explorer", "SKILL.md");
      mkdirSync(join(legacySkill, ".."), { recursive: true });
      writeFileSync(legacySkill, "legacy", "utf-8");
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const failedPath = plan.skills[0].absolutePath;
      const failingWrite = ((path: Parameters<typeof writeFileSync>[0], data: Parameters<typeof writeFileSync>[1], option?: unknown) => {
        if (String(path) === failedPath) throw new Error("injected write failure");
        return writeFileSync(path, data, option as never);
      }) as typeof writeFileSync;

      expect(() => applyOpenCodeDeveloperTeamInstall(plan, { configDir, writeFile: failingWrite })).toThrow("injected write failure");
      expect(readFileSync(configPath, "utf-8")).toBe(previousConfig);
      expect(readFileSync(legacySkill, "utf-8")).toBe("legacy");
      expect(existsSync(failedPath)).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });
});

describe("verifyRunnerIsolation", () => {
  test("generated skill files contain no @deck/core or @deck/sdd-runtime imports", () => {
    const { valid, violations } = verifyRunnerIsolation();
    expect(valid).toBe(true);
    expect(violations).toHaveLength(0);
  });

  test("generated prompt files contain no @deck/core or @deck/sdd-runtime imports", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/fake-project-for-isolation-test");
    for (const planned of plan.promptGenerationPlan) {
      const found = findForbiddenImports(planned.content, planned.absolutePath);
      expect(found).toHaveLength(0);
    }
  });

  test("no command files are generated for runner isolation", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/fake-project-for-isolation-test");
    expect(plan.commandGenerationPlan).toEqual([]);
  });

  test("plain-text mentions of @deck/core in markdown do NOT trigger violations", () => {
    // Simulate a file that mentions @deck/core in prose (not an import)
    const fakeContent = "For more information, see @deck/core documentation.";
    const found = findForbiddenImports(fakeContent, "test-file.md");
    // Plain-text mention should NOT match import/require patterns
    expect(found).toHaveLength(0);
  });

  test("actual import statements DO trigger violations", () => {
    const importContent = 'import { foo } from "@deck/core";';
    const found = findForbiddenImports(importContent, "test-file.ts");
    expect(found.length).toBeGreaterThan(0);
  });

  test("actual require calls DO trigger violations", () => {
    const requireContent = 'const core = require("@deck/core");';
    const found = findForbiddenImports(requireContent, "test-file.js");
    expect(found.length).toBeGreaterThan(0);
  });

  test("actual dynamic imports DO trigger violations", () => {
    const dynamicImportContent = 'const core = await import("@deck/core");';
    const found = findForbiddenImports(dynamicImportContent, "test-file.ts");
    expect(found.length).toBeGreaterThan(0);
  });

  test("relative path imports into packages/core DO trigger violations", () => {
    const relativeImport = 'import { foo } from "../packages/core";';
    const found = findForbiddenImports(relativeImport, "test-file.ts");
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("memoryBundle in buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("returns memoryBundle when Supermemory provider is passed with valid auth", () => {
    // Valid auth = validateSupermemoryOpenCodeMcpConfig returns ok: true
    // We stub the validator by providing a pre-built memoryInjection bundle instead of a live provider,
    // which bypasses the auth probe (pre-built bundles are used directly without validation).
    const preBuiltBundle: MemoryInjectionBundle = {
      instructions: [],
      toolBindings: [{
        capability: "memory.search",
        serverName: "supermemory",
        toolNames: ["supermemory_memory", "supermemory_recall"],
      }],
    };

    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      memoryInjection: preBuiltBundle,
    });

    expect(plan.memoryBundle).toBeDefined();
    expect(plan.memoryBundle!.toolBindings.length).toBeGreaterThan(0);
    expect(plan.memoryBundle!.toolBindings[0].toolNames).toContain("supermemory_memory");
    expect(plan.memoryBundle!.toolBindings[0].toolNames).toContain("supermemory_recall");
  });

  test("returns memoryBundle: undefined when no provider is configured", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");

    expect(plan.memoryBundle).toBeUndefined();
  });

  test("propagates scoped adaptive-memory instructions into OpenCode prompts, agent skills, standalone skills, and bootstrap skills", () => {
    const projectRoot = createTempProject();
    const configDir = createTempConfigDir(projectRoot);
    try {
      initCanonicalGitRemote(projectRoot);
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            headers: { "x-sm-project": "sm_project_v1_kevin15011_deck" },
          },
        },
      }));
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        memoryProvider: {
          id: "supermemory",
          displayName: "Supermemory",
          buildInjection: (context) => ({
            instructions: [{ surface: "agent", markdown: `provider scope ${context.supermemoryProjectScope}`, teamId: "developer-team" }],
            toolBindings: [],
          }),
        },
        capabilityInstructions: buildCapabilityInstructionBundle(["adaptive-memory"], {
          supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
          configuredSupermemoryProjectScope: "sm_project_v1_kevin15011_deck",
        }),
        standaloneSkills: completeStandaloneSkills,
      });
      const samples = [
        plan.promptGenerationPlan.find((planned) => planned.agent.id === "deck-lead")!.content,
        plan.skills.find((planned) => planned.agent.id === "deck-apply-deep")!.content,
        plan.standaloneSkills.find((planned) => planned.relativePath.endsWith("api-and-interface-design/SKILL.md"))!.content,
        plan.standaloneSkills.find((planned) => planned.relativePath.endsWith("deck-onboard/SKILL.md"))!.content,
      ];

      for (const content of samples) {
        expect(content).toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(content).not.toContain("supermemory_add_memory");
        expect(content).toContain("explicit remember are routed through the Deck runtime");
        expect(content).not.toContain("No manual containerTag required");
        expect(content).not.toContain("sm_project_default");
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  test("rebinds caller-supplied adaptive-memory capability fragments to the configured canonical OpenCode MCP scope", () => {
    const projectRoot = createTempProject();
    const configDir = createTempConfigDir(projectRoot);
    try {
      initCanonicalGitRemote(projectRoot);
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            headers: { "x-sm-project": "sm_project_v1_kevin15011_deck" },
          },
        },
      }));
      const callerBundle = {
        instructions: [
          { packageId: "adaptive-memory", surface: "agent", markdown: "No manual containerTag required", teamId: "developer-team" },
          { packageId: "adaptive-memory", surface: "skill", markdown: "stale q example supermemory_search_memory({ q, containerTag: \"sm_project_default\" })", teamId: "developer-team" },
          { packageId: "code-economy", surface: "agent", markdown: "caller-unrelated-marker", teamId: "developer-team" },
        ],
      } as const;

      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        capabilityInstructions: callerBundle,
        standaloneSkills: completeStandaloneSkills,
      });
      const combined = [
        plan.promptGenerationPlan.find((planned) => planned.agent.id === "deck-lead")!.content,
        plan.standaloneSkills.find((planned) => planned.relativePath.endsWith("api-and-interface-design/SKILL.md"))!.content,
      ].join("\n");

      expect(combined).toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).toContain('supermemory_search_memory({ query, containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(plan.capabilityInstructions?.instructions.some((fragment) => fragment.markdown === "caller-unrelated-marker")).toBe(true);
      expect(combined).not.toContain("No manual containerTag required");
      expect(combined).not.toContain("sm_project_default");
      expect(combined).not.toMatch(/supermemory_search_memory\(\{\s*q\s*,/);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("fails closed for Supermemory memory injection when configured scope is missing", () => {
    const mockIdentity: AdaptiveMemoryProviderIdentity = {
      id: "supermemory",
      displayName: "Supermemory",
    };
    const mockAdapter: AdaptiveMemoryAdapter = {
      identity: mockIdentity,
      health: async () => ({ status: "degraded" } as AdaptiveMemoryHealthResult),
      configure: async () => {},
      commit: async () => ({ savedCount: 0, discardedCount: 0, decisions: [] } as AdaptiveMemoryCommitResult),
      loadContext: async () => ({ providerId: "mock", items: [] } as AdaptiveMemoryContextResult),
      search: async () => ({ providerId: "mock", items: [] } as AdaptiveMemoryContextResult),
    };
    const provider: AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory",
      adapter: mockAdapter,
      buildInjection: (): MemoryInjectionBundle => ({
        instructions: [],
        toolBindings: [{
          capability: "memory.search",
          serverName: "supermemory",
          toolNames: ["supermemory_memory", "supermemory_recall"],
        }],
      }),
    };

    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: provider,
      configDir: "/nonexistent/.config/opencode",
    });

    expect(plan.memoryBundle).toBeUndefined();
    expect(plan.memoryDiagnostics).toContainEqual(expect.objectContaining({
      code: "memory_provider_unavailable",
      providerId: "supermemory",
    }));
  });
});

describe("orchestratorPersonality in buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("explicit personality option flows to generated skill content", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      personality: "guia",
    });

    // Verify personality option was consumed and content was generated
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-lead")!;
    expect(orchestratorSkill.content).toContain("# Lead Skill");
    expect(orchestratorSkill.content).toContain("## Route selection");
    // Verify agent entries also received personality-aware content
    const orchestratorEntry = plan.agentEntries["deck-lead"];
    expect(orchestratorEntry).toBeDefined();
    expect(orchestratorEntry.mode).toBe("primary");
    // Verify the resolved personality is captured on the plan
    expect(plan.personality).toBe("guia");
  });

  test("falls back to pragmatica when config read fails", () => {
    // Pass a project root where no config exists and config read would fail
    // The try/catch in buildOpenCodeDeveloperTeamInstallPlan should fall back to DEFAULT_ORCHESTRATOR_PERSONALITY
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/nonexistent-root-path", {
      personality: undefined,
    });

    // Should still generate valid content (falls back to pragmatica)
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-lead")!;
    expect(orchestratorSkill.content).toContain("# Lead Skill");
    expect(orchestratorSkill.content).toContain("## Route selection");
    // Verify fallback to pragmatica is captured on the plan
    expect(plan.personality).toBe("pragmatica");
  });
});

// ---------------------------------------------------------------------------
// Task 2: Tests for stale overwrite, byte idempotency, all-skills sync (REQ-INST-002, REQ-INST-003, REQ-INST-004)
// ---------------------------------------------------------------------------

describe("Task 2 — stale overwrite, byte idempotency, all-skills sync", () => {
  // Task 2.1: Stale overwrite — REQ- INST-002
  test("apply overwrites stale skill and returns status 'updated'", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // First apply
      const firstResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Get orchestrator skill and corrupt it manually
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-lead",
      )!;
      writeFileSync(
        orchestratorSkill.absolutePath,
        "STALE CORRUPTED CONTENT -- should be overwritten",
        "utf-8",
      );

      // Re-apply (should detect stale and overwrite)
      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Verify content is now exactly what was planned
      const currentContent = readFileSync(orchestratorSkill.absolutePath, "utf-8");
      expect(currentContent).toBe(orchestratorSkill.content);

      // Should report status 'updated' for the stale skill
      const skillResult = secondResult.fileResults.find(
        (r) => r.agentId === "deck-lead",
      );
      expect(skillResult?.status).toBe("updated");
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 2.2: Byte idempotency — REQ-INST-003
  test("re-applying unchanged content produces changedCount === 0", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // First apply
      const firstResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Get initial mtimes
      const initialMtimes = new Map<string, number>();
      for (const skill of plan.skills) {
        initialMtimes.set(skill.absolutePath, 0); // We'll read directly
      }

      // Re-apply
      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // unchanged === 0 means all skills remained unchanged
      expect(secondResult.changedCount).toBe(0);
      expect(secondResult.unchangedCount).toBe(firstResult.changedCount + firstResult.unchangedCount);
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 2.3: All-skills sync — REQ-INST-004
  test("multiple stale skills are all updated on re-apply", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // First apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Corrupt multiple skills (but not all)
      const skillsToCorrupt = [
        plan.skills.find((s) => s.agent.id === "deck-lead")!,
        plan.skills.find((s) => s.agent.id === "deck-investigate")!,
        plan.skills.find((s) => s.agent.id === "deck-architect")!,
      ];
      for (const skill of skillsToCorrupt) {
        writeFileSync(skill.absolutePath, "CORRUPTION " + skill.agent.skillId, "utf-8");
      }

      // Re-apply
      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Check corrupted skills were updated
      for (const skill of skillsToCorrupt) {
        const currentContent = readFileSync(skill.absolutePath, "utf-8");
        expect(currentContent).toBe(skill.content);
      }

      // Check an uncorrupted skill remained unchanged
      const uncorruptedSkill = plan.skills.find(
        (s) =>
          s.agent.id !== "deck-lead" &&
          s.agent.id !== "deck-investigate" &&
          s.agent.id !== "deck-architect",
      )!;
      const uncorruptedResult = secondResult.fileResults.find(
        (r) => r.agentId === uncorruptedSkill.agent.id,
      );
      expect(uncorruptedResult?.status).toBe("unchanged");
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 2.4: Verify exact-match — REQ-VAL-004
  test("verify fails when installed content differs from planned content", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Corrupt one skill (keep frontmatter valid but change body)
      const target = plan.skills[0];
      const originalContent = readFileSync(target.absolutePath, "utf-8");
      const corruptedContent = originalContent.replace(
        /description: "[^"]*"/,
        'description: "CORRUPTED DESCRIPTION"',
      );
      writeFileSync(target.absolutePath, corruptedContent, "utf-8");

      // verify should fail with content mismatch
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.skillResults.some((r) => r.issues.some((i) => i.includes("Content mismatch")))).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 2.6: Status reports updated/unchanged correctly
  test("apply reports 'updated' for stale and 'unchanged' for synced skills", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // First apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Track which skills should update
      const staleSkills = [
        plan.skills.find((s) => s.agent.id === "deck-architect")!,
      ];
      for (const skill of staleSkills) {
        writeFileSync(skill.absolutePath, "STALE", "utf-8");
      }

      const secondResult = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Check stale skill reports 'updated'
      for (const skill of staleSkills) {
        const result = secondResult.fileResults.find((r) => r.agentId === skill.agent.id);
        expect(result?.status).toBe("updated");
      }

      // Check non-stale skills remain 'unchanged'
      const unchangedSkills = plan.skills.filter(
        (s) => !staleSkills.some((ss) => ss.agent.id === s.agent.id),
      );
      for (const skill of unchangedSkills) {
        const result = secondResult.fileResults.find((r) => r.agentId === skill.agent.id);
        expect(result?.status).toBe("unchanged");
      }
    } finally {
      cleanup(projectRoot);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 3: Drift detection tests — prompt/skill consistency (REQ-VAL-001, REQ-VAL-003)
// ---------------------------------------------------------------------------

describe("Task 3 — drift detection between prompt and skill", () => {
  // Task 3.1: Prompt references correct skill path
  test("prompt contains skill loading gate with matching absolutePath", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Find the orchestrator prompt
      const orchestratorPrompt = plan.promptGenerationPlan.find(
        (p) => p.agent.id === "deck-lead",
      )!;
      const promptContent = readFileSync(orchestratorPrompt.absolutePath, "utf-8");

      // Find the orchestrator skill absolutePath from plan
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-lead",
      )!;

      // Verify prompt references the skill path
      expect(promptContent).toContain(orchestratorSkill.absolutePath);
      // Verify Skill Loading Gate syntax
      expect(promptContent).toContain("Skill Loading Gate");
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 3.2: Installed skill content equals planned content (all skills)
  test("installed skill matches planned content (byte-for-byte)", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Verify each skill matches what was planned
      for (const skill of plan.skills) {
        const installed = readFileSync(skill.absolutePath, "utf-8");
        expect(installed).toBe(skill.content);
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 3.3: Critical fragments present in skill
  test("skill contains critical compact semantic fragments", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Get installed orchestrator skill
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-lead",
      )!;
      const content = readFileSync(orchestratorSkill.absolutePath, "utf-8");

      // Verify critical fragments (presence check, not exact match per REQ-VAL-003)
      expect(content).toContain("# Lead Skill");
      expect(content).toContain("## Team Contract Reference");
      expect(content).toContain("## Conversational deltas");
      expect(content).toContain("## OpenSpec persistence");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("compact install plan covers every prompt and role skill", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      expect(plan.promptProfile).toBe("compact");
      expect(plan.promptGenerationPlan).toHaveLength(7);
      expect(plan.skills).toHaveLength(7);
      for (const prompt of plan.promptGenerationPlan) {
        expect(prompt.content, prompt.agent.id).toContain("Adaptive Developer Team Contract");
      }
      for (const skill of plan.skills) {
        expect(skill.content, skill.agent.id).toContain("## Team Contract Reference");
      }
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 3.4: Test passes with synchronized skill
  test("verify passes after normal apply (synchronized)", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Normal apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // verify should pass
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  // Task 3.5: Test fails with desynchronized skill
  test("verify fails when skill is desynchronized (corrupted)", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply then corrupt
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });
      const target = plan.skills[0];
      writeFileSync(target.absolutePath, "totally wrong content", "utf-8");

      // verify should fail
      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);
      expect(verifyResult.valid).toBe(false);
    } finally {
      cleanup(projectRoot);
    }
  });
});

// ---------------------------------------------------------------------------
// Orchestrator Invariants Verification — REQ-BC-002, REQ-IBC-001, REQ-IBC-004
// ---------------------------------------------------------------------------

describe("orchestrator invariant verification in verifyOpenCodeDeveloperTeamInstall", () => {
  test("verification passes when compact invariants and runtime reference are installed", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);

      expect(verifyResult.valid).toBe(true);

      // The compact skill references the canonical contract; the prompt carries the invariant IDs.
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-lead",
      )!;
      expect(orchestratorSkill.content).toContain("## Team Contract Reference");
      const orchestratorPrompt = plan.promptGenerationPlan.find(
        (entry) => entry.agent.id === "deck-lead",
      )!;
      expect(orchestratorPrompt.content).toContain("## Route selection");
      expect(orchestratorPrompt.content).toContain("Quality is not a universal gate");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("orchestrator skill verification includes invariant checks in result", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);

      // Should have skill results for orchestrator
      const orchResult = verifyResult.skillResults.find(
        (r) => r.agentId === "deck-lead",
      );
      expect(orchResult).toBeDefined();

      // Verification should pass with complete invariants
      expect(orchResult!.valid).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("installed compact skill file contains the runtime contract reference", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Read the actual file from disk to verify what was actually written
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-lead",
      )!;
      const diskContent = readFileSync(orchestratorSkill.absolutePath, "utf-8");

      // Disk content must match planned content
      expect(diskContent).toBe(orchestratorSkill.content);

      expect(diskContent).toContain("## Team Contract Reference");
      expect(diskContent).toContain("Adaptive Developer Team Contract remains binding");
    } finally {
      cleanup(projectRoot);
    }
  });
});

// ---------------------------------------------------------------------------
// Dynamic tool resolution tests (REQ-DTI-001)
// ---------------------------------------------------------------------------

describe("dynamic tool resolution", () => {
  test("without serena selected: subagents only have base tools", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply agent has basic tools
      const applyBackendEntry = plan.agentEntries["deck-apply-deep"];
      expect(applyBackendEntry.tools).toEqual({
        bash: true,
        edit: true,
        read: true,
        write: true,
      });
    } finally {
      cleanup(projectRoot);
    }
  });

  test("with serena selected: apply agents get base + serena tools", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);

      // Build capability bundle with serena enabled
      const { buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles");
      const capabilityInstructions = buildCapabilityInstructionBundle(["serena"]);

      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        capabilityInstructions,
      });

      // Apply agents should have base + serena tools
      const applyBackendEntry = plan.agentEntries["deck-apply-deep"];
      if (!applyBackendEntry || !applyBackendEntry.tools) throw new Error("applyBackendEntry or tools is undefined");
      expect(applyBackendEntry.tools.find_symbol).toBe(true);
      expect(applyBackendEntry.tools.replace_symbol_body).toBe(true);
      expect(applyBackendEntry.tools.rename_symbol).toBe(true);
      expect(applyBackendEntry.tools.get_diagnostics_for_file).toBe(true);

      // Base tools still present
      expect(applyBackendEntry.tools.bash).toBe(true);
      expect(applyBackendEntry.tools.edit).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("non-apply subagents receive read-only serena tools only", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);

      const { buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles");
      const capabilityInstructions = buildCapabilityInstructionBundle(["serena"]);

      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, {
        configDir,
        capabilityInstructions,
      });

      // Explorer should have read-only serena tools (not write tools)
      const explorerEntry = plan.agentEntries["deck-investigate"];
      if (!explorerEntry || !explorerEntry.tools) throw new Error("explorerEntry or tools is undefined");
      // Read-only tools: find_symbol, find_referencing_symbols, get_diagnostics_for_file
      expect(explorerEntry.tools.find_symbol).toBe(true);
      expect(explorerEntry.tools.find_referencing_symbols).toBe(true);
      expect(explorerEntry.tools.get_diagnostics_for_file).toBe(true);
      // Write tools should NOT be present for non-apply
      expect(explorerEntry.tools.replace_symbol_body).toBeUndefined();
      expect(explorerEntry.tools.rename_symbol).toBeUndefined();
      expect(explorerEntry.tools.insert_after_symbol).toBeUndefined();
      expect(explorerEntry.tools.insert_before_symbol).toBeUndefined();

      // Should have base tools
      expect(explorerEntry.tools.bash).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("orchestrator keeps delegation tools", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      const orchestratorEntry = plan.agentEntries["deck-lead"];
      if (!orchestratorEntry || !orchestratorEntry.tools) throw new Error("orchestratorEntry or tools is undefined");
      expect(orchestratorEntry.tools.delegate).toBe(true);
      expect(orchestratorEntry.tools.delegation_list).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });
});

// ---------------------------------------------------------------------------
// Developer Team language policy propagation to OpenCode install-plan skills
// (REQ-ADAPT-001, REQ-LEAK-001, REQ-LEAK-002, REQ-TEST-001, REQ-TEST-003)
// ---------------------------------------------------------------------------

describe("Developer Team language policy propagation to OpenCode install-plan skills", () => {
  test("every planned skill contains the language policy", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const skill of plan.skills) {
      expect(
        skill.content,
        `${skill.agent.id} skill missing Developer Team language policy`,
      ).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    }
  });

  test("no planned skill contains the known Spanish leak", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const skill of plan.skills) {
      expect(
        skill.content,
        `${skill.agent.id} skill contains known leak`,
      ).not.toContain("herramienta");
    }
  });
});

describe("adapter plan binding isolation", () => {
  test("applies two independently built plans in reverse order without crossing assignments", async () => {
    const root = createTempProject();
    const configDir = createTempConfigDir(root);
    try {
      const inventory = { state: "ready" as const, source: "live" as const, discoveredAt: 1, fingerprint: "fixture", inventory: { providers: [{ id: "openai", displayName: "openai", source: "runner-resolved" as const }], modelsByProvider: { openai: [{ id: "openai/exact", providerId: "openai", modelId: "exact", displayName: "exact", variants: [], metadataSource: "runner" as const, source: "runner-resolved" as const }, { id: "openai/zero", providerId: "openai", modelId: "zero", displayName: "zero", variants: [], metadataSource: "runner" as const, source: "runner-resolved" as const }] } } };
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir, inventoryDiscovery: async () => inventory }) as any;
      await adapter.getModelInventory({ projectRoot: root });
      const changedAgentIds = ["deck-lead"];
      const planA = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, deckConfig: getDefaultDeckConfig(), modelAssignments: { "deck-lead": "openai/exact" }, changedAgentIds, validatedInventoryFingerprint: "fixture" });
      const planB = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, deckConfig: getDefaultDeckConfig(), modelAssignments: { "deck-lead": "openai/zero" }, changedAgentIds, validatedInventoryFingerprint: "fixture" });
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, plan: planB });
      expect(JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8")).agent["deck-lead"].model).toBe("openai/zero");
      expect(readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf-8")).toContain("Adaptive Developer Team Contract");
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, plan: planA });
      expect(JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf-8")).agent["deck-lead"].model).toBe("openai/exact");
    } finally { cleanup(root); }
  });
});


describe("adaptive ownership installed-content semantics", () => {
  test("exposes direct work, proportional persistence, and conditional Quality", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configDir: "/tmp/.config/opencode",
    });
    const orchestratorSkill = plan.skills.find(({ agent }) => agent.id === "deck-lead")!.content;
    const orchestratorPrompt = plan.promptGenerationPlan.find(({ agent }) => agent.id === "deck-lead")!.content;

    for (const materialized of [orchestratorSkill, orchestratorPrompt]) {
      expect(materialized).toContain("smallest safe route");
      expect(materialized).toContain("Working Brief");
      expect(materialized).toContain("Quality is not a universal gate");
      expect(materialized).toContain("implement a clear, reversible, low-risk change directly");
    }

    for (const agentId of ["deck-apply-fast", "deck-apply-deep"] as const) {
      const apply = plan.skills.find(({ agent }) => agent.id === agentId)!.content;
      expect(apply).toContain("TDD");
      expect(apply).toContain("vertical slice");
    }
  });
});
