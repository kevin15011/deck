import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import { DEVELOPER_TEAM_LANGUAGE_POLICY, getAgentContent } from "@deck/core/teams/developer/content-registry";
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";
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
      expect(planned.content, planned.agent.id).not.toMatch(/context.mode/i);
    }
  });

  test("retired Serena instructions reach no Apply role", () => {
    const plan = buildPromptGenerationPlan({
      configDir: "/tmp/.config/opencode",
      projectRoot: "/tmp/project",
      capabilityInstructions: buildCapabilityInstructionBundle(["serena"]),
    });

    for (const id of ["deck-apply-fast", "deck-apply-deep"]) {
      expect(plan.find(({ agent }) => agent.id === id)!.content).not.toContain("Serena");
    }
    expect(plan.find(({ agent }) => agent.id === "deck-quality")!.content).not.toContain("Serena Package");
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
