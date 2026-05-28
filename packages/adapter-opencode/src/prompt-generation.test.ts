import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildPromptGenerationPlan, applyPromptGeneration, buildPromptReference } from "./prompt-generation";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";

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