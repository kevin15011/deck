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

function createTempConfigDir(projectRoot: string): string {
  const configDir = join(projectRoot, ".config", "opencode");
  mkdirSync(configDir, { recursive: true });
  return configDir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("generates 14 agent entries for opencode.json", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(Object.keys(plan.agentEntries)).toHaveLength(14);
  });

  test("orchestrator has mode: primary", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.agentEntries["deck-developer-orchestrator"].mode).toBe("primary");
  });

  test("subagents have mode: subagent and hidden: true", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    // Filter out orchestrator (primary mode)
    const subagentIds = Object.keys(plan.agentEntries).filter(
      (id) => id !== "deck-developer-orchestrator",
    );
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
    expect(plan.agentEntries["deck-developer-orchestrator"].reasoningEffort).toBeUndefined();
  });

  test("explicit model override from config flows to agent entries", () => {
    // REQ-MC-005: Explicit config override takes precedence
    const configOverrides = {
      "deck-developer-orchestrator": "anthropic/claude-sonnet-4-20250514",
    };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
    });

    expect(plan.agentEntries["deck-developer-orchestrator"].model).toBe("anthropic/claude-sonnet-4-20250514");
    // Other agents should not have model
    expect(plan.agentEntries["deck-developer-explorer"].model).toBeUndefined();
  });

  test("explicit reasoningEffort override flows to agent entries with model", () => {
    // REQ-MC-005: Explicit reasoning override works when model is also set
    const configOverrides = { "deck-developer-orchestrator": "anthropic/claude-sonnet-4" };
    const reasoningOverrides = { "deck-developer-orchestrator": "high" as const };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
      reasoningEffortOverrides: reasoningOverrides,
    });

    expect(plan.agentEntries["deck-developer-orchestrator"].model).toBe("anthropic/claude-sonnet-4");
    expect(plan.agentEntries["deck-developer-orchestrator"].reasoningEffort).toBe("high");
    // Other agents should not have reasoningEffort
    expect(plan.agentEntries["deck-developer-explorer"].reasoningEffort).toBeUndefined();
  });

  test("multiple explicit model overrides for different agents", () => {
    const configOverrides = {
      "deck-developer-orchestrator": "anthropic/claude-sonnet-4-20250514",
      "deck-developer-apply-backend": "openai/gpt-4o",
    };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
    });

    expect(plan.agentEntries["deck-developer-orchestrator"].model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(plan.agentEntries["deck-developer-apply-backend"].model).toBe("openai/gpt-4o");
    expect(plan.agentEntries["deck-developer-explorer"].model).toBeUndefined();
  });

  test("explicit model and reasoning overrides coexist", () => {
    const configOverrides = {
      "deck-developer-orchestrator": "anthropic/claude-sonnet-4",
    };
    const reasoningOverrides = {
      "deck-developer-orchestrator": "high" as const,
    };
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      configModelOverrides: configOverrides,
      reasoningEffortOverrides: reasoningOverrides,
    });

    const orchestrator = plan.agentEntries["deck-developer-orchestrator"];
    expect(orchestrator.model).toBe("anthropic/claude-sonnet-4");
    expect(orchestrator.reasoningEffort).toBe("high");
  });

  test("prompt references use {file:/absolute/path} format", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    for (const [agentId, entry] of Object.entries(plan.agentEntries)) {
      expect(entry.prompt).toMatch(/^\{file:\//);
      expect(entry.prompt).toContain(agentId);
    }
  });

  test("generates prompt generation plan with 14 files", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.promptGenerationPlan).toHaveLength(14);
  });

test("generates command generation plan with 14 commands", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.commandGenerationPlan).toHaveLength(14);
  });

  test("generates skill files for all 14 agents", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project");
    expect(plan.skills).toHaveLength(14);
    for (const skill of plan.skills) {
      expect(skill.content).toContain("disable-model-invocation: true");
      // deck-onboard is user-invocable, others are not
      if (skill.agent.id === "deck-onboard") {
        expect(skill.content).toContain("user-invocable: true");
        expect(skill.content).not.toContain("delegate_only: true");
      } else {
        expect(skill.content).toContain("user-invocable: false");
        expect(skill.content).toContain("delegate_only: true");
      }
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
  test("writes skill files to configDir/skills/ with correct content", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      const result = applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
      expect(existsSync(orchestratorSkill.absolutePath)).toBe(true);
      const content = readFileSync(orchestratorSkill.absolutePath, "utf-8");
      expect(content).toContain("disable-model-invocation: true");
      // Skills should be under configDir, not projectRoot
      expect(orchestratorSkill.absolutePath).toContain(`${configDir}/skills/`);
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
      expect(keys.filter((k) => k === "deck-init" || k === "deck-onboard")).toHaveLength(2);
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

  test("generated command files contain no @deck/core or @deck/sdd-runtime imports", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/fake-project-for-isolation-test");
    for (const planned of plan.commandGenerationPlan) {
      const found = findForbiddenImports(planned.content, planned.absolutePath);
      expect(found).toHaveLength(0);
    }
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

  test("returns memoryBundle even when auth probe fails (advisory only)", () => {
    // When Supermemory provider is present but the OpenCode MCP config validation fails,
    // the resolveOpenCodeMemoryInjection still returns the bundle (auth probe is advisory only).
    // No diagnostic is emitted - the probe result doesn't affect bundle injection.
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

    // With no opencode.json present at the expected path, the auth probe would fail.
    // But auth probe is advisory only - bundle is still returned.
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: provider,
      configDir: "/nonexistent/.config/opencode",
    });

    // Auth probe no longer blocks bundle injection
    expect(plan.memoryBundle).toBeDefined();
    expect(plan.memoryBundle?.toolBindings).toHaveLength(1);
    // No memory diagnostics emitted - auth probe is advisory
    expect(plan.memoryDiagnostics).toHaveLength(0);
  });
});

describe("orchestratorPersonality in buildOpenCodeDeveloperTeamInstallPlan", () => {
  test("explicit personality option flows to generated skill content", () => {
    const plan = buildOpenCodeDeveloperTeamInstallPlan("/tmp/project", {
      personality: "guia",
    });

    // Verify personality option was consumed and content was generated
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).toContain("# Orchestrator Skill");
    expect(orchestratorSkill.content).toContain("## SDD Workflow");
    // Verify agent entries also received personality-aware content
    const orchestratorEntry = plan.agentEntries["deck-developer-orchestrator"];
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
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).toContain("# Orchestrator Skill");
    expect(orchestratorSkill.content).toContain("## SDD Workflow");
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
        (s) => s.agent.id === "deck-developer-orchestrator",
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
        (r) => r.agentId === "deck-developer-orchestrator",
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
        plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!,
        plan.skills.find((s) => s.agent.id === "deck-developer-explorer")!,
        plan.skills.find((s) => s.agent.id === "deck-developer-spec")!,
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
          s.agent.id !== "deck-developer-orchestrator" &&
          s.agent.id !== "deck-developer-explorer" &&
          s.agent.id !== "deck-developer-spec",
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
        plan.skills.find((s) => s.agent.id === "deck-developer-proposal")!,
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
        (p) => p.agent.id === "deck-developer-orchestrator",
      )!;
      const promptContent = readFileSync(orchestratorPrompt.absolutePath, "utf-8");

      // Find the orchestrator skill absolutePath from plan
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-developer-orchestrator",
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
  test("skill contains critical semantic fragments (heading, SDD Workflow, invariants)", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });

      // Apply
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Get installed orchestrator skill
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-developer-orchestrator",
      )!;
      const content = readFileSync(orchestratorSkill.absolutePath, "utf-8");

      // Verify critical fragments (presence check, not exact match per REQ-VAL-003)
      expect(content).toMatch(/# .*Orchestrator.*Skill/);
      expect(content).toContain("## SDD Workflow");
      expect(content).toContain("Visual Explanations");
      expect(content).toContain("INV-001");
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
  test("verification passes when orchestrator skill contains all critical invariants", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      const verifyResult = verifyOpenCodeDeveloperTeamInstall(plan);

      expect(verifyResult.valid).toBe(true);

      // Invariants present in orchestrator skill
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-developer-orchestrator",
      )!;
      expect(orchestratorSkill.content).toContain("## Orchestrator Invariants");
      // Verify ALL 5 critical invariants are present
      expect(orchestratorSkill.content).toContain("INV-001");
      expect(orchestratorSkill.content).toContain("INV-002");
      expect(orchestratorSkill.content).toContain("INV-003");
      expect(orchestratorSkill.content).toContain("INV-004");
      expect(orchestratorSkill.content).toContain("INV-005");
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
        (r) => r.agentId === "deck-developer-orchestrator",
      );
      expect(orchResult).toBeDefined();

      // Verification should pass with complete invariants
      expect(orchResult!.valid).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("installed skill file on disk contains all critical invariants", () => {
    const projectRoot = createTempProject();
    try {
      const configDir = createTempConfigDir(projectRoot);
      const plan = buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir });
      applyOpenCodeDeveloperTeamInstall(plan, { configDir });

      // Read the actual file from disk to verify what was actually written
      const orchestratorSkill = plan.skills.find(
        (s) => s.agent.id === "deck-developer-orchestrator",
      )!;
      const diskContent = readFileSync(orchestratorSkill.absolutePath, "utf-8");

      // Disk content must match planned content
      expect(diskContent).toBe(orchestratorSkill.content);

      // Verify all invariants are present in the actual disk file
      expect(diskContent).toContain("## Orchestrator Invariants");
      expect(diskContent).toContain("INV-001");
      expect(diskContent).toContain("INV-002");
      expect(diskContent).toContain("INV-003");
      expect(diskContent).toContain("INV-004");
expect(diskContent).toContain("INV-005");
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
      const applyBackendEntry = plan.agentEntries["deck-developer-apply-backend"];
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
      const applyBackendEntry = plan.agentEntries["deck-developer-apply-backend"];
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
      const explorerEntry = plan.agentEntries["deck-developer-explorer"];
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

      const orchestratorEntry = plan.agentEntries["deck-developer-orchestrator"];
      if (!orchestratorEntry || !orchestratorEntry.tools) throw new Error("orchestratorEntry or tools is undefined");
      expect(orchestratorEntry.tools.delegate).toBe(true);
      expect(orchestratorEntry.tools.delegation_list).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });
});