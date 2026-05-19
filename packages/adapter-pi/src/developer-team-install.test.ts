import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildDeveloperTeamInstallPlan,
  readDeveloperTeamModelConfigAssignments,
  readDeveloperTeamModelAssignments,
  readDeveloperTeamThinkingAssignments,
  applyDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  rollbackDeveloperTeamFiles,
  verifyDeveloperTeamInstall,
} from "./developer-team-install";
import { getAgentContent } from "@deck/core/teams/developer/content-registry";
import type { DeveloperTeamModelAssignments, DeveloperTeamThinkingAssignments } from "./model-config";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "deck-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

function ensurePiDirs(projectRoot: string) {
  mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
  mkdirSync(join(projectRoot, ".pi", "skills"), { recursive: true });
}

describe("buildDeveloperTeamInstallPlan", () => {
  test("includes all 12 agents, 12 skills, and project .pi paths", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/my-project");

    expect(plan.projectRoot).toBe("/tmp/my-project");
    expect(plan.agentsDir).toBe("/tmp/my-project/.pi/agents");
    expect(plan.skillsDir).toBe("/tmp/my-project/.pi/skills");
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

  test("each planned agent has .pi/agents relative path with team-scoped ID and valid content", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      expect(planned.relativePath).toMatch(/^\.pi\/agents\/deck-developer-.*\.md$/);
      expect(planned.absolutePath).toBe(join("/tmp/project", planned.relativePath));
      expect(planned.content).toContain("---");
      expect(planned.content).toContain(`name: ${planned.agent.name}`);
      expect(planned.content).toContain(`description: ${JSON.stringify(planned.agent.description)}`);
    }
  });

  test("each agent prompt explicitly references its matching skillId", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      expect(planned.content).toContain(`skill: ${planned.agent.skillId}`);
    }
  });

  test("each planned skill has .pi/skills/<team-scoped-id>/SKILL.md path and valid content", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.skills) {
      expect(planned.relativePath).toMatch(/^\.pi\/skills\/deck-developer-[^/]+\/SKILL\.md$/);
      expect(planned.absolutePath).toBe(join("/tmp/project", planned.relativePath));
      expect(planned.content).toContain("---");
      expect(planned.content).toContain(`description: ${JSON.stringify(planned.agent.description)}`);
      // Derive expected heading from core registry — no agent-specific branching needed
      const registryContent = getAgentContent(planned.agent.id)!;
      const headingMatch = registryContent.skillBody.match(/^# .+$/m);
      expect(headingMatch).toBeTruthy();
      expect(planned.content).toContain(headingMatch![0]);
    }
  });

  test("includes model frontmatter when modelAssignments are provided", () => {
    const assignments: DeveloperTeamModelAssignments = {
      "deck-developer-orchestrator": "anthropic/claude-opus-4",
      "deck-developer-explorer": "openai/gpt-4o",
    };
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments: assignments });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("model: anthropic/claude-opus-4");

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("model: openai/gpt-4o");
  });

  test("keeps Kimi model assignments with thinking off", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      modelAssignments: {
        "deck-developer-explorer": "opencode-go/kimi-k2.6",
      },
    });

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("model: opencode-go/kimi-k2.6");
    expect(explorer.content).toContain("thinking: off");
  });

  test("keeps non-Kimi opencode-go model assignments with thinking off", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      modelAssignments: {
        "deck-developer-explorer": "opencode-go/qwen3.6-plus",
      },
    });

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("model: opencode-go/qwen3.6-plus");
    expect(explorer.content).toContain("thinking: off");
  });

  test("keeps low thinking for non-opencode-go model assignments", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      modelAssignments: {
        "deck-developer-orchestrator": "openai-codex/gpt-5.5",
      },
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("model: openai-codex/gpt-5.5");
    expect(orchestrator.content).toContain("thinking: low");
  });

  test("uses explicit thinking assignments when provided", () => {
    const modelAssignments: DeveloperTeamModelAssignments = {
      "deck-developer-orchestrator": "openai-codex/gpt-5.5",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-developer-orchestrator": "high",
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("model: openai-codex/gpt-5.5");
    expect(orchestrator.content).toContain("thinking: high");
  });

  test("forces unsupported model thinking assignments to off", () => {
    const modelAssignments: DeveloperTeamModelAssignments = {
      "deck-developer-apply-backend": "opencode-go/kimi-k2.6",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-developer-apply-backend": "high",
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });

    const backendApply = plan.agents.find((a) => a.agent.id === "deck-developer-apply-backend")!;
    expect(backendApply.content).toContain("model: opencode-go/kimi-k2.6");
    expect(backendApply.content).toContain("thinking: off");
  });

  test("omits model frontmatter when no model assignment exists for an agent", () => {
    const assignments: DeveloperTeamModelAssignments = {
      "deck-developer-orchestrator": "anthropic/claude-opus-4",
    };
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments: assignments });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("model: anthropic/claude-opus-4");

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).not.toContain("model:");
  });

  test("omits model frontmatter when modelAssignments is empty", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments: {} });

    for (const planned of plan.agents) {
      expect(planned.content).not.toContain("model:");
    }
  });
});

describe("readDeveloperTeamModelAssignments", () => {
  test("reads existing model and thinking frontmatter from installed agent files", () => {
    const files = new Map<string, string>();
    files.set(
      "/tmp/project/.pi/agents/deck-developer-orchestrator.md",
      ["---", "name: deck-developer-orchestrator", "model: openai-codex/gpt-5.5", "thinking: high", "---", "", "# Agent"].join("\n"),
    );
    files.set(
      "/tmp/project/.pi/agents/deck-developer-explorer.md",
      ["---", "name: deck-developer-explorer", "model: opencode-go/kimi-k2.6", "thinking: off", "---", "", "# Agent"].join("\n"),
    );

    const assignments = readDeveloperTeamModelConfigAssignments("/tmp/project", {
      exists: (path) => files.has(String(path)),
      readFile: (path) => files.get(String(path)) ?? "",
    });

    expect(assignments.modelAssignments["deck-developer-orchestrator"]).toBe("openai-codex/gpt-5.5");
    expect(assignments.modelAssignments["deck-developer-explorer"]).toBe("opencode-go/kimi-k2.6");
    expect(assignments.modelAssignments["deck-developer-proposal"]).toBeUndefined();
    expect(assignments.thinkingAssignments["deck-developer-orchestrator"]).toBe("high");
    expect(assignments.thinkingAssignments["deck-developer-explorer"]).toBe("off");
  });

  test("keeps legacy model-only reader and thinking-only reader", () => {
    const files = new Map<string, string>();
    files.set(
      "/tmp/project/.pi/agents/deck-developer-orchestrator.md",
      ["---", "name: deck-developer-orchestrator", "model: openai-codex/gpt-5.5", "thinking: medium", "---"].join("\n"),
    );

    const options = {
      exists: (path: Parameters<typeof existsSync>[0]) => files.has(String(path)),
      readFile: (path: string) => files.get(String(path)) ?? "",
    };

    expect(readDeveloperTeamModelAssignments("/tmp/project", options)["deck-developer-orchestrator"]).toBe("openai-codex/gpt-5.5");
    expect(readDeveloperTeamThinkingAssignments("/tmp/project", options)["deck-developer-orchestrator"]).toBe("medium");
  });

  test("returns empty assignments when no installed agent files exist", () => {
    const assignments = readDeveloperTeamModelAssignments("/tmp/project", {
      exists: () => false,
      readFile: () => {
        throw new Error("should not read missing files");
      },
    });

    expect(assignments).toEqual({});
  });
});

describe("applyDeveloperTeamInstall", () => {
  test("writes valid agent and skill files to temp directory", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      const result = applyDeveloperTeamInstall(plan);

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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);

      // First apply
      const first = applyDeveloperTeamInstall(plan);
      expect(first.results.every((r) => r.status === "created")).toBe(true);

      // Second apply — same plan, same content
      const second = applyDeveloperTeamInstall(plan);
      expect(second.results.every((r) => r.status === "unchanged")).toBe(true);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("detects updated files when content differs", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);

      // First apply
      applyDeveloperTeamInstall(plan);

      // Corrupt one agent file
      const target = plan.agents[0];
      writeFileSync(target.absolutePath, "corrupted", "utf-8");

      // Re-apply
      const result = applyDeveloperTeamInstall(plan);
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

describe("verifyDeveloperTeamInstall", () => {
  test("passes when all agent and skill files exist with correct content", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      applyDeveloperTeamInstall(plan);

      const verifyResult = verifyDeveloperTeamInstall(plan);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);

      // Don't apply — verify should fail
      const verifyResult = verifyDeveloperTeamInstall(plan);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      applyDeveloperTeamInstall(plan);

      // Corrupt the name in one agent file
      const target = plan.agents[0];
      const content = readFileSync(target.absolutePath, "utf-8");
      writeFileSync(target.absolutePath, content.replace(`name: ${target.agent.name}`, "name: wrong-name"), "utf-8");

      const verifyResult = verifyDeveloperTeamInstall(plan);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      applyDeveloperTeamInstall(plan);

      // Corrupt one skill file
      const target = plan.skills[0];
      writeFileSync(target.absolutePath, "corrupted", "utf-8");

      const verifyResult = verifyDeveloperTeamInstall(plan);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      ensurePiDirs(projectRoot);

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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      ensurePiDirs(projectRoot);
      writeFileSync(plan.agents[0].absolutePath, "original-content", "utf-8");

      const backup = backupDeveloperTeamFiles(plan);

      // Overwrite via apply
      applyDeveloperTeamInstall(plan);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      const backup = backupDeveloperTeamFiles(plan);

      // Apply creates all files
      applyDeveloperTeamInstall(plan);
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
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      ensurePiDirs(projectRoot);

      // Also create the skill subdirectory for skills[0]
      mkdirSync(join(projectRoot, ".pi", "skills", plan.skills[0].agent.id), { recursive: true });

      // Pre-create some files with known content
      writeFileSync(plan.agents[0].absolutePath, "agent-0-original", "utf-8");
      writeFileSync(plan.skills[0].absolutePath, "skill-0-original", "utf-8");

      const backup = backupDeveloperTeamFiles(plan);

      // Simulate partial apply: only write a few files
      mkdirSync(join(projectRoot, ".pi", "skills", plan.skills[1].agent.id), { recursive: true });
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

describe("buildDeveloperTeamInstallPlan with memory injection", () => {
  const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
    id: "engram",
    displayName: "Engram Memory",
    buildInjection: () => ({
      instructions: [
        {
          surface: "session" as const,
          markdown: "Session-level Engram memory instructions.",
          teamId: "developer-team",
        },
        {
          surface: "agent" as const,
          markdown: "Agent-level Engram memory instructions.",
          teamId: "developer-team",
        },
        {
          surface: "skill" as const,
          markdown: "Skill-level Engram memory instructions.",
          teamId: "developer-team",
        },
      ],
      toolBindings: [
        { capability: "memory.search" as const, serverName: "engram", toolNames: ["memory_search"] },
        { capability: "memory.read" as const, serverName: "engram", toolNames: ["memory_read"] },
        { capability: "memory.write" as const, serverName: "engram", toolNames: ["memory_write"] },
      ],
    }),
  };

  test("default plan has no memory injection and no diagnostics", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    expect(plan.memoryDiagnostics).toHaveLength(0);

    // Agent content should NOT contain Adaptive Memory section
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("## Adaptive Memory (provider-injected)");

    // Skill content should NOT contain Adaptive Memory section
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).not.toContain("## Adaptive Memory (provider-injected)");

    // Default tools line remains unchanged
    expect(orchestrator.content).toContain("tools: read,write,bash");
    expect(orchestrator.content).not.toContain("memory_search");
  });

  test("plan with Engram provider includes Adaptive Memory section in agent content", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: engramProvider,
    });

    expect(plan.memoryDiagnostics).toHaveLength(0);

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("## Adaptive Memory (provider-injected)");
    expect(orchestrator.content).toContain("## Adaptive Memory");
    expect(orchestrator.content).toContain("Agent-level Engram memory instructions.");
    expect(orchestrator.content).toContain("Memory is auxiliary");
  });

  test("plan with Engram provider includes Adaptive Memory section in skill content", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: engramProvider,
    });

    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).toContain("## Adaptive Memory (provider-injected)");
    expect(orchestratorSkill.content).toContain("Skill-level Engram memory instructions.");
  });

  test("plan with Engram provider adds memory tool names to Pi tools line", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: engramProvider,
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("memory_search");
    expect(orchestrator.content).toContain("memory_read");
    expect(orchestrator.content).toContain("memory_write");
    expect(orchestrator.content).toContain("tools:");
  });

  test("plan with pre-built memoryInjection bundle includes Adaptive Memory section", () => {
    const bundle: import("@deck/core/memory/adaptive-memory").MemoryInjectionBundle = {
      instructions: [
        {
          surface: "agent" as const,
          markdown: "Direct bundle injection for agents.",
          teamId: "developer-team",
        },
      ],
      toolBindings: [
        { capability: "memory.search" as const, serverName: "custom", toolNames: ["custom_search"] },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryInjection: bundle,
    });

    expect(plan.memoryDiagnostics).toHaveLength(0);

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("Direct bundle injection for agents.");
    expect(orchestrator.content).toContain("custom_search");
  });

  test("memoryInjection takes precedence over memoryProvider", () => {
    const bundle: import("@deck/core/memory/adaptive-memory").MemoryInjectionBundle = {
      instructions: [
        {
          surface: "agent" as const,
          markdown: "Bundle content, not provider content.",
        },
      ],
      toolBindings: [],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: engramProvider,
      memoryInjection: bundle,
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("Bundle content, not provider content.");
    expect(orchestrator.content).not.toContain("Agent-level Engram memory instructions.");
  });

  test("unsupported provider ID produces diagnostic and no injection (REQ-AMI-003)", () => {
    const unsupportedProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "unknown-provider",
      displayName: "Unknown Provider",
      buildInjection: () => ({
        instructions: [
          {
            surface: "agent" as const,
            markdown: "Should NOT be injected.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [
          { capability: "memory.search" as const, serverName: "unknown", toolNames: ["unknown_search"] },
        ],
      }),
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: unsupportedProvider,
    });

    // Should produce unsupported_memory_provider diagnostic
    expect(plan.memoryDiagnostics).toHaveLength(1);
    expect(plan.memoryDiagnostics[0].code).toBe("unsupported_memory_provider");
    expect(plan.memoryDiagnostics[0].providerId).toBe("unknown-provider");

    // Should NOT inject memory content — fail-closed
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("## Adaptive Memory (provider-injected)");
    expect(orchestrator.content).not.toContain("Should NOT be injected");
    expect(orchestrator.content).not.toContain("unknown_search");
    // Default tools line should remain unchanged
    expect(orchestrator.content).toContain("tools: read,write,bash");
  });

  test("broken supported Engram provider produces memory_provider_unavailable diagnostic and no injection", () => {
    const brokenEngram: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram", // Supported ID, but buildInjection throws
      displayName: "Broken Engram",
      buildInjection: () => {
        throw new Error("provider init failed");
      },
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: brokenEngram,
    });

    // Should produce a memory_provider_unavailable diagnostic (not unsupported_memory_provider)
    expect(plan.memoryDiagnostics).toHaveLength(1);
    expect(plan.memoryDiagnostics[0].code).toBe("memory_provider_unavailable");
    expect(plan.memoryDiagnostics[0].providerId).toBe("engram");

    // Should NOT inject memory content — fail-closed
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("## Adaptive Memory (provider-injected)");
    expect(orchestrator.content).toContain("tools: read,write,bash");
  });

  test("session-only provider does not inject into agent/skill surfaces and does not add tool bindings", () => {
    const sessionOnlyProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "session-only",
      displayName: "Session Only",
      buildInjection: () => ({
        instructions: [
          {
            surface: "session" as const,
            markdown: "Session-only content.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [],
      }),
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: sessionOnlyProvider,
    });

    // Agent content should NOT include session-level instruction
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("Session-only content.");
    // No Adaptive Memory section in agent since no matching fragments
    expect(orchestrator.content).not.toContain("## Adaptive Memory (provider-injected)");

    // Skill content should NOT include session-level instruction
    const skill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(skill.content).not.toContain("Session-only content.");
  });

  test("tool bindings are scoped: no bindings added when no matching fragments for surface", () => {
    // Provider with session-only fragments AND tool bindings — tool bindings
    // should NOT appear in agent/skill content because composeAdaptiveMemory
    // returns empty toolBindings when no fragments match the surface.
    const sessionOnlyWithTools: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram",
      displayName: "Session-Only with Tools",
      buildInjection: () => ({
        instructions: [
          {
            surface: "session" as const,
            markdown: "Session-level only.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [
          { capability: "memory.search" as const, serverName: "engram", toolNames: ["memory_search"] },
          { capability: "memory.read" as const, serverName: "engram", toolNames: ["memory_read"] },
        ],
      }),
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: sessionOnlyWithTools,
    });

    // Agent content should NOT have memory tools since session-only fragment
    // doesn't match the agent surface
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("memory_search");
    expect(orchestrator.content).not.toContain("memory_read");
    expect(orchestrator.content).toContain("tools: read,write,bash"); // default, no memory tools
  });

  test("plan with Supermemory provider validates Pi MCP config before injecting execute/search_docs", () => {
    const projectRoot = createTempProject();
    try {
      const mcpPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
      mkdirSync(join(projectRoot, "home", ".pi", "agent"), { recursive: true });
      writeFileSync(mcpPath, JSON.stringify({
        mcpServers: {
          supermemory: {
            transport: "http",
            url: "https://supermemory-new.stlmcp.com",
            headers: { "x-supermemory-api-key": "sentinel-token-install" },
          },
        },
      }), "utf-8");

      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "supermemory",
        displayName: "Supermemory MCP",
        buildInjection: () => ({
          instructions: [
            { surface: "agent", markdown: "Use Supermemory MCP as advisory context only.", teamId: "developer-team" },
            { surface: "skill", markdown: "Use validated Supermemory MCP tools only.", teamId: "developer-team" },
          ],
          toolBindings: [
            { capability: "memory.search", serverName: "supermemory", toolNames: ["execute", "search_docs"] },
          ],
        }),
      };

      const plan = buildDeveloperTeamInstallPlan(projectRoot, { memoryProvider: supermemoryProvider, piMcpConfigPath: mcpPath });
      const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;

      expect(plan.memoryDiagnostics).toHaveLength(0);
      expect(orchestrator.content).toContain("Use Supermemory MCP as advisory context only.");
      expect(orchestrator.content).toContain("execute");
      expect(orchestrator.content).toContain("search_docs");
      expect(orchestrator.content).not.toContain("context,recall,memory");
      expect(orchestrator.content).not.toContain("sentinel-token-install");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("plan with Supermemory provider omits injection when Pi MCP config is missing and redacts diagnostics", () => {
    const projectRoot = createTempProject();
    try {
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "supermemory",
        displayName: "Supermemory MCP",
        buildInjection: () => ({
          instructions: [{ surface: "agent", markdown: "Should not be injected.", teamId: "developer-team" }],
          toolBindings: [{ capability: "memory.search", serverName: "supermemory", toolNames: ["execute", "search_docs"] }],
        }),
      };

      const plan = buildDeveloperTeamInstallPlan(projectRoot, {
        memoryProvider: supermemoryProvider,
        piMcpConfigPath: join(projectRoot, "missing-home", ".pi", "agent", "mcp.json"),
      });
      const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;

      expect(plan.memoryDiagnostics).toHaveLength(1);
      expect(plan.memoryDiagnostics[0].code).toBe("memory_provider_unavailable");
      expect(plan.memoryDiagnostics[0].providerId).toBe("supermemory");
      expect(JSON.stringify(plan.memoryDiagnostics)).not.toContain("x-supermemory-api-key");
      expect(orchestrator.content).not.toContain("Should not be injected.");
      expect(orchestrator.content).not.toContain("execute");
      expect(orchestrator.content).not.toContain("search_docs");
      expect(orchestrator.content).toContain("tools: read,write,bash");
    } finally {
      cleanup(projectRoot);
    }
  });

});
