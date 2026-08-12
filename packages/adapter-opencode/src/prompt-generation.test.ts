import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { DEVELOPER_TEAM_LANGUAGE_POLICY } from "@deck/core/teams/developer/content-registry";
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";
import type { MemoryInjectionBundle } from "@deck/core/memory/adaptive-memory";
import { applyPromptGeneration, buildPromptGenerationPlan, buildPromptReference } from "./prompt-generation";

const IDS = DEVELOPER_TEAM_AGENTS.map((agent) => agent.id);

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "deck-prompt-test-"));
}

describe("adaptive OpenCode prompt generation", () => {
  test("materializes exactly the seven canonical roles under prompts/deck-team", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });

    expect(plan.map(({ agent }) => agent.id)).toEqual(IDS);
    expect(plan).toHaveLength(7);
    for (const planned of plan) {
      expect(planned.absolutePath).toBe(`/tmp/.config/opencode/prompts/deck-team/${planned.agent.id}.md`);
      expect(planned.content).toContain(`name: "${planned.agent.skillId}"`);
      expect(planned.content).toContain(`/skills/${planned.agent.skillId}/SKILL.md`);
      expect(planned.content).toContain("# Skill Loading Gate");
      expect(planned.content).toContain("## Skill Reference");
      expect(planned.content).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    }
  });

  test("Lead and specialists receive distinct role content", () => {
    const plan = buildPromptGenerationPlan({ configDir: "/tmp/.config/opencode", projectRoot: "/tmp/project" });
    const lead = plan.find(({ agent }) => agent.id === "deck-lead")!;
    const investigate = plan.find(({ agent }) => agent.id === "deck-investigate")!;

    expect(lead.content).toContain("# Lead (deck-lead)");
    expect(lead.content).toContain("## Skill Discovery Runtime Context");
    expect(lead.content).toContain("- active_runner_id: opencode");
    expect(investigate.content).toContain("# Investigate (deck-investigate)");
    expect(investigate.content).toContain("## Specialist Skill Discovery Contract");
    expect(lead.content).not.toBe(investigate.content);
  });

  test("writes the complete plan idempotently", () => {
    const root = tempDir();
    try {
      const plan = buildPromptGenerationPlan({ configDir: join(root, ".config", "opencode"), projectRoot: root });
      applyPromptGeneration(plan);
      applyPromptGeneration(plan);
      for (const planned of plan) {
        expect(existsSync(planned.absolutePath)).toBe(true);
        expect(readFileSync(planned.absolutePath, "utf-8")).toBe(planned.content);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("buildPromptReference uses the canonical prompt directory", () => {
    expect(buildPromptReference("/home/user/.config/opencode", "deck-lead"))
      .toBe("{file:/home/user/.config/opencode/prompts/deck-team/deck-lead.md}");
  });
});

describe("configured capability composition", () => {
  test("all specialists retain runner-configured agent-surface package instructions", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode"]);
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: bundle,
    });

    for (const planned of plan.filter(({ agent }) => agent.id !== "deck-lead")) {
      expect(planned.content, planned.agent.id).toContain("Codebase Memory");
      expect(planned.content, planned.agent.id).toContain("Context Mode Package");
    }
  });

  test("Serena agent-surface instructions reach both Apply roles", () => {
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: buildCapabilityInstructionBundle(["serena"]),
    });

    for (const id of ["deck-apply-fast", "deck-apply-deep"]) {
      expect(plan.find(({ agent }) => agent.id === id)!.content).toContain("Serena");
    }
    expect(plan.find(({ agent }) => agent.id === "deck-quality")!.content).not.toContain("Serena Package");
  });
});

describe("adaptive memory provider filtering", () => {
  const providerBundle = (provider: "supermemory" | "engram"): MemoryInjectionBundle => ({
    instructions: [{
      surface: "agent",
      markdown: "### Provider: Supermemory\n\nUse memory.\n\n### Provider: Engram\n\nUse Engram.",
    }],
    toolBindings: provider === "supermemory"
      ? [{ capability: "memory.write", serverName: "supermemory", toolNames: ["memory", "recall"] }]
      : [{ capability: "memory.write", serverName: "engram", toolNames: ["listProjects"] }],
  });

  test("removes the inactive provider section", () => {
    const supermemory = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      memoryBundle: providerBundle("supermemory"),
    });
    const engram = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      memoryBundle: providerBundle("engram"),
    });

    for (const planned of supermemory) expect(planned.content).not.toContain("### Provider: Engram");
    for (const planned of engram) expect(planned.content).not.toContain("### Provider: Supermemory");
  });

  test("explicit or detected Supermemory keeps memory/recall instructions", () => {
    const root = tempDir();
    try {
      const configDir = join(root, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        mcp: { supermemory: { type: "remote", url: "https://mcp.supermemory.ai/mcp" } },
      }));
      const detected = buildPromptGenerationPlan({ configDir, projectRoot: root });
      expect(detected).toHaveLength(7);
      expect(detected.map(({ content }) => content).join("\n")).toContain("bounded recall");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Apply authorization composition", () => {
  const authorization = {
    requestClassification: "Run SDD" as const,
    userAuthorizedModification: true,
    sddChange: "test-change",
    explorerArtifact: "/tmp/openspec/changes/test-change/explorer-report.md",
    proposalArtifact: "/tmp/openspec/changes/test-change/proposal.md",
    specArtifact: "/tmp/openspec/changes/test-change/spec.md",
    designArtifact: "/tmp/openspec/changes/test-change/design.md",
    taskArtifact: "/tmp/openspec/changes/test-change/tasks.md",
    allowedTargets: ["src/**"] as const,
    blockedTargets: ["*.test.ts"] as const,
  };

  test("injects a supplied card only into Apply Fast and Apply Deep", () => {
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      authorization,
    });

    for (const planned of plan) {
      const hasCard = planned.content.includes("## Pre-Delegation Gate Checklist");
      expect(hasCard, planned.agent.id).toBe(
        planned.agent.id === "deck-apply-fast" || planned.agent.id === "deck-apply-deep",
      );
    }
  });
});
