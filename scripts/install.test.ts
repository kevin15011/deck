/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const INSTALL_SCRIPT = join(REPO_ROOT, "scripts", "install.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeDeckBinary(path: string, version: string, body = ""): void {
  const padding = randomBytes(4096).toString("base64");
  writeFileSync(path, `#!/usr/bin/env sh\n: <<'DECK_PADDING'\n${padding}\nDECK_PADDING\nif [ "\${1:-}" = "version" ]; then\n  printf 'deck ${version}\\ncommit: test\\ndate: test\\ntarget: test\\nchannel: test\\n'\n  exit 0\nfi\n${body}\nprintf 'unexpected args: %s\\n' "$*" >&2\nexit 64\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function hostPlatformTriple(): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

function createRelease(root: string, version: string, options: { candidateVersion?: string; invalidCandidate?: boolean; badChecksum?: boolean; platform?: string } = {}): { baseUrl: string; archiveName: string } {
  const releasesDir = join(root, "releases", "download", `v${version}`);
  mkdirSync(releasesDir, { recursive: true });
  const archiveName = `deck_v${version}_${options.platform ?? hostPlatformTriple()}.tar.gz`;
  const sourceDir = join(root, "archive-src");
  mkdirSync(sourceDir, { recursive: true });
  if (options.invalidCandidate) {
    writeFileSync(join(sourceDir, "deck"), "#!/usr/bin/env sh\nprintf 'not deck\\n' >&2\nexit 64\n", { mode: 0o755 });
    chmodSync(join(sourceDir, "deck"), 0o755);
  } else {
    writeDeckBinary(join(sourceDir, "deck"), options.candidateVersion ?? version);
  }
  const archivePath = join(releasesDir, archiveName);
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", sourceDir, "deck"], { encoding: "utf-8" });
  if (tar.status !== 0) throw new Error(`failed to create fixture archive: ${tar.stderr}`);
  const checksum = options.badChecksum ? "0".repeat(64) : sha256(archivePath);
  writeFileSync(join(releasesDir, "checksums.txt"), `${checksum}  ${archiveName}\n`);
  return { baseUrl: pathToFileURL(join(root, "releases", "download")).href, archiveName };
}

function createArchiveWithEntries(root: string, version: string, entries: { name: string; content: string; mode?: number }[]): { baseUrl: string; archiveName: string } {
  const releasesDir = join(root, "releases", "download", `v${version}`);
  mkdirSync(releasesDir, { recursive: true });
  const sourceDir = join(root, `archive-src-${version}`);
  mkdirSync(sourceDir, { recursive: true });
  for (const entry of entries) {
    const path = join(sourceDir, entry.name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, entry.content, { mode: entry.mode ?? 0o644 });
    chmodSync(path, entry.mode ?? 0o644);
  }
  const archiveName = `deck_v${version}_${hostPlatformTriple()}.tar.gz`;
  const archivePath = join(releasesDir, archiveName);
  const tar = spawnSync("tar", ["-czf", archivePath, "-C", sourceDir, ...entries.map((entry) => entry.name)], { encoding: "utf-8" });
  if (tar.status !== 0) throw new Error(`failed to create fixture archive: ${tar.stderr}`);
  writeFileSync(join(releasesDir, "checksums.txt"), `${sha256(archivePath)}  ${archiveName}\n`);
  return { baseUrl: pathToFileURL(join(root, "releases", "download")).href, archiveName };
}

function runInstall(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(realCommandPath("bash"), [INSTALL_SCRIPT, ...args], {
    cwd: root,
    encoding: "utf-8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      LC_ALL: "C",
      TERM: "dumb",
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_MACOS_SIGNATURE: "valid",
      ...env,
    },
  });
}

function realCommandPath(command: string): string {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`could not resolve ${command}: ${result.stderr}`);
  return result.stdout.trim();
}

function maybeCommandPath(command: string): string | null {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function linkSupportedChecksumTool(shim: string): void {
  const sha256sum = maybeCommandPath("sha256sum");
  const shasum = maybeCommandPath("shasum");
  if (sha256sum) symlinkSync(sha256sum, join(shim, "sha256sum"));
  else if (shasum) symlinkSync(shasum, join(shim, "shasum"));
  else throw new Error("test host lacks sha256sum and shasum");
}

function writeCommandWrapper(path: string, body: string): void {
  writeFileSync(path, body, { mode: 0o755 });
  chmodSync(path, 0o755);
}

async function waitForFile(path: string, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return existsSync(path);
}

async function waitForChild(child: ReturnType<typeof spawn>): Promise<{ status: number | null; stdout: string; stderr: string; signal: NodeJS.Signals | null }> {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  return await new Promise((resolve) => {
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function spawnInstall(root: string, args: string[], env: Record<string, string> = {}) {
  return spawn(realCommandPath("bash"), [INSTALL_SCRIPT, ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      LC_ALL: "C",
      TERM: "dumb",
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_MACOS_SIGNATURE: "valid",
      ...env,
    },
  });
}

function directoryEntries(path: string): string[] {
  return existsSync(path) ? readdirSync(path).sort() : [];
}

function fileReleaseBase(root: string): string {
  return pathToFileURL(join(root, "releases", "download")).href;
}

function writeHttpsFixtureCurl(wrapperPath: string, root: string, logPath?: string): void {
  writeCommandWrapper(wrapperPath, `#!/usr/bin/env sh
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
[ -n "${logPath ?? ""}" ] && printf '%s\n' "$url" >> "${logPath ?? ""}"
rel="\${url#https://example.test/releases/download/}"
cp "${join(root, "releases", "download")}/$rel" "$out"
`);
}

describe("scripts/install.sh recovery mode", () => {
  test("effectful installer test invocations use an explicit temporary --dir", () => {
    const source = readFileSync(new URL(import.meta.url), "utf-8");
    const invocations = [...source.matchAll(/\b(?:runInstall|spawnInstall)\(root, \[([^\]]+)\]/g)];
    const effectful = invocations
      .map((match) => match[1]!)
      .filter((args) => args.includes("--recovery") || args.includes("--version") || args.includes("--dir"));

    expect(effectful.length).toBeGreaterThan(0);
    for (const args of effectful) {
      expect(args, `UNSAFE_INSTALL_TEST_INVOCATION: [${args}]`).toContain('"--dir"');
    }
  });

  test("installs from a verified local release without sudo or shell profile edits", () => {
    const root = tempRoot("deck-install-recovery-apply-");
    const home = join(root, "home");
    const bin = join(root, "bin");
    const fakeBin = join(root, "fake-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(home, ".bashrc"), "profile-sentinel");
    writeFileSync(join(fakeBin, "sudo"), `#!/usr/bin/env sh\nprintf 'sudo must not run\\n' > '${join(root, "sudo-ran")}'\nexit 1\n`, { mode: 0o755 });
    writeFileSync(join(bin, "deck"), "old-deck", { mode: 0o755 });
    const release = createRelease(root, "9.9.9");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "v9.9.9"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 9.9.9");
    expect(readFileSync(join(home, ".bashrc"), "utf-8")).toBe("profile-sentinel");
    expect(existsSync(join(root, "sudo-ran"))).toBe(false);
    expect(result.stdout + result.stderr).toContain("deck is installed");
  });

  test("rolls back to the previous binary when candidate version verification fails", () => {
    const root = tempRoot("deck-install-recovery-rollback-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.8", { invalidCandidate: true });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.8"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("rollback");
  });

  test("serializes concurrent transactions and never restores over a later transaction", async () => {
    const root = tempRoot("deck-install-recovery-lock-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const holdMarker = join(root, "first-transaction-held");
    const releaseHold = join(root, "release-first-transaction");
    const lockDir = join(bin, "deck.install.lock");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    createRelease(root, "9.9.20", { invalidCandidate: true });
    createRelease(root, "9.9.21");
    const realMv = realCommandPath("mv");
    writeCommandWrapper(join(wrapperBin, "mv"), `#!/usr/bin/env sh
if [ "$1" = "${join(bin, "deck")}" ] && [ "\${2#${join(bin, "deck")}.backup.}" != "$2" ]; then
  "${realMv}" "$@" || exit $?
  printf 'held\n' > "${holdMarker}"
  while [ ! -f "${releaseHold}" ]; do sleep 0.05; done
  exit 0
fi
exec "${realMv}" "$@"
`);

    const first = spawnInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.20"], {
      DECK_INSTALL_RELEASE_BASE_URL: fileReleaseBase(root),
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_HOLD_AFTER_LOCK_MARKER: holdMarker,
      DECK_INSTALL_TEST_HOLD_AFTER_LOCK_RELEASE: releaseHold,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });
    expect(await waitForFile(holdMarker), "first transaction reached controlled hold").toBe(true);
    expect(existsSync(lockDir)).toBe(true);

    const second = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.21"], {
      DECK_INSTALL_RELEASE_BASE_URL: fileReleaseBase(root),
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("active installer transaction");
    expect(existsSync(lockDir)).toBe(true);

    const third = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.21"], {
      DECK_INSTALL_RELEASE_BASE_URL: fileReleaseBase(root),
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });
    expect(third.status).not.toBe(0);
    expect(third.stderr).toContain("active installer transaction");
    expect(existsSync(lockDir)).toBe(true);

    writeFileSync(releaseHold, "release");
    const firstResult = await waitForChild(first);

    expect(firstResult.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 1.0.0");
    expect(existsSync(lockDir)).toBe(false);
  });

  test("refuses a stale lock without mutating or removing it", () => {
    const root = tempRoot("deck-install-recovery-stale-lock-");
    const bin = join(root, "bin");
    const lockDir = join(bin, "deck.install.lock");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, "owner.txt"), "owner_token=stale-token\n");
    createRelease(root, "9.9.26");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.26"], {
      DECK_INSTALL_RELEASE_BASE_URL: fileReleaseBase(root),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("will not steal stale locks");
    expect(readFileSync(join(lockDir, "owner.txt"), "utf-8")).toContain("stale-token");
  });

  test("leaves locks with non-exact owner records untouched", () => {
    const cases = ["suffix", "prefix", "malformed", "missing", "duplicate"] as const;
    for (const mutation of cases) {
      const root = tempRoot(`deck-install-owner-${mutation}-`);
      const bin = join(root, "bin");
      mkdirSync(join(root, "home"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeDeckBinary(join(bin, "deck"), "1.0.0");
      const release = createRelease(root, `9.9.${40 + cases.indexOf(mutation)}`);

      const result = runInstall(root, ["--recovery", "--dir", bin, "--version", `9.9.${40 + cases.indexOf(mutation)}`], {
        DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
        DECK_INSTALL_TEST_MODE: "1",
        DECK_INSTALL_TEST_MUTATE_LOCK_OWNER: mutation,
      });

      const lockDir = join(bin, "deck.install.lock");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Lock ownership changed");
      expect(existsSync(lockDir), mutation).toBe(true);
      expect(existsSync(join(lockDir, "owner.txt")) || mutation === "missing", mutation).toBe(true);
    }
  });

  test("keeps the live destination present until the candidate rename", () => {
    const root = tempRoot("deck-install-recovery-atomic-window-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const marker = join(root, "target-presence-before-candidate-rename");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const release = createRelease(root, "9.9.10");
    const realMv = realCommandPath("mv");
    writeFileSync(join(wrapperBin, "mv"), `#!/usr/bin/env sh
src="$1"
dst="$2"
if [ "$src" = "-f" ]; then
  src="$2"
  dst="$3"
fi
if [ "\${src##*/}" = "deck.candidate" ] && [ "$dst" = "${join(bin, "deck")}" ]; then
  if [ -e "$dst" ]; then printf 'present\n' > "${marker}"; else printf 'missing\n' > "${marker}"; fi
fi
exec "${realMv}" "$@"
`, { mode: 0o755 });
    chmodSync(join(wrapperBin, "mv"), 0o755);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.10"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_BEFORE_CANDIDATE_RENAME_MARKER: marker,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(marker, "utf-8").trim()).toBe("present");
  });

  test("restores an owned candidate on SIGTERM during verification", async () => {
    const root = tempRoot("deck-install-recovery-sigterm-");
    const bin = join(root, "bin");
    const holdMarker = join(root, "verify-held");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.14");

    const child = spawnInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.14"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_HOLD_DURING_VERIFY_MARKER: holdMarker,
    });
    expect(await waitForFile(holdMarker), "installer reached verification hold").toBe(true);
    child.kill("SIGTERM");
    const result = await waitForChild(child);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("Interrupted");
    expect(directoryEntries(bin).filter((name) => name.includes(".deck-install") || name.includes(".backup") || name.includes(".lock"))).toEqual([]);
  });

  test("restores an owned candidate on unexpected non-zero exit after replacement", () => {
    const root = tempRoot("deck-install-recovery-unexpected-exit-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.27");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.27"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_EXIT_AFTER_RENAME: "1",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("restored previous binary");
    expect(existsSync(join(bin, "deck.install.lock"))).toBe(false);
  });

  test("restores if the rename primitive is interrupted after replacing the target", async () => {
    const root = tempRoot("deck-install-recovery-rename-signal-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.28");
    const realPerl = realCommandPath("perl");
    const realMv = realCommandPath("mv");
    writeCommandWrapper(join(wrapperBin, "perl"), `#!/usr/bin/env sh
src=""
dst=""
for arg in "$@"; do src="$dst"; dst="$arg"; done
if [ "\${src##*/}" = "deck.candidate" ] && [ "$dst" = "${join(bin, "deck")}" ]; then
  "${realMv}" -f "$src" "$dst" || exit $?
  kill -TERM "\${DECK_INSTALL_TEST_INSTALLER_PID:-$PPID}"
  sleep 1
  exit 143
fi
exec "${realPerl}" "$@"
`);

    const child = spawnInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.28"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });
    const result = await waitForChild(child);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("Interrupted");
  });

  test("removes staging, backup, and lock artifacts after successful recovery", () => {
    const root = tempRoot("deck-install-recovery-cleanup-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const release = createRelease(root, "9.9.15");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.15"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).toBe(0);
    expect(directoryEntries(bin).filter((name) => name.includes(".deck-install") || name.includes(".backup") || name.includes(".lock"))).toEqual([]);
  });

  test("rolls back and fails when candidate reports a different valid Deck version", () => {
    const root = tempRoot("deck-install-recovery-wrong-version-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.11", { candidateVersion: "9.9.10" });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.11"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("expected 9.9.11");
  });

  test("preserves evidence and does not restore from a missing backup", () => {
    const root = tempRoot("deck-install-missing-backup-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const release = createRelease(root, "9.9.50", { invalidCandidate: true });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.50"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_MUTATE_BACKUP_BEFORE_VERIFY: "missing",
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("not deck");
    expect(result.stderr).toContain("backup is missing");
    expect(result.stderr).not.toContain("rollback completed");
    expect(existsSync(join(bin, "deck.install.lock"))).toBe(true);
  });

  test("preserves evidence and does not restore from changed or symlink backups", () => {
    for (const mutation of ["changed", "symlink"] as const) {
      const root = tempRoot(`deck-install-${mutation}-backup-`);
      const bin = join(root, "bin");
      mkdirSync(join(root, "home"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeDeckBinary(join(bin, "deck"), "1.0.0");
      const release = createRelease(root, mutation === "changed" ? "9.9.51" : "9.9.52", { invalidCandidate: true });

      const result = runInstall(root, ["--recovery", "--dir", bin, "--version", mutation === "changed" ? "9.9.51" : "9.9.52"], {
        DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
        DECK_INSTALL_TEST_MODE: "1",
        DECK_INSTALL_TEST_MUTATE_BACKUP_BEFORE_VERIFY: mutation,
      });

      expect(result.status).not.toBe(0);
      expect(readFileSync(join(bin, "deck"), "utf-8"), mutation).toContain("not deck");
      expect(result.stderr, mutation).toContain(mutation === "changed" ? "backup digest changed" : "backup is not a regular file");
      expect(result.stderr, mutation).not.toContain("rollback completed");
      expect(existsSync(join(bin, "deck.install.lock")), mutation).toBe(true);
    }
  });

  test("treats rollback as uncertain if restored target becomes a symlink at rename boundary", () => {
    const root = tempRoot("deck-install-restore-symlink-race-");
    const bin = join(root, "bin");
    const symlinkTarget = join(root, "original-bytes");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    writeFileSync(symlinkTarget, readFileSync(join(bin, "deck")));
    const release = createRelease(root, "9.9.56", { invalidCandidate: true });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.56"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_REPLACE_BACKUP_WITH_SYMLINK_BEFORE_RESTORE: symlinkTarget,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("rollback result is uncertain");
    expect(result.stderr).not.toContain("rollback completed");
    expect(existsSync(join(bin, "deck.install.lock"))).toBe(true);
    expect(readlinkSync(join(bin, "deck"))).toBe(symlinkTarget);
  });

  test("refuses an existing non-symlink target that is not a regular file", () => {
    const root = tempRoot("deck-install-recovery-nonregular-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(join(bin, "deck"), { recursive: true });
    writeFileSync(join(bin, "deck", "sentinel"), "directory-target");
    const release = createRelease(root, "9.9.12");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.12"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck", "sentinel"), "utf-8")).toBe("directory-target");
    expect(result.stderr).toContain("regular file");
  });

  test("canonicalizes a symlink-containing install directory form once", () => {
    const root = tempRoot("deck-install-recovery-canonical-dir-");
    const realBin = join(root, "real-bin");
    const linkedBin = join(root, "linked-bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(realBin, { recursive: true });
    symlinkSync(realBin, linkedBin);
    const release = createRelease(root, "9.9.16");

    const result = runInstall(root, ["--recovery", "--dir", `${linkedBin}/.`, "--version", "9.9.16"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain(`${realBin}/deck`);
    expect(readFileSync(join(realBin, "deck"), "utf-8")).toContain("deck 9.9.16");
  });

  test("does not traverse a destination changed into a directory symlink at the rename boundary", () => {
    const root = tempRoot("deck-install-recovery-rename-race-");
    const bin = join(root, "bin");
    const trapDir = join(root, "trap-dir");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(trapDir, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.17");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.17"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_RACE_TARGET_SYMLINK_DIR: trapDir,
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(trapDir, "deck"))).toBe(false);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("symlink");
  });

  test("does not move the candidate inside an actual directory created at the rename boundary", () => {
    const root = tempRoot("deck-install-target-directory-race-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const release = createRelease(root, "9.9.53");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.53"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_RACE_TARGET_DIRECTORY: "1",
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(bin, "deck", "deck"))).toBe(false);
    expect(result.stderr).toContain("not a regular file");
    expect(existsSync(join(bin, "deck.install.lock"))).toBe(true);
  });

  test("does not claim rollback when candidate verification fails without a predecessor", () => {
    const root = tempRoot("deck-install-recovery-no-predecessor-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    const release = createRelease(root, "9.9.13", { invalidCandidate: true });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.13"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(join(bin, "deck"))).toBe(false);
    expect(result.stderr).not.toContain("rollback completed");
  });

  test("rejects checksum mismatches before replacing the target", () => {
    const root = tempRoot("deck-install-recovery-checksum-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "deck"), "old-deck", { mode: 0o755 });
    const release = createRelease(root, "9.9.7", { badChecksum: true });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.7"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe("old-deck");
    expect(result.stderr).toContain("Checksum mismatch");
  });

  test("refuses a symlinked destination", () => {
    const root = tempRoot("deck-install-recovery-symlink-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(root, "elsewhere-deck"), "old", { mode: 0o755 });
    symlinkSync(join(root, "elsewhere-deck"), join(bin, "deck"));
    const release = createRelease(root, "9.9.6");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.6"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(readlinkSync(join(bin, "deck"))).toBe(join(root, "elsewhere-deck"));
    expect(result.stderr).toContain("symlink");
  });

  test("rejects insecure recovery mode", () => {
    const root = tempRoot("deck-install-recovery-insecure-");
    mkdirSync(join(root, "home"), { recursive: true });
    const result = runInstall(root, ["--recovery", "--insecure", "--dir", root, "--version", "9.9.5"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--insecure cannot be used with --recovery");
  });

  test("ignores destructive test hooks unless explicit local test mode is enabled", () => {
    const root = tempRoot("deck-install-recovery-hook-gate-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const trapDir = join(root, "trap-dir");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    mkdirSync(trapDir, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const linuxPlatform = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
    createRelease(root, "9.9.29", { platform: linuxPlatform });
    writeCommandWrapper(join(wrapperBin, "uname"), `#!/usr/bin/env sh
if [ "$1" = "-s" ]; then printf 'Linux\n'; exit 0; fi
if [ "$1" = "-m" ]; then printf '${process.arch === "arm64" ? "aarch64" : "x86_64"}\n'; exit 0; fi
exit 64
`);
    writeHttpsFixtureCurl(join(wrapperBin, "curl"), root);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.29"], {
      DECK_INSTALL_RELEASE_BASE_URL: "https://example.test/releases/download",
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_RACE_TARGET_SYMLINK_DIR: trapDir,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(trapDir, "deck"))).toBe(false);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 9.9.29");
  });

  test("rejects plaintext HTTP release URLs before invoking curl", () => {
    const root = tempRoot("deck-install-recovery-http-");
    const bin = join(root, "bin");
    const fakeBin = join(root, "fake-bin");
    const curlMarker = join(root, "curl-invoked");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeCommandWrapper(join(fakeBin, "curl"), `#!/usr/bin/env sh
printf 'curl invoked\n' > "${curlMarker}"
exit 64
`);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.18"], {
      DECK_INSTALL_RELEASE_BASE_URL: "http://example.invalid/releases/download",
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HTTPS");
    expect(existsSync(curlMarker)).toBe(false);
  });

  test("constrains curl protocols for local and redirected downloads", () => {
    const root = tempRoot("deck-install-recovery-curl-proto-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const curlLog = join(root, "curl-args.log");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    const release = createRelease(root, "9.9.19");
    const realCurl = realCommandPath("curl");
    writeCommandWrapper(join(wrapperBin, "curl"), `#!/usr/bin/env sh
printf '%s\n' "$*" >> "${curlLog}"
exec "${realCurl}" "$@"
`);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.19"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    const curlArgs = readFileSync(curlLog, "utf-8");
    expect(curlArgs).toContain("--proto =https,file");
    expect(curlArgs).toContain("--proto-redir =https");
    expect(curlArgs).not.toContain("--proto-redir =https,file");
  });

  test("constrains latest-release curl to HTTPS-only before asset downloads", () => {
    const root = tempRoot("deck-install-latest-curl-proto-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const latestCurlLog = join(root, "latest-curl-args.log");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    createRelease(root, "9.9.25");
    const realCurl = realCommandPath("curl");
    writeCommandWrapper(join(wrapperBin, "curl"), `#!/usr/bin/env sh
args="$*"
case "$args" in
  *api.github.com*)
    printf '%s\n' "$args" > "${latestCurlLog}"
    printf '{"tag_name":"v9.9.25"}\n200\n'
    exit 0
    ;;
esac
exec "${realCurl}" "$@"
`);

    const result = runInstall(root, ["--recovery", "--dir", bin], {
      DECK_INSTALL_RELEASE_BASE_URL: pathToFileURL(join(root, "releases", "download")).href,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    const latestArgs = readFileSync(latestCurlLog, "utf-8");
    expect(latestArgs).toContain("--proto =https");
    expect(latestArgs).toContain("--proto-redir =https");
  });
});

describe("scripts/install.sh verification", () => {
  test("rejects an invalid macOS signature before replacing an existing binary", () => {
    const root = tempRoot("deck-install-darwin-signature-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const codesignLog = join(root, "codesign.log");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"));
    writeCommandWrapper(join(wrapperBin, "uname"), `#!/usr/bin/env sh
if [ "$1" = "-s" ]; then printf 'Darwin\n'; exit 0; fi
if [ "$1" = "-m" ]; then printf 'arm64\n'; exit 0; fi
exit 64
`);
    writeCommandWrapper(join(wrapperBin, "codesign"), `#!/usr/bin/env sh
printf '%s\n' "$*" > "${codesignLog}"
exit 1
`);
    const release = createRelease(root, "9.9.56", { platform: "darwin-arm64" });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.56"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MACOS_SIGNATURE: "",
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("valid macOS code signature");
    expect(readFileSync(codesignLog, "utf-8")).toContain("--verify --deep --strict --verbose=2");
    expect(readFileSync(join(bin, "deck"))).toEqual(before);
    expect(directoryEntries(bin).filter((entry) => entry.includes("backup"))).toEqual([]);
  });

  test("reports an empty status-137 smoke as SIGKILL before rollback", () => {
    const root = tempRoot("deck-install-sigkill-diagnostic-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"));
    const release = createArchiveWithEntries(root, "9.9.57", [
      { name: "deck", content: "#!/usr/bin/env sh\nkill -9 $$\n", mode: 0o755 },
    ]);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.57"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exit status 137 (SIGKILL)");
    expect(readFileSync(join(bin, "deck"))).toEqual(before);
  });

  test("normal installation verifies the exact installed path with deck version", () => {
    const root = tempRoot("deck-install-normal-verify-");
    const home = join(root, "home");
    const bin = join(root, "bin");
    const fakeBin = join(root, "fake-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, "deck"), "#!/usr/bin/env sh\nprintf 'wrong deck called\\n' >&2\nexit 64\n", { mode: 0o755 });
    const release = createRelease(root, "9.9.4");

    const result = runInstall(root, ["--dir", bin, "--version", "9.9.4"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("wrong deck called");
    expect(result.stdout + result.stderr).toContain(`${join(bin, "deck")}`);
  });

  test("creates an explicit fresh nested install directory safely", () => {
    const root = tempRoot("deck-install-fresh-home-");
    const home = join(root, "home");
    const bin = join(home, ".local", "bin");
    mkdirSync(home, { recursive: true });
    const release = createRelease(root, "9.9.30");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.30"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 9.9.30");
  });

  test("uses shasum fallback when sha256sum is unavailable", () => {
    const root = tempRoot("deck-install-shasum-fallback-");
    const home = join(root, "home");
    const bin = join(root, "bin");
    const shim = join(root, "shim-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(shim, { recursive: true });
    const commands = ["sh", "uname", "curl", "tar", "gzip", "wc", "tr", "awk", "chmod", "mv", "cp", "rm", "mkdir", "rmdir", "date", "mktemp", "grep", "sed", "head", "sleep", "dirname", "basename"];
    for (const command of commands) {
      symlinkSync(realCommandPath(command), join(shim, command));
    }
    symlinkSync(realCommandPath("perl"), join(shim, "perl"));
    symlinkSync(realCommandPath("shasum"), join(shim, "shasum"));
    const release = createRelease(root, "9.9.22");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.22"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: shim,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 9.9.22");
  });

  test("does not use BSD mv -h as a no-follow replacement primitive", () => {
    const root = tempRoot("deck-install-no-bsd-mv-h-");
    const bin = join(root, "bin");
    const shim = join(root, "shim-bin");
    const mvLog = join(root, "mv.log");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(shim, { recursive: true });
    const commands = ["sh", "uname", "curl", "tar", "gzip", "wc", "tr", "awk", "chmod", "cp", "rm", "mkdir", "rmdir", "date", "mktemp", "grep", "sed", "head", "sleep", "dirname", "basename"];
    for (const command of commands) symlinkSync(realCommandPath(command), join(shim, command));
    linkSupportedChecksumTool(shim);
    const realMv = realCommandPath("mv");
    writeCommandWrapper(join(shim, "mv"), `#!/usr/bin/env sh
case "$1" in
  --help) printf 'BSD mv fixture\n'; exit 1 ;;
  -h) printf 'mv -h\n' >> "${mvLog}"; shift; exec "${realMv}" -f "$@" ;;
  *) exec "${realMv}" "$@" ;;
esac
`);
    const release = createRelease(root, "9.9.31");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.31"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: shim,
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(mvLog) ? readFileSync(mvLog, "utf-8") : "").not.toContain("mv -h");
    expect(result.stderr).toContain("No safe no-follow rename primitive");
  });

  test("fails closed when no no-follow rename primitive is available", () => {
    const root = tempRoot("deck-install-no-rename-primitive-");
    const bin = join(root, "bin");
    const shim = join(root, "shim-bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(shim, { recursive: true });
    const commands = ["sh", "uname", "curl", "tar", "gzip", "wc", "tr", "awk", "chmod", "cp", "rm", "mkdir", "rmdir", "date", "mktemp", "grep", "sed", "head", "sleep", "dirname", "basename"];
    for (const command of commands) symlinkSync(realCommandPath(command), join(shim, command));
    linkSupportedChecksumTool(shim);
    writeCommandWrapper(join(shim, "mv"), `#!/usr/bin/env sh
case "$1" in
  --help) printf 'BSD mv fixture\n'; exit 1 ;;
  -h) printf 'mv -h unsupported\n' >&2; exit 64 ;;
  *) exec "${realCommandPath("mv")}" "$@" ;;
esac
`);
    const release = createRelease(root, "9.9.32");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.32"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: shim,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No safe no-follow rename primitive");
  });

  test("reports cleanup failure after restore while preserving original exit status and evidence", () => {
    const root = tempRoot("deck-install-cleanup-fail-after-restore-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    const rmLog = join(root, "rm.log");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const before = readFileSync(join(bin, "deck"), "utf-8");
    const release = createRelease(root, "9.9.54");
    const realRm = realCommandPath("rm");
    writeCommandWrapper(join(wrapperBin, "rm"), `#!/usr/bin/env sh
case "$*" in
  *".deck-install"*) printf 'rm blocked\n' >> "${rmLog}"; exit 71 ;;
esac
exec "${realRm}" "$@"
`);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.54"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      DECK_INSTALL_TEST_MODE: "1",
      DECK_INSTALL_TEST_EXIT_AFTER_RENAME: "1",
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(1);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toBe(before);
    expect(result.stderr).toContain("Cleanup failed");
    expect(existsSync(join(bin, "deck.install.lock"))).toBe(true);
  });

  test("successful transaction reports cleanup failure instead of claiming fully clean", () => {
    const root = tempRoot("deck-install-success-cleanup-fail-");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeDeckBinary(join(bin, "deck"), "1.0.0");
    const release = createRelease(root, "9.9.55");
    const realRm = realCommandPath("rm");
    writeCommandWrapper(join(wrapperBin, "rm"), `#!/usr/bin/env sh
case "$*" in
  *".deck-install"*) exit 72 ;;
esac
exec "${realRm}" "$@"
`);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.55"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 9.9.55");
    expect(result.stderr).toContain("Cleanup failed");
    expect(existsSync(join(bin, "deck.install.lock"))).toBe(true);
  });

  test("uses the native Darwin arm64 asset name when uname reports macOS arm64", () => {
    const root = tempRoot("deck-install-darwin-asset-");
    const home = join(root, "home");
    const bin = join(root, "bin");
    const wrapperBin = join(root, "wrapper-bin");
    mkdirSync(home, { recursive: true });
    mkdirSync(bin, { recursive: true });
    mkdirSync(wrapperBin, { recursive: true });
    writeCommandWrapper(join(wrapperBin, "uname"), `#!/usr/bin/env sh
if [ "$1" = "-s" ]; then printf 'Darwin\n'; exit 0; fi
if [ "$1" = "-m" ]; then printf 'arm64\n'; exit 0; fi
exit 64
`);
    const release = createRelease(root, "9.9.23", { platform: "darwin-arm64" });

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.23"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
      PATH: `${wrapperBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toContain("deck_v9.9.23_darwin-arm64.tar.gz");
  });

  test("extracts only the root deck archive member and ignores benign sibling files", () => {
    const root = tempRoot("deck-install-archive-member-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    const release = createArchiveWithEntries(root, "9.9.24", [
      { name: "deck", content: "#!/usr/bin/env sh\nif [ \"$1\" = version ]; then printf 'deck 9.9.24\\n'; exit 0; fi\nexit 64\n", mode: 0o755 },
      { name: "README.txt", content: "extra release note" },
    ]);

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.24"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(bin, "README.txt"))).toBe(false);
  });
});

describe("scripts/install.sh previous-version recovery opt-in", () => {
  test.skipIf(!process.env.DECK_PREVIOUS_VERSION_BINARY)("opt-in skipped unless DECK_PREVIOUS_VERSION_BINARY points to a real previous-version deck binary", () => {
    const root = tempRoot("deck-install-previous-version-");
    const bin = join(root, "bin");
    mkdirSync(join(root, "home"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    const previousBinary = process.env.DECK_PREVIOUS_VERSION_BINARY as string;
    writeFileSync(join(bin, "deck"), readFileSync(previousBinary), { mode: 0o755 });
    chmodSync(join(bin, "deck"), 0o755);
    const release = createRelease(root, "9.9.3");

    const result = runInstall(root, ["--recovery", "--dir", bin, "--version", "9.9.3"], {
      DECK_INSTALL_RELEASE_BASE_URL: release.baseUrl,
    });

    expect(result.status).toBe(0);
    expect(basename(join(bin, "deck"))).toBe("deck");
    expect(readFileSync(join(bin, "deck"), "utf-8")).toContain("deck 9.9.3");
  });
});
