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
import type { AdaptiveMemoryProvider, MemoryInjectionBundle } from "@deck/core/memory/adaptive-memory";
import { createSupermemoryMemoryProvider } from "@deck/adapter-supermemory";

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
    const provider: AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory",
      adapter: {
        health: () => ({ status: "degraded" }),
        configure: () => {},
        commit: async () => ({ savedCount: 0, discardedCount: 0, results: [] }),
        loadContext: async () => [],
        search: async () => [],
      },
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
      personality: "ahorro-extremo",
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
    expect(plan.personality).toBe("ahorro-extremo");
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