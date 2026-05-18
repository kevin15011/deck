import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPiLaunch } from "./pi-launch-command";

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeOrchestratorAssignment(projectRoot: string) {
  mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"),
    [
      "---",
      "name: deck-developer-orchestrator",
      "model: openai-codex/gpt-5.5",
      "thinking: medium",
      "---",
      "",
      "# Agent",
    ].join("\n"),
    "utf-8",
  );
}

describe("runPiLaunch", () => {
  test("returns error when pi command is not found", () => {
    const result = runPiLaunch({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      flags: {},
      commandExists: () => false,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("pi");
    }
  });

  test("returns launch info without spawning when dryRun is true", () => {
    const projectRoot = createTempDir();
    try {
      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        piCommand: "pi",
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.command).toBe("pi");
        expect(result.plan.isContinue).toBe(false);
        expect(result.plan.sessionDir).toContain("developer-team");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes profile before returning dry-run plan", () => {
    const projectRoot = createTempDir();
    try {
      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("dry-run plan includes orchestrator model and thinking flags", () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot);
      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.args).toContain("--model");
        expect(result.plan.args).toContain("openai-codex/gpt-5.5");
        expect(result.plan.args).toContain("--thinking");
        expect(result.plan.args).toContain("medium");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
