import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSupermemorySessionScope } from "./supermemory-session-scope";

describe("Supermemory session scope", () => {
  const roots: string[] = [];
  function directory(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-sm-session-scope-")));
    roots.push(root);
    return root;
  }
  function repository(config?: string): string {
    const root = directory();
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    if (config !== undefined) writeFileSync(join(root, ".git", "config"), config);
    return root;
  }
  const resolveScope = (projectRoot: string) => resolveSupermemorySessionScope({ projectRoot, remotes: [] });
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  test("ordinary directories use global untagged memory", () => {
    expect(resolveScope(directory())).toEqual({ kind: "global", diagnostics: [] });
  });

  test("initialized Git repositories without origin use global untagged memory", () => {
    const root = repository();
    mkdirSync(join(root, "nested"));
    expect(resolveScope(join(root, "nested"))).toEqual({ kind: "global", diagnostics: [] });
  });

  test("nested directories retain their canonical repository scope", () => {
    const root = repository('[remote "origin"]\n\turl = git@github.com:owner/repo.git\n');
    mkdirSync(join(root, "nested"));
    expect(resolveScope(join(root, "nested"))).toEqual({ kind: "canonical", projectScope: "sm_project_v1_owner_repo", diagnostics: [] });
  });

  test("trusted SSH aliases retain canonical scope and unsafe aliases never become global", () => {
    const root = repository('[remote "origin"]\n\turl = git@github-personal:owner/repo.git\n');
    const home = directory();
    mkdirSync(join(home, ".ssh"));
    const config = join(home, ".ssh", "config");
    writeFileSync(config, "Host github-personal\n  HostName github.com\n  HostKeyAlias github.com\n", { mode: 0o600 });
    const input = { projectRoot: root, remotes: [], sshConfig: { homeDir: home } };
    expect(resolveSupermemorySessionScope(input)).toEqual({ kind: "canonical", projectScope: "sm_project_v1_owner_repo", diagnostics: [] });
    chmodSync(config, 0o666);
    expect(resolveSupermemorySessionScope(input).kind).toBe("invalid");
  });

  test("verified linked worktrees share both absent and canonical identities", () => {
    const root = repository();
    const gitDir = join(root, ".git", "worktrees", "linked");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, "commondir"), "../..\n");
    const linked = directory();
    writeFileSync(join(linked, ".git"), `gitdir: ${gitDir}\n`);
    expect(resolveScope(linked).kind).toBe("global");
    writeFileSync(join(root, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/owner/repo.git\n');
    expect(resolveScope(linked)).toEqual({ kind: "canonical", projectScope: "sm_project_v1_owner_repo", diagnostics: [] });
  });

  test("ambient fake Git cannot turn malformed metadata into global identity", () => {
    const root = repository("[malformed");
    const bin = directory();
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    const oldPath = process.env.PATH;
    try {
      process.env.PATH = bin;
      expect(resolveScope(root).kind).toBe("invalid");
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
    }
  });

  test("nonexistent or invalid project directories are invalid", () => {
    const root = directory();
    for (const path of [join(root, "missing"), "", "\0"]) expect(resolveScope(path).kind).toBe("invalid");
  });

  test("malformed or symbolic Git markers cannot become global memory", () => {
    for (const mode of ["malformed", "symlink", "broken-symlink"]) {
      const root = directory();
      if (mode === "malformed") writeFileSync(join(root, ".git"), "not a gitdir pointer\n");
      else symlinkSync(mode === "symlink" ? directory() : join(root, "missing"), join(root, ".git"));
      expect(resolveScope(root).kind).toBe("invalid");
    }
  });

  test("invalid worktree common directories cannot become global memory", () => {
    const root = repository();
    writeFileSync(join(root, ".git", "commondir"), "../../untrusted\n");
    expect(resolveScope(root).kind).toBe("invalid");
  });

  test("malformed, missing, unreadable, and symbolic configs are invalid", () => {
    const malformed = ["[broken", "unscoped = true\n", "[core]\n\tbad = \\q\n", "[core]\n\tbad = \"unterminated\n", "\0", "x".repeat(256 * 1024 + 1)];
    for (const config of malformed) expect(resolveScope(repository(config)).kind).toBe("invalid");
    const missing = repository();
    rmSync(join(missing, ".git", "config"));
    expect(resolveScope(missing).kind).toBe("invalid");
    const unreadable = repository();
    chmodSync(join(unreadable, ".git", "config"), 0);
    expect(resolveScope(unreadable).kind).toBe("invalid");
    const symbolic = repository();
    rmSync(join(symbolic, ".git", "config"));
    symlinkSync(join(missing, ".git", "config"), join(symbolic, ".git", "config"));
    expect(resolveScope(symbolic).kind).toBe("invalid");
  });

  test("included and worktree-specific config cannot establish missing identity", () => {
    for (const config of ['[include]\n\tpath = missing\n', '[includeIf "gitdir:*"]\n\tpath = missing\n', '[extensions]\n\tworktreeConfig = true\n']) {
      expect(resolveScope(repository(config)).kind).toBe("invalid");
    }
  });

  test.each(['[include]\n\tpath = /nonexistent\n', '[extensions]\n\tworktreeConfig = true\n'])("direct canonical identity preserves compatibility with ancillary config %s", config => {
    const root = repository('[remote "origin"]\n\turl = https://github.com/owner/repo.git\n' + config);
    expect(resolveScope(root)).toEqual({ kind: "canonical", projectScope: "sm_project_v1_owner_repo", diagnostics: [] });
  });

  test("empty and noncanonical origins are invalid", () => {
    for (const config of [
      '[remote "origin"]\n',
      '[remote "origin"]\n\turl = \n',
      '[remote "origin"]\n\turl = git@gitlab.com:owner/repo.git\n',
      '[remote "origin"]\n\turl = /local/path\n',
      '[remote "origin"]\n\turl = git@unknown-alias:owner/repo.git\n',
    ]) expect(resolveScope(repository(config)).kind).toBe("invalid");
  });
});
