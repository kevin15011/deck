/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { ROOT } from "./build-binaries";
import { installCanary, parseCanaryInstallArgs } from "./install-canary";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), name));
  roots.push(root);
  return root;
}

function logger() {
  const lines: string[] = [];
  return {
    lines,
    stdout: { log: (value: unknown) => lines.push(String(value)), warn: (value: unknown) => lines.push(String(value)) },
    stderr: { error: (value: unknown) => lines.push(String(value)) },
  };
}

function successSpawn() {
  return { success: true, stdout: Buffer.from("deck 0.0.0-test"), stderr: Buffer.from("") } as never;
}

function failingSpawn() {
  return { success: false, stdout: Buffer.from(""), stderr: Buffer.from("bad binary") } as never;
}

function failOnSmokeCall(failAt: number, onFail?: () => void) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === failAt) {
      onFail?.();
      return failingSpawn();
    }
    return successSpawn();
  };
}

function fakeBuild(compiledBytes = "compiled canary") {
  let count = 0;
  return {
    get count() { return count; },
    buildCanaryBinary: async ({ outputDir }: { outputDir: string }) => {
      count += 1;
      mkdirSync(outputDir, { recursive: true });
      const output = join(outputDir, "deck-canary-built");
      writeFileSync(output, compiledBytes, { mode: 0o755 });
      return output;
    },
  };
}

function fsWithStatOverrides(overrides: Record<string, { mode?: number; uid?: number; gid?: number }>) {
  const realFs = require("node:fs");
  return {
    ...realFs,
    lstatSync: (target: string) => {
      const stat = realFs.lstatSync(target);
      const override = overrides[target];
      if (!override) return stat;
      return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
        mode: override.mode === undefined ? stat.mode : (stat.mode & ~0o777) | override.mode,
        uid: override.uid ?? stat.uid,
        gid: override.gid ?? stat.gid,
      });
    },
  };
}

describe("install-canary argument planning", () => {
  test("uses DECK_CANARY_BIN_DIR, then ~/.local/bin, and supports home-relative --dir", () => {
    const home = tempRoot("deck-canary-home-");
    expect(parseCanaryInstallArgs([], { env: { DECK_CANARY_BIN_DIR: join(home, "env-bin") }, homeDir: home }).targetPath)
      .toBe(join(home, "env-bin", "deck-canary"));
    expect(parseCanaryInstallArgs([], { env: {}, homeDir: home }).targetPath)
      .toBe(join(home, ".local", "bin", "deck-canary"));
    expect(parseCanaryInstallArgs(["--dir", "~/canary-bin"], { env: {}, homeDir: home }).targetPath)
      .toBe(join(home, "canary-bin", "deck-canary"));
  });

  test("rejects missing, NUL, relative, ambiguous, and unknown arguments", () => {
    const home = tempRoot("deck-canary-args-");
    expect(() => parseCanaryInstallArgs(["--dir"], { homeDir: home })).toThrow("--dir requires");
    expect(() => parseCanaryInstallArgs(["--dir", `/${"bad\0dir"}`], { homeDir: home })).toThrow("NUL");
    expect(() => parseCanaryInstallArgs(["--dir", "relative/bin"], { homeDir: home })).toThrow("absolute");
    expect(() => parseCanaryInstallArgs(["--dir", "/tmp/../bin"], { homeDir: home })).toThrow("path segments");
    expect(() => parseCanaryInstallArgs(["--deck"], { homeDir: home })).toThrow("Unknown flag");
    expect(() => parseCanaryInstallArgs(["deck"], { homeDir: home })).toThrow("Unexpected positional");
  });
});

describe("install-canary hermetic install effects", () => {
  test("dry-run plans without compiling or writing", async () => {
    const home = tempRoot("deck-canary-dry-");
    const log = logger();
    const build = fakeBuild();
    const code = await installCanary(["--dry-run"], {
      env: {},
      homeDir: home,
      stdout: log.stdout,
      stderr: log.stderr,
      buildCanaryBinary: build.buildCanaryBinary as never,
    });

    expect(code).toBe(0);
    expect(build.count).toBe(0);
    expect(existsSync(join(home, ".local"))).toBe(false);
    expect(log.lines.join("\n")).toContain("Dry run");
  });

  test("help and dry-run do not compile or run generators", async () => {
    const home = tempRoot("deck-canary-help-");
    const build = fakeBuild();
    const log = logger();

    expect(await installCanary(["--help"], { homeDir: home, stdout: log.stdout, stderr: log.stderr, buildCanaryBinary: build.buildCanaryBinary as never })).toBe(0);
    expect(await installCanary(["--dry-run"], { homeDir: home, stdout: log.stdout, stderr: log.stderr, buildCanaryBinary: build.buildCanaryBinary as never })).toBe(0);
    expect(build.count).toBe(0);
    expect(existsSync(join(home, ".local"))).toBe(false);
  });

  test("installs deck-canary atomically and preserves stable deck byte-for-byte", async () => {
    const root = tempRoot("deck-canary-install-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    writeFileSync(join(bin, "deck"), "stable-deck-sentinel", { mode: 0o755 });
    const log = logger();
    const build = fakeBuild("new-canary");

    const code = await installCanary(["--dir", bin], {
      env: { PATH: "" },
      homeDir: root,
      stdout: log.stdout,
      stderr: log.stderr,
      spawnSync: successSpawn,
      buildCanaryBinary: build.buildCanaryBinary as never,
      tempDir: () => join(root, "build"),
    });

    expect(code).toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe("stable-deck-sentinel");
    expect(lstatSync(join(bin, "deck-canary")).isSymbolicLink()).toBe(true);
    const payloadName = readlinkSync(join(bin, "deck-canary"));
    expect(payloadName).toMatch(/^\.deck-canary\.payload-[a-f0-9]{64}$/);
    expect(readFileSync(join(bin, payloadName), "utf-8")).toBe("new-canary");
    expect(lstatSync(join(bin, payloadName)).mode & 0o111).not.toBe(0);
    expect(log.lines.join("\n")).toContain("deck-canary opencode developer");
    expect(log.lines.join("\n")).toContain(`absolute command: ${join(bin, "deck-canary")}`);
  });

  test("refuses symlink, directory, and file-target install directories", async () => {
    const root = tempRoot("deck-canary-reject-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    symlinkSync(join(root, "elsewhere"), join(bin, "deck-canary"));
    const build = fakeBuild();
    const log = logger();
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, buildCanaryBinary: build.buildCanaryBinary as never, spawnSync: successSpawn, tempDir: () => join(root, "build") })).toBe(1);
    rmSync(join(bin, "deck-canary"), { force: true });
    mkdirSync(join(bin, "deck-canary"));
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, buildCanaryBinary: build.buildCanaryBinary as never, spawnSync: successSpawn, tempDir: () => join(root, "build2") })).toBe(1);
    writeFileSync(join(root, "not-a-dir"), "file");
    expect(await installCanary(["--dir", join(root, "not-a-dir")], { homeDir: root, stdout: log.stdout, stderr: log.stderr, buildCanaryBinary: build.buildCanaryBinary as never, spawnSync: successSpawn, tempDir: () => join(root, "build3") })).toBe(1);
  });

  test("staged smoke failure preserves existing alias and does not touch profiles or config", async () => {
    const root = tempRoot("deck-canary-rollback-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    const previousPayload = ".deck-canary.payload-" + "b".repeat(64);
    writeFileSync(join(bin, previousPayload), "previous-canary", { mode: 0o755 });
    symlinkSync(previousPayload, join(bin, "deck-canary"));
    writeFileSync(join(root, ".bashrc"), "profile-sentinel");
    mkdirSync(join(root, ".config"), { recursive: true });
    writeFileSync(join(root, ".config", "deck.json"), "config-sentinel");
    const build = fakeBuild("bad-canary");
    const log = logger();

    const code = await installCanary(["--dir", bin], {
      env: { PATH: "" },
      homeDir: root,
      stdout: log.stdout,
      stderr: log.stderr,
      spawnSync: failOnSmokeCall(1),
      buildCanaryBinary: build.buildCanaryBinary as never,
      tempDir: () => join(root, "build"),
    });

    expect(code).toBe(1);
    expect(readlinkSync(join(bin, "deck-canary"))).toBe(previousPayload);
    expect(readFileSync(join(bin, previousPayload), "utf-8")).toBe("previous-canary");
    expect(readFileSync(join(root, ".bashrc"), "utf-8")).toBe("profile-sentinel");
    expect(readFileSync(join(root, ".config", "deck.json"), "utf-8")).toBe("config-sentinel");
    expect(log.lines.join("\n")).not.toContain("export PATH");
  });

  test("build failure and staging/chmod/rename failures clean owned temp and transaction artifacts", async () => {
    const root = tempRoot("deck-canary-cleanup-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    let ownedBuildDir = "";
    const log = logger();
    const code = await installCanary(["--dir", bin], {
      homeDir: root,
      stdout: log.stdout,
      stderr: log.stderr,
      buildCanaryBinary: async ({ outputDir }) => { ownedBuildDir = outputDir; mkdirSync(outputDir, { recursive: true }); writeFileSync(join(outputDir, "partial"), "partial"); throw new Error("build exploded"); },
    });
    expect(code).toBe(1);
    expect(ownedBuildDir).not.toBe("");
    expect(existsSync(ownedBuildDir)).toBe(false);

    for (const [label, method] of [["stage", "openSync"], ["chmod", "chmodSync"], ["rename", "renameSync"]] as const) {
      const caseBin = join(root, `bin-${label}`);
      mkdirSync(caseBin, { recursive: true });
      chmodSync(caseBin, 0o755);
      const build = fakeBuild("candidate");
      const failingFs = {
        ...require("node:fs"),
        [method]: (...args: unknown[]) => {
          const first = String(args[0]);
          if (first.includes(".deck-canary.txn-") || first.includes(".deck-canary.payload-") || first.endsWith("deck-canary")) throw new Error(`${label} failed`);
          return (require("node:fs") as any)[method](...args);
        },
      };
      expect(await installCanary(["--dir", caseBin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, fs: failingFs as never, tempDir: () => join(root, `build-${label}`) })).toBe(1);
      expect(readdirSync(caseBin).filter((entry) => entry.includes(".txn-") || entry.includes(".lock") || entry.includes(".alias-"))).toEqual([]);
    }
  });

  test("lock contention fails closed and owned stale transaction directories are cleaned on next locked run", async () => {
    const root = tempRoot("deck-canary-lock-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    mkdirSync(join(bin, ".deck-canary.lock"));
    const log = logger();
    const build = fakeBuild("candidate");
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-lock") })).toBe(1);
    expect(log.lines.join("\n")).toContain("lock metadata");
    rmSync(join(bin, ".deck-canary.lock"), { recursive: true, force: true });
    mkdirSync(join(bin, ".deck-canary.txn-stale"));
    writeFileSync(join(bin, ".deck-canary.txn-stale", "deck-canary.previous"), "old-backup");
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-after-lock") })).toBe(0);
    expect(existsSync(join(bin, ".deck-canary.txn-stale"))).toBe(false);
    expect(readFileSync(join(bin, "deck-canary"), "utf-8")).toBe("candidate");
  });

  test("stale dead locks recover, live and indeterminate locks fail closed, and owner token guards release", async () => {
    const root = tempRoot("deck-canary-lock-states-");
    const makeCase = (name: string) => { const bin = join(root, name); mkdirSync(bin, { recursive: true }); chmodSync(bin, 0o755); mkdirSync(join(bin, ".deck-canary.lock"), { mode: 0o700 }); writeFileSync(join(bin, ".deck-canary.lock", "owner.json"), JSON.stringify({ pid: 12345, createdAt: 1, ownerToken: "old" }), { mode: 0o600 }); return bin; };
    const log = logger();
    const build = fakeBuild("candidate");
    const deadBin = makeCase("dead");
    expect(await installCanary(["--dir", deadBin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, pidAlive: () => "dead", buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-dead") })).toBe(0);
    expect(existsSync(join(deadBin, ".deck-canary.lock"))).toBe(false);
    const liveBin = makeCase("live");
    expect(await installCanary(["--dir", liveBin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, pidAlive: () => "alive", buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-live") })).toBe(1);
    const unsureBin = makeCase("unsure");
    expect(await installCanary(["--dir", unsureBin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, pidAlive: () => "indeterminate", buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-unsure") })).toBe(1);
    const tokenBin = join(root, "token"); mkdirSync(tokenBin, { recursive: true }); chmodSync(tokenBin, 0o755);
    expect(await installCanary(["--dir", tokenBin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, randomToken: () => "owner-token", buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-token"), hooks: { afterAliasCommit: () => writeFileSync(join(tokenBin, ".deck-canary.lock", "owner.json"), JSON.stringify({ pid: 1, createdAt: 1, ownerToken: "other" })) } })).toBe(0);
    expect(existsSync(join(tokenBin, ".deck-canary.lock"))).toBe(true);
  });

  test("unsafe destination ownership, modes, and symlink ancestors are rejected", async () => {
    const root = tempRoot("deck-canary-unsafe-dir-");
    const log = logger();
    const build = fakeBuild("candidate");
    const world = join(root, "world"); mkdirSync(world, { recursive: true }); chmodSync(world, 0o777);
    expect(await installCanary(["--dir", world], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-world") })).toBe(1);
    const real = join(root, "real"); mkdirSync(real, { recursive: true }); chmodSync(real, 0o755); symlinkSync(real, join(root, "link"));
    expect(await installCanary(["--dir", join(root, "link", "bin")], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build-link") })).toBe(1);
  });

  test("trusted primary-group 0775 default path succeeds, while 0777, foreign-group, and custom 0775 fail closed", async () => {
    const root = tempRoot("deck-canary-group-write-");
    const trustedHome = join(root, "trusted-home");
    const trustedBin = join(trustedHome, ".local", "bin");
    mkdirSync(trustedBin, { recursive: true });
    chmodSync(trustedBin, 0o775);
    const log = logger();
    const trustedFs = fsWithStatOverrides({ [trustedBin]: { mode: 0o775, uid: 1001, gid: 1001 } });

    expect(await installCanary([], { env: {}, homeDir: trustedHome, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, effectiveUid: () => 1001, effectiveGid: () => 1001, fs: trustedFs as never, buildCanaryBinary: fakeBuild("trusted").buildCanaryBinary as never, tempDir: () => join(root, "build-trusted") })).toBe(0);
    expect(log.lines.join("\n")).toContain("user-owned and primary-group-owned");
    expect(readFileSync(join(trustedBin, readlinkSync(join(trustedBin, "deck-canary"))), "utf-8")).toBe("trusted");

    const worldHome = join(root, "world-home");
    const worldBin = join(worldHome, ".local", "bin");
    mkdirSync(worldBin, { recursive: true });
    chmodSync(worldBin, 0o777);
    expect(await installCanary([], { env: {}, homeDir: worldHome, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, effectiveUid: () => 1001, effectiveGid: () => 1001, fs: fsWithStatOverrides({ [worldBin]: { mode: 0o777, uid: 1001, gid: 1001 } }) as never, buildCanaryBinary: fakeBuild("world").buildCanaryBinary as never, tempDir: () => join(root, "build-world-default") })).toBe(1);

    const foreignHome = join(root, "foreign-home");
    const foreignBin = join(foreignHome, ".local", "bin");
    mkdirSync(foreignBin, { recursive: true });
    chmodSync(foreignBin, 0o775);
    expect(await installCanary([], { env: {}, homeDir: foreignHome, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, effectiveUid: () => 1001, effectiveGid: () => 1001, fs: fsWithStatOverrides({ [foreignBin]: { mode: 0o775, uid: 1001, gid: 27 } }) as never, buildCanaryBinary: fakeBuild("foreign").buildCanaryBinary as never, tempDir: () => join(root, "build-foreign") })).toBe(1);

    const customBin = join(root, "custom-bin");
    mkdirSync(customBin, { recursive: true });
    chmodSync(customBin, 0o775);
    expect(await installCanary(["--dir", customBin], { env: {}, homeDir: trustedHome, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, effectiveUid: () => 1001, effectiveGid: () => 1001, fs: fsWithStatOverrides({ [customBin]: { mode: 0o775, uid: 1001, gid: 1001 } }) as never, buildCanaryBinary: fakeBuild("custom").buildCanaryBinary as never, tempDir: () => join(root, "build-custom") })).toBe(1);
  });

  test("immutable payload reuse succeeds and digest-name mismatch fails closed", async () => {
    const root = tempRoot("deck-canary-payload-reuse-");
    const bin = join(root, "bin"); mkdirSync(bin, { recursive: true }); chmodSync(bin, 0o755);
    const log = logger();
    const build = fakeBuild("same-candidate");
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build1") })).toBe(0);
    const firstPayload = readlinkSync(join(bin, "deck-canary"));
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build2") })).toBe(0);
    expect(readlinkSync(join(bin, "deck-canary"))).toBe(firstPayload);
    const digest = createHash("sha256").update("different").digest("hex");
    const badPayload = `.deck-canary.payload-${digest}`;
    writeFileSync(join(bin, badPayload), "wrong", { mode: 0o755 });
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: fakeBuild("different").buildCanaryBinary as never, tempDir: () => join(root, "build3") })).toBe(1);
  });

  test("symlink staging collision and non-ENOENT lstat errors fail closed", async () => {
    const root = tempRoot("deck-canary-safe-path-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    const digest = createHash("sha256").update("candidate").digest("hex");
    symlinkSync(root, join(bin, `.deck-canary.payload-${digest}`));
    const log = logger();
    const build = fakeBuild("candidate");
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build") })).toBe(1);
    rmSync(join(bin, `.deck-canary.payload-${digest}`), { force: true });

    const eacces = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const failingFs = { ...require("node:fs"), lstatSync: (target: string) => target.endsWith("deck-canary") ? (() => { throw eacces; })() : lstatSync(target) };
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, fs: failingFs as never, tempDir: () => join(root, "build2") })).toBe(1);
  });

  test("alias verification preserves concurrent winners after activated smoke failure", async () => {
    const root = tempRoot("deck-canary-conflict-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    const winnerPayload = ".deck-canary.payload-" + "c".repeat(64);
    const log = logger();
    const build = fakeBuild("candidate");
    const code = await installCanary(["--dir", bin], {
      homeDir: root,
      stdout: log.stdout,
      stderr: log.stderr,
      spawnSync: failOnSmokeCall(2),
      buildCanaryBinary: build.buildCanaryBinary as never,
      tempDir: () => join(root, "build"),
      hooks: { afterAliasCommit: ({ targetPath }) => { rmSync(targetPath, { force: true }); writeFileSync(join(bin, winnerPayload), "concurrent-winner", { mode: 0o755 }); symlinkSync(winnerPayload, targetPath); } },
    });

    expect(code).toBe(1);
    expect(readlinkSync(join(bin, "deck-canary"))).toBe(winnerPayload);
    expect(readFileSync(join(bin, winnerPayload), "utf-8")).toBe("concurrent-winner");
    expect(log.lines.join("\n")).toContain("alias changed");
  });

  test("no-previous external alias change is preserved", async () => {
    const root = tempRoot("deck-canary-no-prev-conflict-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    const log = logger();
    const build = fakeBuild("candidate");
    const code = await installCanary(["--dir", bin], {
      homeDir: root,
      stdout: log.stdout,
      stderr: log.stderr,
      spawnSync: failOnSmokeCall(2),
      buildCanaryBinary: build.buildCanaryBinary as never,
      tempDir: () => join(root, "build"),
      hooks: { afterAliasCommit: ({ targetPath }) => { rmSync(targetPath, { force: true }); const winnerPayload = ".deck-canary.payload-" + "d".repeat(64); writeFileSync(join(bin, winnerPayload), "concurrent-new-canary", { mode: 0o755 }); symlinkSync(winnerPayload, targetPath); } },
    });

    expect(code).toBe(1);
    const winner = readlinkSync(join(bin, "deck-canary"));
    expect(readFileSync(join(bin, winner), "utf-8")).toBe("concurrent-new-canary");
  });

  test("interruption hooks before commit clean transaction artifacts and leave live target unchanged", async () => {
    const root = tempRoot("deck-canary-interruption-");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    chmodSync(bin, 0o755);
    const previousPayload = ".deck-canary.payload-" + "e".repeat(64);
    writeFileSync(join(bin, previousPayload), "previous-canary", { mode: 0o755 });
    symlinkSync(previousPayload, join(bin, "deck-canary"));
    const log = logger();
    const build = fakeBuild("candidate");
    expect(await installCanary(["--dir", bin], { homeDir: root, stdout: log.stdout, stderr: log.stderr, spawnSync: successSpawn, buildCanaryBinary: build.buildCanaryBinary as never, tempDir: () => join(root, "build"), hooks: { afterStagedSmoke: () => { throw new Error("stop after staged smoke"); } } })).toBe(1);
    expect(readlinkSync(join(bin, "deck-canary"))).toBe(previousPayload);
    expect(readdirSync(bin).filter((entry) => entry.includes(".txn-") || entry.includes(".lock"))).toEqual([]);
  });
});

test.skipIf(process.env.DECK_CANARY_COMPILE_SMOKE !== "1")("real temp-directory canary compile/install smoke", () => {
  const root = tempRoot("deck-canary-real-");
  const bin = join(root, "bin");
  const temp = join(root, "tmp");
  const generatedFiles = [
    join(ROOT, "packages/core/src/skills/external/content.generated.ts"),
    join(ROOT, "apps/cli/src/runtime/build-info.generated.ts"),
    join(ROOT, "packages/adapter-opencode/assets/opencode/developer-team.generated.js"),
    join(ROOT, "packages/adapter-pi/assets/pi/developer-team.generated.js"),
  ].filter(existsSync);
  const before = generatedFiles.map((file) => ({ file, content: readFileSync(file), mtimeMs: statSync(file).mtimeMs }));
  mkdirSync(bin, { recursive: true });
  chmodSync(bin, 0o755);
  mkdirSync(temp, { recursive: true });
  const result = spawnSync("bun", ["run", "canary:install", "--", "--dir", bin], {
    cwd: ROOT,
    env: { ...process.env, HOME: root, TMPDIR: temp, PATH: process.env.PATH ?? "" },
    encoding: "utf-8",
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(bin, "deck-canary"))).toBe(true);
  expect(result.stdout).toContain("Installed deck-canary");
  for (const entry of before) {
    expect(readFileSync(entry.file).equals(entry.content)).toBe(true);
    expect(statSync(entry.file).mtimeMs).toBe(entry.mtimeMs);
  }
  expect(readdirSync(bin).filter((entry) => entry.includes(".txn-") || entry.includes(".lock"))).toEqual([]);
  expect(readdirSync(temp).filter((entry) => entry.startsWith("deck-canary-build-"))).toEqual([]);
  const version = spawnSync(join(bin, "deck-canary"), ["version"], { env: { PATH: "" }, encoding: "utf-8" });
  expect(version.status).toBe(0);
});
