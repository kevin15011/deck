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
      "deck-lead",
      "deck-investigate",
      "deck-architect",
      "deck-apply-fast",
      "deck-apply-deep",
      "deck-quality",
      "deck-setup",
    ]);
  });

  test("adds orchestrator model and thinking launch flags from installed agent frontmatter", () => {
    const projectRoot = createTempProject();
    try {
      writeAgent(projectRoot, "deck-lead", [
        "name: deck-lead",
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
      writeAgent(projectRoot, "deck-lead", [
        "name: deck-lead",
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
      writeAgent(projectRoot, "deck-lead", [
        "name: deck-lead",
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

  test("preserves existing env vars and passes the session dir only through --session-dir", () => {
    const plan = buildPiTeamLaunchPlan({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
    });

    // Pi 1.0 ignores PI_SESSION_DIR; the real mechanism is the --session-dir flag.
    expect(plan.env).not.toHaveProperty("PI_SESSION_DIR");
    expect(plan.args[plan.args.indexOf("--session-dir") + 1]).toBe(plan.sessionDir);
    // Should also include process.env basics
    expect(plan.env.PATH).toBe(process.env.PATH!);
    expect(plan.env.HOME).toBe(process.env.HOME!);
  });

  test("sanitizes provider credentials from the legacy Pi child environment", () => {
    const previous = { SUPERMEMORY_API_KEY: process.env.SUPERMEMORY_API_KEY, DATABASE_URL: process.env.DATABASE_URL };
    process.env.SUPERMEMORY_API_KEY = "sm_test_secret";
    process.env.DATABASE_URL = "postgres://user:pass@host/db";
    try {
      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/tmp/project" });
      expect(plan.env).not.toHaveProperty("SUPERMEMORY_API_KEY");
      expect(plan.env).not.toHaveProperty("DATABASE_URL");
      expect(plan.env).not.toHaveProperty("PI_SESSION_DIR");
    } finally {
      if (previous.SUPERMEMORY_API_KEY === undefined) delete process.env.SUPERMEMORY_API_KEY;
      else process.env.SUPERMEMORY_API_KEY = previous.SUPERMEMORY_API_KEY;
      if (previous.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.DATABASE_URL;
    }
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

describe("buildPiTeamLaunchPlan with a global Pi agent directory", () => {
  const agentDir = "/opt/pi-home";

  test("references the global profile by absolute path and loads extensions through the package", () => {
    const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/work/project", agentDir });

    expect(plan.profileDir).toBe("/opt/pi-home/deck/profiles/developer-team");
    expect(plan.args[plan.args.indexOf("--system-prompt") + 1]).toBe("/opt/pi-home/deck/profiles/developer-team/system-prompt.md");
    expect(plan.args).not.toContain("--extension");
    expect(plan.args.join(" ")).not.toContain(".deck/pi/profiles");
    expect(plan.args.join(" ")).not.toContain("/work/project/.pi");
  });

  test("passes the session dir by flag and marks the session as a Deck lead session", () => {
    const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/work/project", agentDir });

    expect(plan.args[plan.args.indexOf("--session-dir") + 1]).toBe("/work/project/.deck/pi/sessions/developer-team");
    expect(plan.env).not.toHaveProperty("PI_SESSION_DIR");
    expect(plan.env.DECK_PI_SESSION).toBe("1");
    expect(plan.env.DECK_PI_ROLE).toBe("lead");
    expect(plan.env).not.toHaveProperty("DECK_PI_CHILD");
  });

  test("reads the lead model assignment from the package agents directory", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-launch-global-"));
    try {
      const agents = join(root, "deck", "package", "agents");
      mkdirSync(agents, { recursive: true });
      writeFileSync(join(agents, "deck-lead.md"), ["---", "name: deck-lead", "model: openai-codex/gpt-5.5", "thinking: high", "---", "", "# Agent"].join("\n"), "utf-8");

      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/work/project", agentDir: root });

      expect(plan.args[plan.args.indexOf("--model") + 1]).toBe("openai-codex/gpt-5.5");
      expect(plan.args[plan.args.indexOf("--thinking") + 1]).toBe("high");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a lead launch never inherits an outer child marker", () => {
    const previous = process.env.DECK_PI_CHILD;
    process.env.DECK_PI_CHILD = "1";
    try {
      const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/work/project", agentDir });
      expect(plan.env).not.toHaveProperty("DECK_PI_CHILD");
    } finally {
      if (previous === undefined) delete process.env.DECK_PI_CHILD;
      else process.env.DECK_PI_CHILD = previous;
    }
  });

  test("keeps --continue and --resume behavior", () => {
    expect(buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/p", agentDir, flags: { continue: true } }).args).toContain("--continue");
    expect(buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/p", agentDir, flags: { resume: true } }).args).toContain("--resume");
  });

  test("never runs `pi` with stdin-dependent print flags (interactive TUI)", () => {
    const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: "/p", agentDir });
    expect(plan.args).not.toContain("-p");
    expect(plan.args).not.toContain("--mode");
  });
});
