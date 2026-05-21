import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildCommandGenerationPlan, applyCommandGeneration } from "./command-generation";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "deck-command-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("buildCommandGenerationPlan", () => {
  test("generates 14 command files", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    expect(plan).toHaveLength(14);
  });

  test("all 14 commands are present", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    const ids = plan.map((p) => p.commandId).sort();
    expect(ids).toContain("sdd-apply");
    expect(ids).toContain("sdd-archive");
    expect(ids).toContain("sdd-design");
    expect(ids).toContain("sdd-explore");
    expect(ids).toContain("sdd-init");
    expect(ids).toContain("sdd-new");
    expect(ids).toContain("sdd-continue");
    expect(ids).toContain("sdd-ff");
    expect(ids).toContain("sdd-onboard");
    expect(ids).toContain("sdd-propose");
    expect(ids).toContain("sdd-review");
    expect(ids).toContain("sdd-spec");
    expect(ids).toContain("sdd-tasks");
    expect(ids).toContain("sdd-verify");
  });

  test("each command has valid frontmatter with agent and subtask", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    for (const planned of plan) {
      expect(planned.content).toContain("---");
      expect(planned.content).toContain("description:");
      expect(planned.content).toContain("agent: deck-developer-orchestrator");
      expect(planned.content).toContain("subtask: true");
    }
  });

  test("each command uses {file:/absolute/path} format for prompt reference", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    for (const planned of plan) {
      expect(planned.content).toMatch(/!`pwd`/);
      expect(planned.content).toMatch(/!`basename/);
    }
  });

  test("command file paths use configDir/commands/ prefix", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp/.config/opencode" });
    for (const planned of plan) {
      expect(planned.absolutePath).toContain("/commands/");
      expect(planned.absolutePath).toEndWith(`${planned.commandId}.md`);
    }
  });

  test("sdd-apply command blocks when spec/design/tasks missing", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    const sddApply = plan.find((p) => p.commandId === "sdd-apply")!;
    expect(sddApply.content).toContain("spec, design, and tasks");
    expect(sddApply.content).toContain("/sdd-ff");
  });

  test("sdd-verify command requires apply-progress", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    const sddVerify = plan.find((p) => p.commandId === "sdd-verify")!;
    expect(sddVerify.content).toContain("apply-progress");
  });

  test("sdd-init has no hard gates (first command)", () => {
    const plan = buildCommandGenerationPlan({ configDir: "/tmp" });
    const sddInit = plan.find((p) => p.commandId === "sdd-init")!;
    expect(sddInit.content).not.toContain("HARD GATES");
  });
});

describe("applyCommandGeneration", () => {
  test("writes all 14 command files to disk", () => {
    const dir = createTempDir();
    try {
      const configDir = join(dir, ".config", "opencode");
      const plan = buildCommandGenerationPlan({ configDir });
      applyCommandGeneration(plan);

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
      const plan = buildCommandGenerationPlan({ configDir });
      applyCommandGeneration(plan);
      applyCommandGeneration(plan);

      for (const planned of plan) {
        const content = readFileSync(planned.absolutePath, "utf-8");
        expect(content).toBe(planned.content);
      }
    } finally {
      cleanup(dir);
    }
  });
});