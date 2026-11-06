import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEVELOPER_TEAM_LANGUAGE_POLICY } from "@deck/core/teams/developer/content-registry";
import {
  buildTeamSystemPrompt,
  materializeTeamProfile as legacyMaterializeTeamProfile,
  readPiExecutionExtensionSource,
  type MaterializeTeamProfileOptions,
} from "./pi-team-profile";

import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall } from "./pi-global-install";

// Exercise profile content/idempotence through the current transaction, never the retired project writer.
function materializeTeamProfile(options: MaterializeTeamProfileOptions): void {
  const io = createNodePiFileIO();
  if (options.writeFile) io.writeText = (path, content) => options.writeFile!(path, content, "utf-8");
  const desired = {
    agentDir: options.projectRoot,
    files: [
      { relPath: `deck/profiles/${options.teamId}/system-prompt.md`, content: buildTeamSystemPrompt(options.teamId, options).content },
      { relPath: `deck/profiles/${options.teamId}/extensions/developer-team-execution.js`, content: readPiExecutionExtensionSource() },
    ],
    packageEntry: undefined, skillExclusions: [], mcpServers: {}, legacyDeckEvidence: false,
  };
  applyPiGlobalPlan(planPiGlobalInstall(desired, io), io);
}

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe("buildTeamSystemPrompt", () => {

  test("materializes role-owned skill loading and Pi conversational yielding on disk", () => {
    const root = createTempDir("deck-pi-delegation-policy-");
    try {
      materializeTeamProfile({ teamId: "developer-team", projectRoot: root });
      const content = readFileSync(join(root, "deck/profiles/developer-team/system-prompt.md"), "utf8");
      expect(content).toBe(buildTeamSystemPrompt("developer-team").content);
      expect(countOccurrences(content, "## Pi background delegation and conversational availability")).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses compact session content by default regardless of obsolete rollout receipts", () => {
    const compact = buildTeamSystemPrompt("developer-team");
    const eligible = buildTeamSystemPrompt("developer-team", {

    });
    const paused = buildTeamSystemPrompt("developer-team", {

    });

    expect(compact.content).toContain("# Lead (deck-lead)");
    expect(compact.content).toContain("Adaptive Developer Team Contract");
    expect(eligible.content).toBe(compact.content);
    expect(paused.content).toBe(compact.content);
  });

  test("throws for unknown team", () => {
    expect(() => buildTeamSystemPrompt("unknown-team")).toThrow(/unknown team/i);
  });

});

describe("materializeTeamProfile", () => {
  test("creates profile directory and writes system-prompt.md", () => {
    const projectRoot = createTempDir();
    try {
      materializeTeamProfile({
        teamId: "developer-team",
        projectRoot,
      });

      const profileDir = join(projectRoot, "deck", "profiles", "developer-team");
      const systemPromptPath = join(profileDir, "system-prompt.md");

      const content = readFileSync(systemPromptPath, "utf-8");
      expect(content).toContain("Developer Team");
      expect(content).toContain("Adaptive Developer Team Contract");
      expect(content).toContain("- active_runner_id: pi");
      expect(content).toContain("deck skill-registry refresh --runner pi");
      expect(content).not.toContain("--runner opencode");
      expect(content).not.toContain(".pi/skills");
      expect(content).not.toContain(".opencode/skills");
      expect(content).not.toContain("~/.pi/");
      expect(content).not.toContain("~/.config/opencode/");
      expect(countOccurrences(content, "## Skill Discovery Authority Boundary")).toBe(1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("is idempotent — re-running does not error", () => {
    const projectRoot = createTempDir();
    try {
      materializeTeamProfile({ teamId: "developer-team", projectRoot });
      materializeTeamProfile({ teamId: "developer-team", projectRoot });

      const content = readFileSync(
        join(projectRoot, "deck", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );
      expect(content).toContain("Developer Team");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("retired profile writer refuses before injected filesystem effects", () => {
    let writes = 0;
    expect(() => legacyMaterializeTeamProfile({
      teamId: "developer-team", projectRoot: "/fake",
      mkdir: () => { writes++; }, writeFile: () => { writes++; },
      exists: () => false,
    })).toThrow(/PiRunnerAdapter/);
    expect(writes).toBe(0);
  });

  test("does not write if content is unchanged", () => {
    const projectRoot = createTempDir();
    try {
      // First write
      materializeTeamProfile({ teamId: "developer-team", projectRoot });

      const content = readFileSync(
        join(projectRoot, "deck", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );

      // Second write with same content should not change the file
      let writeCalled = false;
      materializeTeamProfile({
        teamId: "developer-team",
        projectRoot,
        writeFile: (path, data) => {
          writeCalled = true;
          writeFileSync(path, data, "utf-8");
        },
      });

      // Since content matches, writeFile should not be called
      expect(writeCalled).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Developer Team language policy propagation to Pi team profile
// (REQ-ADAPT-002, REQ-LEAK-001, REQ-LEAK-002, REQ-TEST-001, REQ-TEST-003)
// ---------------------------------------------------------------------------

describe("Developer Team language policy propagation to Pi team profile", () => {
  test("buildTeamSystemPrompt includes the language policy and excludes the known leak", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    expect(content).not.toContain("herramienta");
  });

  test("materialized profile system-prompt.md includes the language policy and excludes the known leak", () => {
    const projectRoot = createTempDir();
    try {
      materializeTeamProfile({ teamId: "developer-team", projectRoot });
      const content = readFileSync(
        join(projectRoot, "deck", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );
      expect(content).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
      expect(content).not.toContain("herramienta");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
