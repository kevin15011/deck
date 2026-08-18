import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, symlinkSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprintSupermemoryProjectScope,
  parseGitRemoteOwnerRepository,
  resolveCanonicalSupermemoryProjectScope,
} from "./canonical-supermemory-project";

describe("canonical Supermemory project scope", () => {
  function gitProject(remote: string): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-scope-"));
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: projectRoot, stdio: "ignore" });
    return projectRoot;
  }

  function sshHome(config: string): string {
    const home = mkdtempSync(join(tmpdir(), "deck-sm-ssh-home-"));
    const sshDir = join(home, ".ssh");
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(join(sshDir, "config"), config, { mode: 0o600 });
    chmodSync(join(sshDir, "config"), 0o600);
    return home;
  }

  function sshDeps(homeDir: string, overrides: Partial<Pick<Stats, "uid" | "mode" | "size">> & { noFollowFlag?: number } = {}) {
    return {
      homeDir,
      effectiveUid: () => 1001,
      openSync: (path: string, flags: number) => openSync(path, flags),
      fstatSync: (fd: number) => {
        const stat = fstatSync(fd);
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: overrides.uid ?? 1001, mode: overrides.mode ?? stat.mode, size: overrides.size ?? stat.size }) as Stats;
      },
      readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => readSync(fd, buffer, offset, length, position),
      closeSync: (fd: number) => closeSync(fd),
      ...(overrides.noFollowFlag === undefined ? {} : { noFollowFlag: overrides.noFollowFlag }),
    };
  }

  function manualProject(remote: string): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-manual-git-"));
    const gitDir = join(projectRoot, ".git");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(join(gitDir, "config"), `[remote "origin"]\n\turl = ${remote}\n`, "utf8");
    return projectRoot;
  }

  function accountDeps(passwdPath: string, fileUid: (path: string) => number = (path) => path.endsWith("passwd") ? 0 : 1001, fileMode: (path: string, mode: number) => number = (_path, mode) => mode) {
    const fdPaths = new Map<number, string>();
    return {
      passwdPath,
      effectiveUid: () => 1001,
      openSync: (path: string, flags: number) => { const fd = openSync(path, flags); fdPaths.set(fd, path); return fd; },
      fstatSync: (fd: number) => {
        const stat = fstatSync(fd);
        const path = fdPaths.get(fd) ?? "";
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: fileUid(path), mode: fileMode(path, stat.mode) }) as Stats;
      },
      readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => readSync(fd, buffer, offset, length, position),
      closeSync: (fd: number) => { fdPaths.delete(fd); closeSync(fd); },
    };
  }

  function passwdHome(config: string, passwdContent: string): { home: string; passwd: string } {
    const root = mkdtempSync(join(tmpdir(), "deck-sm-passwd-home-"));
    const home = join(root, "account-home");
    mkdirSync(join(home, ".ssh"), { recursive: true });
    writeFileSync(join(home, ".ssh", "config"), config, { mode: 0o600 });
    chmodSync(join(home, ".ssh", "config"), 0o600);
    const passwd = join(root, "passwd");
    writeFileSync(passwd, passwdContent.replaceAll("__HOME__", home), { mode: 0o600 });
    chmodSync(passwd, 0o600);
    return { home, passwd };
  }

  test("normalizes equivalent HTTPS, SSH, and SCP GitHub remotes to one v1 scope", () => {
    const remotes = [
      "https://github.com/kevin15011/deck.git",
      "git@github.com:kevin15011/deck.git",
      "ssh://git@github.com/kevin15011/deck.git",
    ];

    const scopes = remotes.map((remote) => resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [remote] }));

    expect(scopes.every((scope) => scope.ok)).toBe(true);
    expect(scopes.map((scope) => scope.ok ? scope.scope : "")).toEqual([
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
      "sm_project_v1_kevin15011_deck",
    ]);
  });

  test("URL-form canonical GitHub hosts accept only HTTPS and SSH protocols", () => {
    for (const host of ["github.com", "ssh.github.com"]) {
      expect(parseGitRemoteOwnerRepository(`https://${host}/kevin15011/deck.git`)).toEqual({ owner: "kevin15011", repository: "deck" });
      expect(parseGitRemoteOwnerRepository(`ssh://git@${host}/kevin15011/deck.git`)).toEqual({ owner: "kevin15011", repository: "deck" });

      for (const scheme of ["http", "git", "ftp", "file", "git+ssh", "rsync"]) {
        expect(parseGitRemoteOwnerRepository(`${scheme}://git@${host}/kevin15011/deck.git`)).toBeUndefined();
      }
    }
  });

  test("URL-form SSH aliases are authorized only under the ssh protocol", () => {
    const deps = sshDeps(sshHome("Host github-work\n  HostName github.com\n"));

    expect(parseGitRemoteOwnerRepository("ssh://git@github-work/kevin15011/deck.git", deps)).toEqual({ owner: "kevin15011", repository: "deck" });
    expect(parseGitRemoteOwnerRepository("git@github-work:kevin15011/deck.git", deps)).toEqual({ owner: "kevin15011", repository: "deck" });
    for (const scheme of ["https", "http", "git", "ftp", "file", "git+ssh", "rsync"]) {
      expect(parseGitRemoteOwnerRepository(`${scheme}://git@github-work/kevin15011/deck.git`, deps)).toBeUndefined();
    }
  });

  test("accepts exact trusted SSH host aliases only when user config maps them to canonical GitHub", () => {
    const githubWorkHome = sshHome("Host github-work\n  HostName github.com\n");
    const githubWorkProject = gitProject("git@github-work:comodin-software/esprit-mobileapp.git");
    const githubWork = resolveCanonicalSupermemoryProjectScope({ projectRoot: githubWorkProject, remotes: [], sshConfig: sshDeps(githubWorkHome) });

    expect(githubWork).toMatchObject({ ok: true, scope: "sm_project_v1_comodin_software_esprit_mobileapp" });
    expect(JSON.stringify(githubWork)).not.toContain("github-work");

    const githubPHome = sshHome("Host github-p\n  HostName github.com\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-p:kevin15011/deck.git"), remotes: [], sshConfig: sshDeps(githubPHome) }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_kevin15011_deck" });
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-p:kevin15011/deck.git"), remotes: [], sshConfig: sshDeps(sshHome("Host other\n  HostName github.com\n")) }).ok).toBe(false);
  });

  test("accepts comments, case-insensitive directives, and benign live-shape multi-alias exact Host blocks", () => {
    const home = sshHome("# work alias\nHOST=github-work github-backup # inline comment\n  hostname = GitHub.COM\n  User git\n  IdentityFile ~/.ssh/work_key\n  IdentitiesOnly yes\n  Port=22\n");
    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-work:comodin-software/esprit-mobileapp.git"), remotes: [], sshConfig: sshDeps(home) });

    expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_comodin_software_esprit_mobileapp" });
    expect(JSON.stringify(result)).not.toContain("github-work");
  });

  test("SSH aliases authorize only SCP-style and ssh URL remotes, not HTTPS or arbitrary URL schemes", () => {
    const home = sshHome("Host github-work\n  HostName github.com\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("ssh://git@github-work/comodin-software/esprit-mobileapp.git"), remotes: [], sshConfig: sshDeps(home) }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_comodin_software_esprit_mobileapp" });
    for (const remote of ["https://github-work/comodin-software/esprit-mobileapp.git", "git://github-work/comodin-software/esprit-mobileapp.git"]) {
      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: sshDeps(home) });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("github-work");
    }
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("https://github.com/comodin-software/esprit-mobileapp.git"), remotes: [] }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_comodin_software_esprit_mobileapp" });
  });

  test("fails closed for unsafe, ambiguous, unsupported, or non-canonical SSH alias configuration", () => {
    const cases = [
      ["missing alias", "Host other\n  HostName github.com\n"],
      ["evil hostname", "Host github-work\n  HostName evil.example\n"],
      ["first hostname evil", "Host=github-work\n  HostName=evil.example\n  HostName github.com\n"],
      ["suffix trick", "Host github-work\n  HostName github.com.evil\n"],
      ["subdomain trick", "Host github-work\n  HostName evil.github.com\n"],
      ["wildcard host", "Host github-work *\n  HostName github.com\n"],
      ["prior wildcard", "Host *\n  HostName evil.example\nHost github-work\n  HostName github.com\n"],
      ["prior wildcard github", "Host *\n  HostName github.com\nHost github-work\n  HostName github.com\n"],
      ["later wildcard", "Host github-work\n  HostName github.com\nHost *\n  HostName evil.example\n"],
      ["global hostname", "HostName evil.example\nHost github-work\n  HostName github.com\n"],
      ["mixed separators", "Host github-work = other\n  HostName github.com\n"],
      ["negated host", "Host github-work !evil\n  HostName github.com\n"],
      ["negated unrelated host", "Host !github-work other\n  HostName github.com\nHost github-work\n  HostName github.com\n"],
      ["conflicting exact same hostname", "Host github-work\n  HostName github.com\nHost github-work\n  HostName github.com\n"],
      ["conflicting exact blocks", "Host github-work\n  HostName github.com\nHost github-work\n  HostName ssh.github.com\n"],
      ["match", "Match all\nHost github-work\n  HostName github.com\n"],
      ["percent expansion", "Host github-work\n  HostName %h\n"],
      ["malformed hostname", "Host github-work\n  HostName\n"],
      ["control byte", "Host github-work\n  HostName github.com\x01\n"],
      ["proxy command space", "Host github-work\n  HostName github.com\n  ProxyCommand sh -c whoami\n"],
      ["proxy command equals", "Host github-work\n  HostName github.com\n  ProxyCommand=sh -c whoami\n"],
      ["unknown directive space", "Host github-work\n  HostName github.com\n  UnknownDirective value\n"],
      ["unknown directive equals", "Host github-work\n  HostName github.com\n  UnknownDirective=value\n"],
      ["proxy jump", "Host github-work\n  HostName github.com\n  ProxyJump bastion\n"],
      ["host key alias", "Host github-work\n  HostName github.com\n  HostKeyAlias github.com\n"],
      ["canonicalize hostname", "Host github-work\n  HostName github.com\n  CanonicalizeHostname yes\n"],
      ["global include", "Include ~/.ssh/common.conf\nHost github-work\n  HostName github.com\n"],
      ["later include", "Host github-work\n  HostName github.com\nInclude ~/.ssh/common.conf\n"],
      ["include only", "Include ~/.ssh/github-work.conf\n"],
    ];
    for (const [, config] of cases) {
      const home = sshHome(config);
      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-work:comodin-software/esprit-mobileapp.git"), remotes: [], sshConfig: sshDeps(home) });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("github-work");
      expect(JSON.stringify(result)).not.toContain("comodin");
    }

    const oversizedLineHome = sshHome(`Host github-work\n  HostName ${"a".repeat(1100)}\n`);
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-work:comodin-software/esprit-mobileapp.git"), remotes: [], sshConfig: sshDeps(oversizedLineHome) }).ok).toBe(false);
    const oversizedHome = sshHome(`Host filler\n  HostName example.com\n${"#".repeat(70 * 1024)}\nHost github-work\n  HostName github.com\n`);
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-work:comodin-software/esprit-mobileapp.git"), remotes: [], sshConfig: sshDeps(oversizedHome, { size: 70 * 1024 }) }).ok).toBe(false);
  });

  test("fails closed for symlink, foreign-owned, or group-writable SSH config", () => {
    const remote = "git@github-work:comodin-software/esprit-mobileapp.git";
    const symlinkHome = mkdtempSync(join(tmpdir(), "deck-sm-ssh-symlink-"));
    mkdirSync(join(symlinkHome, ".ssh"), { recursive: true });
    writeFileSync(join(symlinkHome, "real-config"), "Host github-work\n  HostName github.com\n", { mode: 0o600 });
    symlinkSync(join(symlinkHome, "real-config"), join(symlinkHome, ".ssh", "config"));
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: sshDeps(symlinkHome) }).ok).toBe(false);

    const foreignHome = sshHome("Host github-work\n  HostName github.com\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: sshDeps(foreignHome, { uid: 2002 }) }).ok).toBe(false);
    const groupWritableHome = sshHome("Host github-work\n  HostName github.com\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: sshDeps(groupWritableHome, { mode: 0o620 }) }).ok).toBe(false);
    const noNoFollowHome = sshHome("Host github-work\n  HostName github.com\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: { ...sshDeps(noNoFollowHome), noFollowFlag: undefined } as never }).ok).toBe(false);
  });

  test("reads SSH config from the validated descriptor and ignores path replacement before read", () => {
    const home = sshHome("Host github-work\n  HostName evil.example\n");
    const configPath = join(home, ".ssh", "config");
    const fd = openSync(configPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    const deps = {
      homeDir: home,
      effectiveUid: () => Number(stat.uid),
      openSync: () => {
        rmSync(configPath, { force: true });
        writeFileSync(configPath, "Host github-work\n  HostName github.com\n", { mode: 0o600 });
        return fd;
      },
      fstatSync: (opened: number) => fstatSync(opened),
      readSync: (opened: number, buffer: Buffer, offset: number, length: number, position: number | null) => readSync(opened, buffer, offset, length, position),
      closeSync: (opened: number) => closeSync(opened),
    };

    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject("git@github-work:comodin-software/esprit-mobileapp.git"), remotes: [], sshConfig: deps });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("github-work");
    expect(JSON.stringify(result)).not.toContain("comodin");
  });

  test("production-style account passwd lookup authorizes only trusted account home and rejects malformed passwd state", () => {
    const remote = "git@github-work:comodin-software/esprit-mobileapp.git";
    const trusted = passwdHome("Host github-work\n  HostName github.com\n", "root:x:0:0:root:/root:/bin/sh\ndeck:x:1001:1001:Deck:__HOME__:/bin/sh\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: accountDeps(trusted.passwd) }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_comodin_software_esprit_mobileapp" });

    const spacedGecos = passwdHome("Host github-work\n  HostName github.com\n", [
      "root:x:0:0:System Administrator:/root:/bin/sh",
      "daemon:x:1:1:System Services Account:/usr/sbin:/usr/sbin/nologin",
      "www-data:x:33:33:Web Server User:/var/www:/usr/sbin/nologin",
      "messagebus:x:100:102:D-Bus Message Bus:/nonexistent:/usr/sbin/nologin",
      "deck:x:1001:1001:Deck Agent User:__HOME__:/bin/sh",
      "",
    ].join("\n"));
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: accountDeps(spacedGecos.passwd) }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_comodin_software_esprit_mobileapp" });

    for (const passwdContent of [
      "deck:x:1001:1001:Deck:relative-home:/bin/sh\n",
      "deck:x:1001:1001:Deck:__HOME__:/bin/sh\ndupe:x:1001:1001:Dupe:__HOME__:/bin/sh\n",
      "malformed-passwd-line\n",
      "deck:x:1001:1001:Deck:__HOME__:/bin/sh:extra\n",
      "de ck:x:1001:1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:abc:1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:+1001:1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:1001 :1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:01001:1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:9007199254740993:1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:1001:abc:Deck:__HOME__:/bin/sh\n",
      "deck:x:1001:+1001:Deck:__HOME__:/bin/sh\n",
      "deck:x:1001:1001 :Deck:__HOME__:/bin/sh\n",
      "deck:x:1001:01001:Deck:__HOME__:/bin/sh\n",
      "deck:x:1001:9007199254740993:Deck:__HOME__:/bin/sh\n",
      "deck:x:1001:1001:Deck:__HOME__ /nested:/bin/sh\n",
      "deck:x:1001:1001:Deck: __HOME__:/bin/sh\n",
    ]) {
      const fixture = passwdHome("Host github-work\n  HostName github.com\n", passwdContent);
      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: accountDeps(fixture.passwd) });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("github-work");
    }

    const unsafePasswd = passwdHome("Host github-work\n  HostName github.com\n", "deck:x:1001:1001:Deck:__HOME__:/bin/sh\n");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: accountDeps(unsafePasswd.passwd, () => 1001) }).ok).toBe(false);
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: gitProject(remote), remotes: [], sshConfig: accountDeps(unsafePasswd.passwd, (path) => path.endsWith("passwd") ? 0 : 1001, (path, mode) => path.endsWith("passwd") ? (mode | 0o020) : mode) }).ok).toBe(false);
  });

  test("ambient HOME, including before a fresh Bun module load, cannot authorize SSH aliases", () => {
    const hostileHome = sshHome("Host hostile-home-alias\n  HostName github.com\n");
    const projectRoot = manualProject("git@hostile-home-alias:comodin-software/esprit-mobileapp.git");
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = hostileHome;
      expect(resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] }).ok).toBe(false);
      const probe = Bun.spawnSync({
        cmd: [process.execPath, "-e", "import { resolveCanonicalSupermemoryProjectScope } from './packages/core/src/memory/canonical-supermemory-project'; const r = resolveCanonicalSupermemoryProjectScope({ projectRoot: process.argv[1], remotes: [] }); console.log(String(r.ok));", projectRoot],
        cwd: join(import.meta.dir, "../../../.."),
        env: { ...process.env, HOME: hostileHome },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(probe.exitCode).toBe(0);
      expect(new TextDecoder().decode(probe.stdout).trim()).toBe("false");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
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

  test("resolves structural separate git-dir files and rejects malformed linked git metadata", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-separate-worktree-"));
    const gitDir = mkdtempSync(join(tmpdir(), "deck-sm-separate-gitdir-"));
    writeFileSync(join(projectRoot, ".git"), `gitdir: ${gitDir}\n`, "utf8");
    writeFileSync(join(gitDir, "config"), `[remote "origin"]\n\turl = https://github.com/acme/separate.git\n`, "utf8");

    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_acme_separate" });

    const malformed = mkdtempSync(join(tmpdir(), "deck-sm-bad-gitfile-"));
    writeFileSync(join(malformed, ".git"), "not-a-gitdir-file\n", "utf8");
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: malformed, remotes: [] }).ok).toBe(false);
  });

  test("accepts only linked-worktree commondir strict ancestors and rejects arbitrary commondir escapes", () => {
    const makeLinked = (commonDirValue: string) => {
      const root = mkdtempSync(join(tmpdir(), "deck-sm-commondir-"));
      const workTree = join(root, "worktree");
      const common = join(root, "main.git");
      const gitDir = join(common, "worktrees", "feature");
      mkdirSync(workTree, { recursive: true });
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(workTree, ".git"), `gitdir: ${gitDir}\n`, "utf8");
      writeFileSync(join(gitDir, "commondir"), `${commonDirValue}\n`, "utf8");
      writeFileSync(join(common, "config"), `[remote "origin"]\n\turl = https://github.com/acme/linked.git\n`, "utf8");
      return { root, workTree, common, gitDir };
    };
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: makeLinked("../..").workTree, remotes: [] }))
      .toMatchObject({ ok: true, scope: "sm_project_v1_acme_linked" });
    for (const commonDirValue of ["/tmp", "..", ".", "child", "../../sibling", "..\x01/..", ""]) {
      const fixture = makeLinked(commonDirValue);
      mkdirSync(join(fixture.gitDir, "child"), { recursive: true });
      mkdirSync(join(fixture.root, "sibling"), { recursive: true });
      expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: fixture.workTree, remotes: [] }).ok).toBe(false);
    }
    const symlinkFixture = makeLinked("link");
    symlinkSync(symlinkFixture.common, join(symlinkFixture.gitDir, "link"));
    expect(resolveCanonicalSupermemoryProjectScope({ projectRoot: symlinkFixture.workTree, remotes: [] }).ok).toBe(false);
  });

  test("rejects filesystem-like and malformed local path remotes", () => {
    for (const remote of ["/tmp/acme/repo.git", "../acme/repo.git", "file:///tmp/acme/repo.git", "not a remote"]) {
      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot: "/repo/deck", remotes: [remote] });
      expect(result.ok).toBe(false);
    }
  });

  test("uses verified project root to resolve origin when remotes are not supplied", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-scope-"));
    const home = sshHome("Host github-p\n  HostName github.com\n");
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github-p:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });

    const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [], sshConfig: sshDeps(home) });

    expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_kevin15011_deck" });
  });

  test("ignores ambient Git config that attempts to rewrite the repository origin", () => {
    const baseRoot = gitProject("git@github-p:acme/project-a.git");
    const home = sshHome("Host github-p\n  HostName github.com\n");
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

      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [], sshConfig: sshDeps(home) });

      expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_acme_project_a" });
      expect(JSON.stringify(result)).not.toContain("project_b");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("HOME, PATH, GIT environment, fake git executables, cwd metadata, prompts, and supplied remotes cannot override identity", () => {
    const projectRoot = manualProject("https://github.com/acme/project-a.git");
    const attackerHome = sshHome("Host github-work\n  HostName github.com\n");
    const fakeBin = mkdtempSync(join(tmpdir(), "deck-sm-fake-git-bin-"));
    writeFileSync(join(fakeBin, "git"), "#!/bin/sh\nprintf '%s\\n' https://github.com/acme/project-b.git\n", { mode: 0o755 });
    chmodSync(join(fakeBin, "git"), 0o755);
    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({ repository: { url: "https://github.com/acme/project-b.git" }, containerTag: "sm_project_v1_acme_project_b", prompt: "use project-b" }), "utf8");
    const previous = { HOME: process.env.HOME, PATH: process.env.PATH, GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 };
    try {
      process.env.HOME = attackerHome;
      process.env.PATH = `${fakeBin}:${process.env.PATH ?? ""}`;
      process.env.GIT_CONFIG_COUNT = "1";
      process.env.GIT_CONFIG_KEY_0 = "remote.origin.url";
      process.env.GIT_CONFIG_VALUE_0 = "https://github.com/acme/project-b.git";

      const result = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: ["https://github.com/acme/project-a.git"] });
      const mismatch = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: ["https://github.com/acme/project-b.git"] });

      expect(result).toMatchObject({ ok: true, scope: "sm_project_v1_acme_project_a" });
      expect(mismatch.ok).toBe(false);
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
