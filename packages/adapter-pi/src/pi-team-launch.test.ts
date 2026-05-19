import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildPiTeamLaunchPlan, buildTeamSessionDir, buildTeamProfileDir } from "./pi-team-launch";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "deck-launch-test-"));
}

function writeAgent(projectRoot: string, agentId: string, frontmatter: string[]) {
  mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
  writeFileSync(join(projectRoot, ".pi", "agents", `${agentId}.md`), ["---", ...frontmatter, "---", "", "# Agent"].join("\n"), "utf-8");
}

describe("buildPiTeamLaunchPlan", () => {
  test("builds a launch plan for the Developer Team with default flags", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/home/user/my-project",
    });

    expect(plan.command).toBe("pi");
    expect(plan.isContinue).toBe(false);
    expect(plan.cwd).toBe("/home/user/my-project");
    expect(plan.sessionDir).toBe("/home/user/my-project/.deck/pi/sessions/developer-team");
    expect(plan.profileDir).toBe("/home/user/my-project/.deck/pi/profiles/developer-team");
    expect(plan.args).toContain("--session-dir");
    expect(plan.args).toContain(plan.sessionDir);
    expect(plan.args).toContain("--system-prompt");
    expect(plan.args).toContain(plan.profileDir + "/system-prompt.md");
    // Should NOT contain --continue
    expect(plan.args).not.toContain("--continue");
  });

  test("uses custom pi command when provided", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      piCommand: "/usr/local/bin/pi",
    });

    expect(plan.command).toBe("/usr/local/bin/pi");
  });

  test("includes --continue flag when continue is true", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      flags: { continue: true },
    });

    expect(plan.isContinue).toBe(true);
    expect(plan.args).toContain("--continue");
    expect(plan.args).not.toContain("--resume");
  });

  test("includes --resume flag when resume is true", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      flags: { resume: true },
    });

    expect(plan.isResume).toBe(true);
    expect(plan.args).toContain("--resume");
    expect(plan.args).not.toContain("--continue");
  });

  test("neither flag set when resume is false", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      flags: { resume: false },
    });

    expect(plan.isResume).toBe(false);
    expect(plan.args).not.toContain("--resume");
    expect(plan.args).not.toContain("--continue");
  });

  test("omits --continue flag when continue is false", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      flags: { continue: false },
    });

    expect(plan.isContinue).toBe(false);
    expect(plan.args).not.toContain("--continue");
  });

  test("uses canonical Developer Team agents with team-scoped IDs", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
    });

    // The plan should have an agentIds field referencing the canonical catalog
    // with team-scoped IDs
    expect(plan.agentIds).toEqual([
      "deck-developer-orchestrator",
      "deck-developer-explorer",
      "deck-developer-proposal",
      "deck-developer-spec",
      "deck-developer-design",
      "deck-developer-task",
      "deck-developer-apply-general",
      "deck-developer-apply-backend",
      "deck-developer-apply-frontend",
      "deck-developer-verify",
      "deck-developer-review",
      "deck-developer-archive",
    ]);
  });

  test("adds orchestrator model and thinking launch flags from installed agent frontmatter", () => {
    const projectRoot = createTempProject();
    try {
      writeAgent(projectRoot, "deck-developer-orchestrator", [
        "name: deck-developer-orchestrator",
        "model: openai-codex/gpt-5.5",
        "thinking: high",
      ]);

      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot });

      expect(plan.args).toContain("--model");
      expect(plan.args).toContain("openai-codex/gpt-5.5");
      expect(plan.args).toContain("--thinking");
      expect(plan.args).toContain("high");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("keeps Kimi orchestrator model without thinking launch flag", () => {
    const projectRoot = createTempProject();
    try {
      writeAgent(projectRoot, "deck-developer-orchestrator", [
        "name: deck-developer-orchestrator",
        "model: opencode-go/kimi-k2.6",
      ]);

      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot });

      expect(plan.args).toContain("--model");
      expect(plan.args).toContain("opencode-go/kimi-k2.6");
      expect(plan.args).not.toContain("--thinking");
      expect(plan.args).not.toContain("off");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("omits Kimi orchestrator thinking even when frontmatter requested it", () => {
    const projectRoot = createTempProject();
    try {
      writeAgent(projectRoot, "deck-developer-orchestrator", [
        "name: deck-developer-orchestrator",
        "model: opencode-go/kimi-k2.6",
        "thinking: high",
      ]);

      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot });

      expect(plan.args).toContain("--model");
      expect(plan.args).toContain("opencode-go/kimi-k2.6");
      expect(plan.args).not.toContain("--thinking");
      expect(plan.args).not.toContain("off");
      expect(plan.args).not.toContain("high");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("omits model and thinking launch flags when orchestrator has no assignment", () => {
    const projectRoot = createTempProject();
    try {
      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot });

      expect(plan.args).not.toContain("--model");
      expect(plan.args).not.toContain("--thinking");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("throws for unknown team ID", () => {
    expect(() =>
      buildPiTeamLaunchPlan({
        teamId: "unknown-team",
        projectRoot: "/tmp/project",
      }),
    ).toThrow(/unknown team/i);
  });

  test("preserves existing env vars and adds PI_SESSION_DIR", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
    });

    expect(plan.env.PI_SESSION_DIR).toBe(plan.sessionDir);
    // Should also include process.env basics
    expect(plan.env.PATH).toBe(process.env.PATH!);
    expect(plan.env.HOME).toBe(process.env.HOME!);
  });
});

describe("buildTeamSessionDir", () => {
  test("returns .deck/pi/sessions/<teamId> under project root", () => {
    expect(buildTeamSessionDir("/tmp/project", "developer-team")).toBe(
      "/tmp/project/.deck/pi/sessions/developer-team",
    );
  });
});

describe("buildTeamProfileDir", () => {
  test("returns .deck/pi/profiles/<teamId> under project root", () => {
    expect(buildTeamProfileDir("/tmp/project", "developer-team")).toBe(
      "/tmp/project/.deck/pi/profiles/developer-team",
    );
  });
});
