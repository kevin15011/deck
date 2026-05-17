import { describe, expect, test } from "bun:test";

import { buildPiTeamLaunchPlan, buildTeamSessionDir, buildTeamProfileDir } from "./pi-team-launch";

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
