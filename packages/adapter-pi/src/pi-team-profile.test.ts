import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildTeamSystemPrompt,
  materializeTeamProfile,
  type MaterializeTeamProfileOptions,
} from "./pi-team-profile";

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("buildTeamSystemPrompt", () => {
  test("includes all Developer Team agent roles for developer-team", () => {
    const prompt = buildTeamSystemPrompt("developer-team");

    expect(prompt).toContain("Developer Team");
    expect(prompt).toContain("deck-developer-orchestrator");
    expect(prompt).toContain("deck-developer-explorer");
    expect(prompt).toContain("deck-developer-apply-general");
    expect(prompt).toContain("deck-developer-verify");
    expect(prompt).toContain("deck-developer-archive");
    expect(prompt).toContain("Orchestrator");
    expect(prompt).toContain("Explorer");
  });

  test("contains real orchestrator operating rules — not placeholder", () => {
    const prompt = buildTeamSystemPrompt("developer-team");

    // Should have delegation rules
    expect(prompt).toContain("Delegation Rules");
    expect(prompt).toContain("4+");

    // Should have dependency graph
    expect(prompt).toContain("Dependency Graph");

    // Should NOT have placeholder text
    expect(prompt).not.toContain("Follow the team's established workflow");
  });

  test("contains Deck-specific apply routing", () => {
    const prompt = buildTeamSystemPrompt("developer-team");
    expect(prompt).toContain("General");
    expect(prompt).toContain("Backend");
    expect(prompt).toContain("Frontend");
  });

  test("references project AI notes", () => {
    const prompt = buildTeamSystemPrompt("developer-team");
    expect(prompt).toContain(".deck/ai-notes/");
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

      const profileDir = join(projectRoot, ".deck", "pi", "profiles", "developer-team");
      const systemPromptPath = join(profileDir, "system-prompt.md");

      const content = readFileSync(systemPromptPath, "utf-8");
      expect(content).toContain("Developer Team");
      expect(content).toContain("deck-developer-orchestrator");
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
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );
      expect(content).toContain("Developer Team");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses injected fs functions for testability", () => {
    const projectRoot = "/fake";
    const written: { path: string; content: string }[] = [];

    materializeTeamProfile({
      teamId: "developer-team",
      projectRoot,
      mkdir: () => { /* no-op */ },
      writeFile: (path, content) => { written.push({ path, content }); },
      readFile: () => { throw new Error("should not read"); },
      exists: () => false, // file does not exist yet -> should write
    });

    expect(written).toHaveLength(1);
    expect(written[0].path).toBe("/fake/.deck/pi/profiles/developer-team/system-prompt.md");
    expect(written[0].content).toContain("Developer Team");
  });

  test("does not write if content is unchanged", () => {
    const projectRoot = createTempDir();
    try {
      // First write
      materializeTeamProfile({ teamId: "developer-team", projectRoot });

      const content = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
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
        readFile: () => content,
        exists: () => true,
      });

      // Since content matches, writeFile should not be called
      expect(writeCalled).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
