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
  cleanupLegacySddAgentFiles,
} from "./developer-team-install";
import { DEVELOPER_TEAM_LANGUAGE_POLICY, getAgentContent } from "@deck/core/teams/developer/content-registry";
import type { DeveloperTeamModelAssignments, DeveloperTeamThinkingAssignments } from "./model-config";

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
  const plan = buildDeveloperTeamInstallPlan("/tmp/fake-project-for-isolation-test");

  // Check agent file contents
  for (const agent of plan.agents) {
    violations.push(...findForbiddenImports(agent.content, agent.relativePath));
  }

  // Check skill file contents
  for (const skill of plan.skills) {
    violations.push(...findForbiddenImports(skill.content, skill.relativePath));
  }

  // Check standalone skill contents
  for (const skill of plan.standaloneSkills) {
    violations.push(...findForbiddenImports(skill.content, skill.relativePath));
  }

  return { valid: violations.length === 0, violations };
}

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
  test("includes all 14 agents, 14 skills + 2 sddSkillFiles, and project .pi paths", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/my-project");

    expect(plan.projectRoot).toBe("/tmp/my-project");
    expect(plan.agentsDir).toBe("/tmp/my-project/.pi/agents");
    expect(plan.skillsDir).toBe("/tmp/my-project/.pi/skills");
    expect(plan.agents).toHaveLength(14);
    expect(plan.skills).toHaveLength(12);

    const agentIds = plan.agents.map((a) => a.agent.id);
    expect(agentIds).toContain("deck-developer-orchestrator");
    expect(agentIds).toContain("deck-developer-archive");
    expect(agentIds).toContain("deck-developer-apply-general");
    expect(agentIds).toContain("deck-developer-apply-backend");
    expect(agentIds).toContain("deck-developer-apply-frontend");

    // Skills exclude deck-init and deck-onboard (now in sddSkillFiles)
    const skillIds = plan.skills.map((s) => s.agent.id);
    const expectedSkillIds = agentIds.filter((id) => id !== "deck-init" && id !== "deck-onboard");
    expect(skillIds).toEqual(expectedSkillIds);
  });

  test("each planned agent has .pi/agents relative path with team-scoped ID and valid content", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    for (const planned of plan.agents) {
      expect(planned.relativePath).toMatch(/^\.pi\/agents\/[a-z][a-z0-9-]+\.md$/);
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
      expect(planned.relativePath).toMatch(/^\.pi\/skills\/[a-z][a-z0-9-]+\/SKILL\.md$/);
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

  test("keeps Kimi model assignments without thinking frontmatter", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      modelAssignments: {
        "deck-developer-explorer": "opencode-go/kimi-k2.6",
      },
    });

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("model: opencode-go/kimi-k2.6");
    expect(explorer.content).not.toContain("thinking:");
  });

  test("keeps non-Kimi opencode-go model assignments without thinking frontmatter", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      modelAssignments: {
        "deck-developer-explorer": "opencode-go/qwen3.6-plus",
      },
    });

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("model: opencode-go/qwen3.6-plus");
    expect(explorer.content).not.toContain("thinking:");
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

  test("omits unsupported model thinking assignments", () => {
    const modelAssignments: DeveloperTeamModelAssignments = {
      "deck-developer-apply-backend": "opencode-go/kimi-k2.6",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-developer-apply-backend": "high",
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });

    const backendApply = plan.agents.find((a) => a.agent.id === "deck-developer-apply-backend")!;
    expect(backendApply.content).toContain("model: opencode-go/kimi-k2.6");
    expect(backendApply.content).not.toContain("thinking:");
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

      expect(result.results).toHaveLength(28);
      expect(result.results.filter((r) => r.kind === "agent")).toHaveLength(14);
      expect(result.results.filter((r) => r.kind === "skill")).toHaveLength(14);
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
      expect(first.changedCount).toBe(first.results.length);
      expect(first.unchangedCount).toBe(0);

      // Second apply — same plan, same content
      const second = applyDeveloperTeamInstall(plan);
      expect(second.results.every((r) => r.status === "unchanged")).toBe(true);
      expect(second.changedCount).toBe(0);
      expect(second.unchangedCount).toBe(second.results.length);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("second apply produces changedCount === 0", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);

      // First apply
      applyDeveloperTeamInstall(plan);

      // Second apply with identical plan
      const second = applyDeveloperTeamInstall(plan);
      expect(second.changedCount).toBe(0);
      expect(second.unchangedCount).toBe(second.results.length);
    } finally {
      cleanup(projectRoot);
    }
  });

  test("file status is 'unchanged' when content matches", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);

      // First apply
      applyDeveloperTeamInstall(plan);

      // Second apply — all files should be unchanged
      const second = applyDeveloperTeamInstall(plan);
      for (const r of second.results) {
        expect(r.status).toBe("unchanged");
      }
      expect(second.fileResults.every((fr) => fr.status === "unchanged")).toBe(true);
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

describe("applyDeveloperTeamInstall - profile materialization", () => {
  test("materializes profile to .deck/pi/profiles/<team>/system-prompt.md", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      const result = applyDeveloperTeamInstall(plan);

      // Profile should be materialized at project-relative path
      expect(result.profileDir).toContain(".deck/pi/profiles/developer-team");
      expect(result.profileDir).toBe(join(projectRoot, ".deck", "pi", "profiles", "developer-team"));

      // Profile file should exist
      const systemPromptPath = join(result.profileDir, "system-prompt.md");
      expect(existsSync(systemPromptPath)).toBe(true);

      // Profile content should contain Developer Team content
      const content = readFileSync(systemPromptPath, "utf-8");
      expect(content).toContain("Developer Team");
      expect(content).toContain("deck-developer-orchestrator");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("returns profileStatus 'created' on first install", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      const result = applyDeveloperTeamInstall(plan);

      expect(result.profileStatus).toBe("created");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("returns profileStatus 'unchanged' when profile content is same", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);

      // First apply
      const first = applyDeveloperTeamInstall(plan);
      expect(first.profileStatus).toBe("created");

      // Second apply - profile should be unchanged
      const second = applyDeveloperTeamInstall(plan);
      expect(second.profileStatus).toBe("unchanged");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("orchestrator stub references profile path without duplicating full prompt", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      applyDeveloperTeamInstall(plan);

      // Read orchestrator agent file
      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md");
      const orchestratorContent = readFileSync(orchestratorPath, "utf-8");

      // Should reference profile path
      expect(orchestratorContent).toContain(".deck/pi/profiles/<team>/system-prompt.md");

      // Should NOT contain full system prompt body (invariants, etc.) - that's in the profile
      expect(orchestratorContent).not.toContain("## Orchestrator Invariants");
      expect(orchestratorContent).not.toContain("INV-001");

      // Should have stub indicator
      expect(orchestratorContent).toContain("System prompt is sourced from profile");
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
      expect(verifyResult.agentResults).toHaveLength(14);
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
      expect(verifyResult.agentResults).toHaveLength(14);
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
      expect(backup.entries).toHaveLength(28); // 14 agents + 14 skills (12 agent skills + 2 SDD bootstrap)

      // The pre-existing file should have its content captured
      const existingEntry = backup.entries.find((e) => e.absolutePath === plan.agents[0].absolutePath)!;
      expect(existingEntry.previousContent).toBe("old-content");

      // Files that didn't exist should have null
      const missingEntries = backup.entries.filter((e) => e.previousContent === null);
      expect(missingEntries).toHaveLength(27);
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

describe("verifyRunnerIsolation", () => {
  test("generated agent files contain no @deck/core or @deck/sdd-runtime imports", () => {
    const { valid, violations } = verifyRunnerIsolation();
    expect(valid).toBe(true);
    expect(violations).toHaveLength(0);
  });

  test("generated skill files contain no @deck/core or @deck/sdd-runtime imports", () => {
    const { valid, violations } = verifyRunnerIsolation();
    expect(valid).toBe(true);
    expect(violations).toHaveLength(0);
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
    // Memory is auxiliary policy is in the profile system prompt, not the agent stub
    expect(orchestrator.content).toContain("System prompt is sourced from profile");
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
      // Use non-orchestrator agent since orchestrator has stub content (Task 7.2)
      const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;

      expect(plan.memoryDiagnostics).toHaveLength(0);
      expect(explorer.content).toContain("Use Supermemory MCP as advisory context only.");
      expect(explorer.content).toContain("supermemory.execute");
      expect(explorer.content).toContain("supermemory.search_docs");
      expect(explorer.content).not.toContain("tools: read,write,bash,execute");
      expect(explorer.content).not.toContain("context,recall,memory");
      expect(explorer.content).not.toContain("sentinel-token-install");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("plan with Supermemory provider qualifies generic tools with custom server name", () => {
    const projectRoot = createTempProject();
    try {
      const mcpPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
      mkdirSync(join(projectRoot, "home", ".pi", "agent"), { recursive: true });
      writeFileSync(mcpPath, JSON.stringify({
        mcpServers: {
          customSupermemory: {
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
          instructions: [{ surface: "agent", markdown: "Use custom Supermemory MCP server.", teamId: "developer-team" }],
          toolBindings: [{ capability: "memory.search", serverName: "customSupermemory", toolNames: ["execute", "search_docs"] }],
        }),
      };

      const plan = buildDeveloperTeamInstallPlan(projectRoot, { memoryProvider: supermemoryProvider, piMcpConfigPath: mcpPath });
      // Use non-orchestrator agent since orchestrator has stub content (Task 7.2)
      const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;

      expect(plan.memoryDiagnostics).toHaveLength(0);
      expect(explorer.content).toContain("customSupermemory.execute");
      expect(explorer.content).toContain("customSupermemory.search_docs");
      expect(explorer.content).not.toContain("tools: read,write,bash,execute");
    } finally {
      cleanup(projectRoot);
    }
  });

  test("plan with Supermemory provider injects tools even without authenticatedRuntimeValidated (gate removed)", () => {
    // Task 7.1: Removed Pi-only gate - Pi now behaves like OpenCode
    // With valid MCP config, Supermemory tools are injected regardless of authenticatedRuntimeValidated
    const projectRoot = createTempProject();
    try {
      const mcpPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
      mkdirSync(join(projectRoot, "home", ".pi", "agent"), { recursive: true });
      writeFileSync(mcpPath, JSON.stringify({
        mcpServers: {
          customSupermemory: {
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
          instructions: [{ surface: "agent", markdown: "Use Supermemory MCP tools.", teamId: "developer-team" }],
          // No authenticatedRuntimeValidated in metadata - previously this would block injection
          toolBindings: [{ capability: "memory.search", serverName: "customSupermemory", toolNames: ["execute", "search_docs"] }],
        }),
      };

      const plan = buildDeveloperTeamInstallPlan(projectRoot, { memoryProvider: supermemoryProvider, piMcpConfigPath: mcpPath });
      // Use a non-orchestrator agent since orchestrator now has stub content
      const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;

      // No diagnostics - gate removed, injection happens with valid MCP config
      expect(plan.memoryDiagnostics).toHaveLength(0);
      // Memory content is injected in non-orchestrator agents
      expect(explorer.content).toContain("Use Supermemory MCP tools.");
      expect(explorer.content).toContain("customSupermemory.execute");
      expect(explorer.content).toContain("customSupermemory.search_docs");
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
      // Use non-orchestrator agent since orchestrator has stub content (Task 7.2)
      const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;

      expect(plan.memoryDiagnostics).toHaveLength(1);
      expect(plan.memoryDiagnostics[0].code).toBe("memory_provider_unavailable");
      expect(plan.memoryDiagnostics[0].providerId).toBe("supermemory");
      expect(JSON.stringify(plan.memoryDiagnostics)).not.toContain("x-supermemory-api-key");
      // Non-orchestrator agents should not have memory injection when MCP config is missing
      expect(explorer.content).not.toContain("Should not be injected.");
      expect(explorer.content).not.toContain("Supermemory MCP");
      expect(explorer.content).not.toContain("search_docs");
      expect(explorer.content).toContain("tools: read,write,bash");
    } finally {
      cleanup(projectRoot);
    }
  });

});

describe("Developer Team dashboard model/frontmatter preservation regressions", () => {
  function frontmatterFor(plan: ReturnType<typeof buildDeveloperTeamInstallPlan>, agentId: string): string {
    const agent = plan.agents.find((entry) => entry.agent.id === agentId);
    expect(agent).toBeTruthy();
    return agent!.content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  }

  test("dashboard assignments preserve the same observable model/thinking frontmatter as existing Configure models path", () => {
    const modelAssignments: DeveloperTeamModelAssignments = {
      "deck-developer-orchestrator": "openai-codex/gpt-5.5",
      "deck-developer-apply-backend": "opencode-go/kimi-k2.6",
    };
    const thinkingAssignments: DeveloperTeamThinkingAssignments = {
      "deck-developer-orchestrator": "high",
      "deck-developer-apply-backend": "high",
    };

    const existingConfigureModelsPlan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });
    const dashboardAssignmentsPlan = buildDeveloperTeamInstallPlan("/tmp/project", { modelAssignments, thinkingAssignments });

    expect(frontmatterFor(dashboardAssignmentsPlan, "deck-developer-orchestrator")).toBe(
      frontmatterFor(existingConfigureModelsPlan, "deck-developer-orchestrator"),
    );
    expect(frontmatterFor(dashboardAssignmentsPlan, "deck-developer-apply-backend")).toBe(
      frontmatterFor(existingConfigureModelsPlan, "deck-developer-apply-backend"),
    );
    expect(frontmatterFor(dashboardAssignmentsPlan, "deck-developer-orchestrator")).toContain("model: openai-codex/gpt-5.5");
    expect(frontmatterFor(dashboardAssignmentsPlan, "deck-developer-orchestrator")).toContain("thinking: high");
    expect(frontmatterFor(dashboardAssignmentsPlan, "deck-developer-apply-backend")).toContain("model: opencode-go/kimi-k2.6");
    expect(frontmatterFor(dashboardAssignmentsPlan, "deck-developer-apply-backend")).not.toContain("thinking:");
  });
});

describe("buildDeveloperTeamInstallPlan with capability instruction injection", () => {
  test("default plan has no package instruction section", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("## Package Instructions (configured)");

    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).not.toContain("## Package Instructions (configured)");
  });

  test("plan with capabilityInstructions bundle includes package instruction section in agent content", () => {
    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "agent",
          markdown: "Prefer search_graph, trace_path, get_code_snippet for structural discovery.",
          teamId: "developer-team",
        },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      capabilityInstructions: bundle,
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("## Package Instructions (configured)");
    expect(orchestrator.content).toContain("Prefer search_graph, trace_path, get_code_snippet");
    expect(orchestrator.content).toContain("runner's native package instruction system");
  });

  test("plan with capabilityInstructions bundle includes package instruction section in skill content", () => {
    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "context-mode",
          surface: "skill",
          markdown: "Use ctx_batch_execute and ctx_execute for large-output commands.",
          teamId: "developer-team",
        },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      capabilityInstructions: bundle,
    });

    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).toContain("## Package Instructions (configured)");
    expect(orchestratorSkill.content).toContain("ctx_batch_execute and ctx_execute");
  });

  test("capability instructions coexist with memory injection", () => {
    const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram",
      displayName: "Engram Memory",
      buildInjection: () => ({
        instructions: [
          { surface: "agent", markdown: "Agent-level Engram memory instructions.", teamId: "developer-team" },
        ],
        toolBindings: [
          { capability: "memory.search" as const, serverName: "engram", toolNames: ["memory_search"] },
        ],
      }),
    };

    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [
        {
          packageId: "codebase-memory",
          surface: "agent",
          markdown: "Prefer search_graph for structural discovery.",
          teamId: "developer-team",
        },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      memoryProvider: engramProvider,
      capabilityInstructions: bundle,
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("## Adaptive Memory (provider-injected)");
    expect(orchestrator.content).toContain("## Package Instructions (configured)");
    expect(orchestrator.content).toContain("Agent-level Engram memory instructions.");
    expect(orchestrator.content).toContain("Prefer search_graph for structural discovery.");
    expect(orchestrator.content).toContain("memory_search");
  });

  test("agent surface fragments do not appear in skill content", () => {
    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [
        { packageId: "codebase-memory", surface: "agent", markdown: "Agent-only instruction.", teamId: "developer-team" },
        { packageId: "rtk", surface: "skill", markdown: "Skill-only RTK guidance.", teamId: "developer-team" },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      capabilityInstructions: bundle,
    });

    const orchestratorAgent = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;

    expect(orchestratorAgent.content).toContain("Agent-only instruction.");
    expect(orchestratorAgent.content).not.toContain("Skill-only RTK guidance.");

    expect(orchestratorSkill.content).toContain("Skill-only RTK guidance.");
    expect(orchestratorSkill.content).not.toContain("Agent-only instruction.");
  });

  test("empty capabilityInstructions bundle produces no section", () => {
    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      capabilityInstructions: bundle,
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).not.toContain("## Package Instructions (configured)");
  });

  test("multiple package instructions from different packages are all included", () => {
    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [
        { packageId: "codebase-memory", surface: "agent", markdown: "Codebase memory guidance." },
        { packageId: "context-mode", surface: "agent", markdown: "Context mode guidance." },
        { packageId: "rtk", surface: "agent", markdown: "RTK fallback guidance." },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      capabilityInstructions: bundle,
    });

    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("Codebase memory guidance.");
    expect(orchestrator.content).toContain("Context mode guidance.");
    expect(orchestrator.content).toContain("RTK fallback guidance.");
  });

  test("orchestratorPersonality option flows to agent content", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project", {
      orchestratorPersonality: "guia",
    });

    // The personality is passed to getAgentContent → content registry → prompt variant selection
    // Verify personality option was consumed (no error thrown) and content was generated
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("deck-developer-orchestrator");
    expect(orchestrator.content).toContain("## Role");
    // Verify skill content was also generated with personality
    const orchestratorSkill = plan.skills.find((s) => s.agent.id === "deck-developer-orchestrator")!;
    expect(orchestratorSkill.content).toContain("## SDD Workflow");
    expect(orchestratorSkill.content).toContain("# Orchestrator Skill");
  });

  test("falls back to pragmatica when config read fails", () => {
    // Pass an invalid project root where readDeckConfig would throw
    // The try/catch in buildDeveloperTeamInstallPlan should fall back to DEFAULT_ORCHESTRATOR_PERSONALITY
    const plan = buildDeveloperTeamInstallPlan("/nonexistent-root-path", {
      orchestratorPersonality: undefined, // no explicit override
    });

    // Should still generate valid content (falls back to pragmatica)
    const orchestrator = plan.agents.find((a) => a.agent.id === "deck-developer-orchestrator")!;
    expect(orchestrator.content).toContain("## Role");
    expect(orchestrator.content).toContain("Delegate real work");
  });
});

describe("buildDeveloperTeamInstallPlan (capability instructions)", () => {
  test("capabilityInstructions via bundle prop (not readDeckConfig) works without config file", () => {
    const bundle: import("@deck/core").CapabilityInstructionBundle = {
      instructions: [
        { packageId: "codebase-memory", surface: "agent", markdown: "No config file needed." },
      ],
    };

    const plan = buildDeveloperTeamInstallPlan("/tmp/nonexistent-project", {
      capabilityInstructions: bundle,
    });

    const explorer = plan.agents.find((a) => a.agent.id === "deck-developer-explorer")!;
    expect(explorer.content).toContain("## Package Instructions (configured)");
    expect(explorer.content).toContain("No config file needed.");
  });
});

// ---------------------------------------------------------------------------
// Orchestrator Invariants Verification — REQ-BC-002, REQ-IBC-001, REQ-IBC-004
// ---------------------------------------------------------------------------

describe("verifyDeveloperTeamInstall with orchestrator invariants", () => {
  test("orchestrator agent and skill contain invariant section", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/test-project");

    const orchestrator = plan.agents.find(
      (a) => a.agent.id === "deck-developer-orchestrator",
    );
    expect(orchestrator).toBeDefined();
    expect(orchestrator!.content).toContain("## Orchestrator Behavior");
    // Invariants are now referenced via profile (REQ-PROMPT-002 compliance)
    expect(orchestrator!.content).toContain(".deck/pi/profiles/<team>/system-prompt.md");
    expect(orchestrator!.content).toContain("behavior guidelines");

    const orchestratorSkill = plan.skills.find(
      (s) => s.agent.id === "deck-developer-orchestrator",
    );
    expect(orchestratorSkill).toBeDefined();
    // Skill contains full invariant body (source of truth)
    expect(orchestratorSkill!.content).toContain("## Orchestrator Invariants");
    // Verify ALL 5 critical invariants are present in skill
    expect(orchestratorSkill!.content).toContain("INV-001");
    expect(orchestratorSkill!.content).toContain("INV-002");
    expect(orchestratorSkill!.content).toContain("INV-003");
    expect(orchestratorSkill!.content).toContain("INV-004");
    expect(orchestratorSkill!.content).toContain("INV-005");
  });

  test("non-orchestrator agents do NOT contain invariant section", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/test-project");

    const nonOrchestrators = plan.agents.filter(
      (a) => a.agent.id !== "deck-developer-orchestrator",
    );
    for (const agent of nonOrchestrators) {
      expect(
        agent.content,
        `${agent.agent.id} should NOT contain invariants`,
      ).not.toContain("## Orchestrator Invariants");
    }
  });

  test("verify function runs invariant checks for orchestrator surfaces", () => {
    const projectRoot = createTempProject();
    try {
      ensurePiDirs(projectRoot);
      const plan = buildDeveloperTeamInstallPlan(projectRoot);
      applyDeveloperTeamInstall(plan);

      const verifyResult = verifyDeveloperTeamInstall(plan);

      expect(verifyResult.agentResults.length).toBeGreaterThan(0);
      expect(verifyResult.skillResults.length).toBeGreaterThan(0);

      const orchAgentResult = verifyResult.agentResults.find(
        (r) => r.agentId === "deck-developer-orchestrator",
      );
      expect(orchAgentResult).toBeDefined();
    } finally {
      cleanup(projectRoot);
    }
  });
});

// ---------------------------------------------------------------------------
// Developer Team language policy propagation to Pi install-plan files
// (REQ-ADAPT-002, REQ-LEAK-001, REQ-LEAK-002, REQ-TEST-001, REQ-TEST-003)
// ---------------------------------------------------------------------------

describe("Developer Team language policy propagation to Pi install-plan files", () => {
  test("every non-orchestrator agent file and skill file contains the language policy", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    const nonOrchestratorAgents = plan.agents.filter(
      (a) => a.agent.id !== "deck-developer-orchestrator",
    );
    for (const agent of nonOrchestratorAgents) {
      expect(
        agent.content,
        `${agent.agent.id} agent file missing Developer Team language policy`,
      ).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    }

    for (const skill of plan.skills) {
      expect(
        skill.content,
        `${skill.agent.id} skill file missing Developer Team language policy`,
      ).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    }
  });

  test("no non-orchestrator agent file or skill file contains the known Spanish leak", () => {
    const plan = buildDeveloperTeamInstallPlan("/tmp/project");

    const nonOrchestratorAgents = plan.agents.filter(
      (a) => a.agent.id !== "deck-developer-orchestrator",
    );
    for (const agent of nonOrchestratorAgents) {
      expect(
        agent.content,
        `${agent.agent.id} agent file contains known leak`,
      ).not.toContain("herramienta");
    }

    for (const skill of plan.skills) {
      expect(
        skill.content,
        `${skill.agent.id} skill file contains known leak`,
      ).not.toContain("herramienta");
    }
  });
});
