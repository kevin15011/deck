import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprintSupermemoryProjectScope,
  resolveCanonicalSupermemoryProjectScope,
} from "./canonical-supermemory-project";

describe("canonical Supermemory project scope", () => {
  function gitProject(remote: string): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-scope-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: projectRoot, stdio: "ignore" });
    return projectRoot;
  }

  test("normalizes equivalent HTTPS, SSH, SCP, and SSH-alias GitHub remotes to one v1 scope", () => {
    const remotes = [
      "https://github.com/kevin15011/deck.git",
      "git@github.com:kevin15011/deck.git",
      "ssh://git@github.com/kevin15011/deck.git",
      "git@github-p:kevin15011/deck.git",
    ];

    const scopes = remotes.map((remote) => resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [remote] }));

    expect(scopes.every((scope) => scope.ok)).toBe(true);
    expect(scopes.map((scope) => scope.ok ? scope.scope : "")).toEqual([
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
    ]);
    expect(scopes[3].ok && scopes[3].scope.includes("github-p")).toBe(false);
  });

  test("fails closed without falling back to directory basename or default scope", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-no-remote-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SUPERMEMORY_PROJECT_IDENTITY_MISSING");
    expect(JSON.stringify(result)).not.toContain("sm_project_default");
    expect(JSON.stringify(result)).not.toContain("sm_project_deck");
  });

  test("requires the explicit current project to be a real Git working tree", () => {
    const notGit = mkdtempSync(join(tmpdir(), "deck-sm-not-git-"));
    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: notGit, remotes: ["https://github.com/other/repo.git"] });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SUPERMEMORY_PROJECT_GIT_ROOT_INVALID");
    expect(JSON.stringify(result)).not.toContain("other");
    expect(JSON.stringify(result)).not.toContain("repo");
  });

  test("uses the verified real Git top-level instead of a nested cwd or package fallback", () => {
    const projectRoot = gitProject("https://github.com/acme/project-a.git");
    const nested = join(projectRoot, "packages", "fake");
    mkdirSync(nested, { recursive: true });

    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: nested, remotes: [] });

    expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_acme_project_a" });
  });

  test("rejects filesystem-like and malformed local path remotes", () => {
    for (const remote of ["/tmp/acme/repo.git", "../acme/repo.git", "file:///tmp/acme/repo.git", "not a remote"]) {
      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: "/repo/deck", remotes: [remote] });
      expect(result.ok).toBe(false);
    }
  });

  test("uses verified project root to resolve origin when remotes are not supplied", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-scope-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github-p:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });

    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });

    expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_kevin15011_deck" });
  });

  test("ignores ambient Git config that attempts to rewrite the repository origin", () => {
    const baseRoot = gitProject("git@github-p:acme/project-a.git");
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: baseRoot, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Deck Test"], { cwd: baseRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "--allow-empty", "-m", "initial"], { cwd: baseRoot, stdio: "ignore" });
    const projectRoot = join(mkdtempSync(join(tmpdir(), "deck-sm-worktree-parent-")), "project-a-worktree");
    execFileSync("git", ["worktree", "add", projectRoot], { cwd: baseRoot, stdio: "ignore" });
    const previous = {
      GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
      GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
      GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
    };
    try {
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = "remote.origin.url";
      process.env.GIT_CONFIG_VALUE_0 = "https://github.com/acme/project-b.git";
      process.env.GIT_CONFIG_GLOBAL = join(projectRoot, "attacker-global.gitconfig");
      process.env.GIT_CONFIG_SYSTEM = join(projectRoot, "attacker-system.gitconfig");

      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });

      expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_acme_project_a" });
      expect(JSON.stringify(result)).not.toContain("project_b");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("emits a redacted fingerprint rather than the raw project scope", () => {
    const fingerprint = fingerprintSupermemoryProjectScope("sm_project_v1_kevin15011_deck");

    expect(fingerprint).toMatch(/^smfp_[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain("kevin15011");
    expect(fingerprint).not.toContain("deck");
  });
});
