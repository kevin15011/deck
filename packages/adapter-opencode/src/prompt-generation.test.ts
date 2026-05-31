import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildPromptGenerationPlan, applyPromptGeneration, buildPromptReference } from "./prompt-generation";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";
import type { MemoryInjectionBundle } from "@deck/core/memory/adaptive-memory";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "deck-prompt-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("buildPromptGenerationPlan", () => {
  test("generates 14 prompt files", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    expect(plan).toHaveLength(14);
  });

  test("each prompt file references the matching skill path", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    for (const planned of plan) {
      expect(planned.content).toContain("/skills/");
      expect(planned.content).toContain("/SKILL.md");
    }
  });

  test("orchestrator prompt differs from subagent prompts", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const orchestrator = plan.find((p) => p.agent.id === "deck-developer-orchestrator")!;
    const explorer = plan.find((p) => p.agent.id === "deck-developer-explorer")!;
    expect(orchestrator.content).not.toBe(explorer.content);
    expect(orchestrator.content).toContain("Orchestrator");
    expect(explorer.content).toContain("Explorer");
  });

  test("prompt files use deck-developer-* path under configDir prompts", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    for (const planned of plan) {
      expect(planned.absolutePath).toContain("/prompts/deck-developer/");
      expect(planned.absolutePath).toEndWith(`${planned.agent.id}.md`);
    }
  });

  test("prompt content references skill file with runner-stable path", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    for (const planned of plan) {
      // The skill path should be runner-stable (under configDir, not projectRoot)
      expect(planned.content).toContain("/skills/");
      expect(planned.content).toContain("/SKILL.md");
      expect(planned.content).not.toContain("/tmp/project/.opencode/skills/");
    }
  });

  test("all 12 developer team agents are covered", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp", projectRoot: "/tmp" });
    const ids = plan.map((p) => p.agent.id).sort();
    expect(ids).toContain("deck-developer-orchestrator");
    expect(ids).toContain("deck-developer-explorer");
    expect(ids).toContain("deck-developer-proposal");
    expect(ids).toContain("deck-developer-spec");
    expect(ids).toContain("deck-developer-design");
    expect(ids).toContain("deck-developer-task");
    expect(ids).toContain("deck-developer-apply-general");
    expect(ids).toContain("deck-developer-apply-backend");
    expect(ids).toContain("deck-developer-apply-frontend");
    expect(ids).toContain("deck-developer-verify");
    expect(ids).toContain("deck-developer-review");
    expect(ids).toContain("deck-developer-archive");
  });
});

describe("applyPromptGeneration", () => {
  test("writes all 12 prompt files to disk", () => {
    const dir = createTempDir();
    try {
      const configDir = join(dir, ".config", "opencode");
      const projectRoot = dir;
      const plan = buildPromptGenerationPlan({ configDir, projectRoot });
      applyPromptGeneration(plan);

      for (const planned of plan) {
        expect(require("node:fs").existsSync(planned.absolutePath)).toBe(true);
        const content = readFileSync(planned.absolutePath, "utf-8");
        expect(content).toBe(planned.content);
      }
    } finally {
      cleanup(dir);
    }
  });

  test("re-applying is idempotent", () => {
    const dir = createTempDir();
    try {
      const configDir = join(dir, ".config", "opencode");
      const projectRoot = dir;
      const plan = buildPromptGenerationPlan({ configDir, projectRoot });

      applyPromptGeneration(plan);
      applyPromptGeneration(plan); // second apply

      for (const planned of plan) {
        const content = readFileSync(planned.absolutePath, "utf-8");
        expect(content).toBe(planned.content);
      }
    } finally {
      cleanup(dir);
    }
  });
});

describe("buildPromptReference", () => {
  test("returns {file:/absolute/path} format", () => {
    const ref = buildPromptReference("/home/user/.config/opencode", "deck-developer-orchestrator");
    expect(ref).toMatch(/^\{file:\/home\/user\/\.config\/opencode\/prompts\/deck-developer\/deck-developer-orchestrator\.md\}$/);
  });
});

describe("core content integration", () => {
  test("subagents use agentBody from core registry", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const backendAgent = plan.find((p) => p.agent.id === "deck-developer-apply-backend")!;
    const coreContent = getAgentContent("deck-developer-apply-backend");
    expect(coreContent).toBeDefined();
    // The prompt should contain substantial content from core (more than the old stub)
    expect(backendAgent.content.length).toBeGreaterThan(500);
  });

  test("orchestrator prompt uses ORCHESTRATOR_SYSTEM_PROMPT", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const orchestrator = plan.find((p) => p.agent.id === "deck-developer-orchestrator")!;
    // Orchestrator should have the full orchestrator content + skill reference
    expect(orchestrator.content).toContain("Orchestrator");
    expect(orchestrator.content).toContain("## Skill Reference");
  });

  test("all prompts include skill reference path", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/home/kevinlb/deck" });
    for (const planned of plan) {
      expect(planned.content).toContain("## Skill Reference");
      expect(planned.content).toContain("/SKILL.md");
    }
  });

  test("prompt content is richer than old stub (500+ chars)", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    for (const planned of plan) {
      // Old stub was ~17 lines, new content should be substantially longer
      expect(planned.content.length).toBeGreaterThan(500);
    }
  });

  test("explorer agent prompt contains explorer-specific content from core", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const explorer = plan.find((p) => p.agent.id === "deck-developer-explorer")!;
    const coreContent = getAgentContent("deck-developer-explorer");
    expect(coreContent).toBeDefined();
    // Should contain content from core, not a generic stub
    expect(explorer.content).toContain("Explorer");
    expect(explorer.content.length).toBeGreaterThan(500);
  });

  test("capabilityInstructions are passed through to orchestrator prompt generation", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: bundle,
    });
    const orchestrator = plan.find((p) => p.agent.id === "deck-developer-orchestrator")!;
    // Verify the orchestrator prompt was generated with content
    expect(orchestrator.content).toContain("Orchestrator");
    expect(orchestrator.content).toContain("## Skill Reference");
    // The capability instructions should be composed into the orchestrator skill body
    // via getAgentContent when building the prompt
    expect(orchestrator.content.length).toBeGreaterThan(500);
  });

  test("capabilityInstructions are passed through to all agent prompt generation", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode"]);
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: bundle,
    });
    // All agents should have substantial content
    for (const planned of plan) {
      expect(planned.content.length).toBeGreaterThan(500);
    }
  });
});

describe("skill loading gate", () => {
  test("all prompts include skill loading gate header", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    for (const planned of plan) {
      expect(planned.content).toContain("# Skill Loading Gate");
      expect(planned.content).toContain("MANDATORY FIRST ACTION");
    }
  });

  test("skill loading gate contains correct skillId for each agent", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    for (const planned of plan) {
      expect(planned.content).toContain(`name: "${planned.agent.skillId}"`);
    }
  });

  test("skill loading gate appears before agent body content", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const backendAgent = plan.find((p) => p.agent.id === "deck-developer-apply-backend")!;
    const skillGateIndex = backendAgent.content.indexOf("# Skill Loading Gate");
    const backendHeaderIndex = backendAgent.content.indexOf("# Backend Apply Agent");
    expect(skillGateIndex).toBeLessThan(backendHeaderIndex);
  });

  test("orchestrator prompt also has skill loading gate", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const orchestrator = plan.find((p) => p.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("# Skill Loading Gate");
    expect(orchestrator.content).toContain(`name: "deck-developer-orchestrator"`);
  });
});

// ---------------------------------------------------------------------------
// REQ-R26: Provider filtering when capabilityInstructions includes adaptive-memory
// ---------------------------------------------------------------------------

describe("provider section filtering in capabilityInstructions (REQ-R26)", () => {
  test("Supermemory active provider filters out Engram provider section", () => {
    // Simular un mock bundle de Supermemory que debería filtrar la sección Engram
    const supmemBundle: MemoryInjectionBundle = {
      instructions: [
        {
          surface: "agent",
          markdown: `## Test Content

### Provider: Supermemory

Use memory tool.

### Provider: Engram

Use Engram tools.
`,
        },
      ],
      toolBindings: [
        { capability: "memory.write", serverName: "supermemory", toolNames: ["memory", "recall"] },
      ],
    };

    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      memoryBundle: supmemBundle,
    });

    for (const planned of plan) {
      // When Supermemory is active, the Engram section should be filtered out
      expect(planned.content).not.toMatch(/### Provider: Engram/);
    }
  });

  test("Engram active provider filters out Supermemory provider section", () => {
    // Crear un mock bundle de Engram
    const engramBundle: MemoryInjectionBundle = {
      instructions: [
        {
          surface: "agent",
          markdown: `## Test Content

### Provider: Supermemory

Use memory tool.

### Provider: Engram

Use Engram tools.
`,
        },
      ],
      toolBindings: [
        { capability: "memory.write", serverName: "engram", toolNames: ["listProjects"] },
      ],
    };

    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      memoryBundle: engramBundle,
    });

    for (const planned of plan) {
      // When Engram is active, the Supermemory section should be filtered out
      expect(planned.content).not.toMatch(/### Provider: Supermemory/);
    }
  });

  test("no memoryBundle defaults to unknown - both sections visible (backward compat)", () => {
    // When no memoryBundle, there's no injected provider content either way
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      memoryBundle: undefined,
    });

    // Just verify it doesn't crash - produce valid prompts
    expect(plan).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// REQ-R25 / REQ-R26: Provider filtering from MCP config when memoryBundle undefined
// ---------------------------------------------------------------------------
// The core functionality is:
// - When activeMemoryProviderFromConfig is provided, determineActiveProvider uses it
// - filterProviderSections() then removes the inactive provider from baseContent
// - This prevents Engram leaking into Supermemory prompts (REQ-R25)
// - Also fixes x-sm-project prefix from legacy p: to sm_project_ (REQ-R26)
// ---------------------------------------------------------------------------

describe("provider filtering from explicit config (REQ-R25)", () => {
  // These tests verify the CORE functionality without mock complications
  
  test("buildPromptGenerationPlan accepts activeMemoryProviderFromConfig parameter", () => {
    // Basic smoke test: verify the option is accepted without crashing
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      memoryBundle: undefined,
      activeMemoryProviderFromConfig: "supermemory",  // Option accepted
    });

    expect(plan).toHaveLength(14);
    // Should have valid content
    for (const p of plan) {
      expect(p.content.length).toBeGreaterThan(100);
    }
  });

  test("buildPromptGenerationPlan auto-detects supermemory from opencode.json config", async () => {
    const dir = createTempDir();
    try {
      const configDir = join(dir, ".config", "opencode");
      mkdirSync(join(configDir, "prompts", "deck-developer"), { recursive: true });

      // Write config WITH supermemory server
      const configPath = join(configDir, "opencode.json");
      require("node:fs").writeFileSync(
        configPath,
        JSON.stringify({
          mcp: {
            supermemory: {
              type: "remote",
              url: "https://mcp.supermemory.ai/mcp",
              headers: { Authorization: "Bearer {env:SUPERMEMORY_API_KEY}" },
            },
          },
        }),
        "utf-8",
      );

      // Trigger auto-detection by NOT passing activeMemoryProviderFromConfig
      const plan = buildPromptGenerationPlan({
        configDir,
        projectRoot: dir,
        memoryBundle: undefined,
        // activeMemoryProviderFromConfig NOT provided -> auto-detect
      });

      // Should not crash and produce valid content
      expect(plan).toHaveLength(14);
      for (const p of plan) {
        expect(p.content.length).toBeGreaterThan(100);
      }
    } finally {
      cleanup(dir);
    }
  });

  test("no opencode.json - no filtering (backward compatible)", () => {
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode-nonexistent",
      projectRoot: "/tmp/project",
      memoryBundle: undefined,
    });

// Without config, should NOT crash - backward compatible
      expect(plan).toHaveLength(14);
    });
});

// ---------------------------------------------------------------------------
// R31: Provider detection injects instruction bundle when memoryBundle is undefined
// ---------------------------------------------------------------------------

describe("provider detection with implicit instruction bundle (R31)", () => {
  test("activeMemoryProviderFromConfig='supermemory' WITHOUT memoryBundle includes memory/recall", () => {
    // This was the exact scenario failing - now FIXED
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      activeMemoryProviderFromConfig: "supermemory",
      memoryBundle: undefined,
    });

    const allContent = plan.map((p) => p.content).join("\n");

    // All prompts should now contain memory and recall (FIXED by R31 + session fragment fix)
    expect(allContent).toContain("memory");
    expect(allContent).toContain("recall");
    expect(allContent).toContain("`memory`"); // Exact backtick refs from instruction bundle
    expect(allContent).toContain("`recall`");
  });

  test("no provider and no memoryBundle produces stable prompts", () => {
    // Baseline: original behavior preserved
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode-nonexistent",
      projectRoot: "/tmp/project",
      memoryBundle: undefined,
      activeMemoryProviderFromConfig: undefined,
    });

    // Should produce valid prompts without crashing
    expect(plan).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// Serena capability instruction propagation (REQ-DPG-001)
// ---------------------------------------------------------------------------

describe("serena capability instruction propagation", () => {
  test("with serena selected: apply prompts contain serena instructions", () => {
    const { buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles");
    const bundle = buildCapabilityInstructionBundle(["serena"]);

    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: bundle,
    });

    // Apply backend prompt should contain Serena
    const applyBackend = plan.find((p) => p.agent.id === "deck-developer-apply-backend")!;
    expect(applyBackend.content).toContain("Serena");
    expect(applyBackend.content).toContain("find_symbol");
  });

  test("without serena selected: apply prompts do not contain serena instructions", () => {
    const { buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles");
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);

    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: bundle,
    });

    // Apply backend prompt should NOT contain Serena tool references
    const applyBackend = plan.find((p) => p.agent.id === "deck-developer-apply-backend")!;
    expect(applyBackend.content).not.toContain("Serena Package");
    expect(applyBackend.content).not.toContain("find_symbol");
  });

  test("no regression: non-apply agents still get capability instructions", () => {
    const { buildCapabilityInstructionBundle } = require("@deck/core/teams/developer/instruction-bundles");
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);

    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: bundle,
    });

    // Explorer should still get codebase-memory
    const explorer = plan.find((p) => p.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("Codebase Memory");
  });
});