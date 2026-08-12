/**
 * Binary smoke tests for compiled deck binary.
 *
 * Verifies the compiled binary works correctly across all supported commands.
 * These tests run using bun to emulate the compiled binary behavior.
 */

import { describe, expect, test } from "bun:test";
import { getBuildInfo } from "../runtime/build-info";
import { spawn as bunSpawn } from "bun";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";

/**
 * Collect a ReadableStream<Uint8Array> into a string.
 */



type StreamPump = Readonly<{
  done: Promise<string>;
  snapshot: () => string;
  cancel: () => Promise<void>;
}>;

type StreamPumpFactory = (
  stream: ReadableStream<Uint8Array> | null | undefined,
  label: "stdout" | "stderr",
) => StreamPump;

function startStreamPump(
  stream: ReadableStream<Uint8Array> | null | undefined,
): StreamPump {
  if (!stream) {
    return { done: Promise.resolve(""), snapshot: () => "", cancel: async () => {} };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const decode = () => new TextDecoder().decode(
    chunks.reduce((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc, 0);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array()),
  );
  const done = (async () => {
    try {
      let result = await reader.read();
      while (!result.done) {
        chunks.push(result.value);
        result = await reader.read();
      }
      return decode();
    } finally {
      reader.releaseLock();
    }
  })();

  return {
    done,
    snapshot: decode,
    cancel: async () => {
      try {
        await reader.cancel();
      } finally {
        await done.catch(() => "");
      }
    },
  };
}

/**
 * Run deck CLI as a subprocess and capture output with a hard timeout.
 * Uses SIGKILL to enforce a subprocess timeout so network hangs
 * do not block the test runner.
 *
 * Returns { code, stdout, stderr } where code is:
 *   - the actual exit code (0, 1, etc.)
 *   - 124 if the subprocess timed out
 */
const COMMAND_TIMEOUT_MS = 20_000;
const TERMINATION_GRACE_MS = 250;
const CLEANUP_TIMEOUT_MS = 4_000;

type DeckCommandResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cleanupConfirmed: true;
}>;

type CleanupBudget = Readonly<{ expiresAt: number }>;

type WindowsTaskkillResult = Readonly<{ code: number; stdout: string; stderr: string }>;

type ProcessLifecycleDependencies = Readonly<{
  platform: NodeJS.Platform;
  processAbsent: (pid: number) => boolean;
  groupAbsent: (pid: number) => boolean;
  signalProcessGroup: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (milliseconds: number) => Promise<void>;
  runWindowsTaskkill: (pid: number, budget: CleanupBudget) => Promise<WindowsTaskkillResult>;
}>;

type RunCommandOptions = Readonly<{
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  lifecycle?: Partial<ProcessLifecycleDependencies>;
  streamPumpFactory?: StreamPumpFactory;
  onCleanupDeadline?: (expiresAt: number) => void;
}>;

async function deadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function processAbsent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function groupAbsent(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

async function waitUntil(
  check: () => boolean,
  budget: CleanupBudget,
  description: string,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  while (!check()) {
    if (Date.now() >= budget.expiresAt) throw new Error(`Cleanup deadline exceeded confirming ${description}`);
    await sleep(Math.min(25, Math.max(1, budget.expiresAt - Date.now())));
  }
}


function remainingCleanupMs(budget: CleanupBudget, description: string): number {
  const remaining = budget.expiresAt - Date.now();
  if (remaining <= 0) throw new Error(`Cleanup deadline exceeded before ${description}`);
  return remaining;
}

function withinCleanupBudget<T>(
  promise: Promise<T>,
  budget: CleanupBudget,
  description: string,
): Promise<T> {
  return deadline(promise, remainingCleanupMs(budget, description), `${description} exceeded cleanup deadline`);
}

async function runWindowsTaskkill(
  pid: number,
  budget: CleanupBudget,
): Promise<WindowsTaskkillResult> {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot) throw new Error("SystemRoot is required for fail-closed Windows process cleanup");
  const taskkill = bunSpawn([join(systemRoot, "System32", "taskkill.exe"), "/PID", String(pid), "/T", "/F"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = startStreamPump(taskkill.stdout);
  const stderr = startStreamPump(taskkill.stderr);
  try {
    const [code, stdoutText, stderrText] = await withinCleanupBudget(
      Promise.all([taskkill.exited, stdout.done, stderr.done]),
      budget,
      `Windows taskkill cleanup for PID ${pid}`,
    );
    return { code, stdout: stdoutText, stderr: stderrText };
  } catch (error) {
    await Promise.allSettled([stdout.cancel(), stderr.cancel()]);
    throw error;
  }
}

function resolveLifecycleDependencies(
  overrides: Partial<ProcessLifecycleDependencies> | undefined,
): ProcessLifecycleDependencies {
  return {
    platform: overrides?.platform ?? process.platform,
    processAbsent: overrides?.processAbsent ?? processAbsent,
    groupAbsent: overrides?.groupAbsent ?? groupAbsent,
    signalProcessGroup: overrides?.signalProcessGroup ?? ((pid, signal) => process.kill(-pid, signal)),
    sleep: overrides?.sleep ?? ((milliseconds) => Bun.sleep(milliseconds)),
    runWindowsTaskkill: overrides?.runWindowsTaskkill ?? runWindowsTaskkill,
  };
}

async function terminateProcessTree(
  proc: any,
  descendantPids: readonly number[],
  budget: CleanupBudget,
  dependencies: ProcessLifecycleDependencies,
): Promise<void> {
  const rootPid = proc.pid as number;
  if (dependencies.platform === "win32") {
    for (const pid of [...new Set([rootPid, ...descendantPids])]) {
      const result = await withinCleanupBudget(
        dependencies.runWindowsTaskkill(pid, budget),
        budget,
        `Windows taskkill cleanup for PID ${pid}`,
      );
      if (result.code !== 0 && !dependencies.processAbsent(pid)) {
        throw new Error(`taskkill failed for PID ${pid} (${result.code}): ${result.stderr || result.stdout}`);
      }
      await waitUntil(
        () => dependencies.processAbsent(pid),
        budget,
        `PID ${pid} exit`,
        dependencies.sleep,
      );
    }
    return;
  }

  if (!dependencies.groupAbsent(rootPid)) {
    try {
      dependencies.signalProcessGroup(rootPid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await withinCleanupBudget(
      dependencies.sleep(Math.min(TERMINATION_GRACE_MS, remainingCleanupMs(budget, "termination grace"))),
      budget,
      "termination grace",
    );
    if (!dependencies.groupAbsent(rootPid)) {
      try {
        dependencies.signalProcessGroup(rootPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }
  await waitUntil(
    () => dependencies.groupAbsent(rootPid),
    budget,
    `process group ${rootPid} cleanup`,
    dependencies.sleep,
  );
  await waitUntil(
    () => dependencies.processAbsent(rootPid),
    budget,
    `root PID ${rootPid} exit`,
    dependencies.sleep,
  );
  for (const pid of descendantPids) {
    await waitUntil(
      () => dependencies.processAbsent(pid),
      budget,
      `descendant PID ${pid} exit`,
      dependencies.sleep,
    );
  }
}

function lifecyclePids(output: string): number[] {
  return [...output.matchAll(/descendant:(\d+)/g)].map((match) => Number(match[1]));
}

async function runCommand(command: string[], options: RunCommandOptions): Promise<DeckCommandResult> {
  const lifecycle = resolveLifecycleDependencies(options.lifecycle);
  const pumpFactory = options.streamPumpFactory ?? ((stream) => startStreamPump(stream));
  const proc = bunSpawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: lifecycle.platform !== "win32",
  });
  const stdoutPump = pumpFactory(proc.stdout, "stdout");
  const stderrPump = pumpFactory(proc.stderr, "stderr");
  const exitPromise = proc.exited.catch(() => 1);
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  let timedOut = false;
  let code: number;

  try {
    code = await deadline(exitPromise, timeoutMs, `Command timed out after ${timeoutMs}ms`);
  } catch {
    timedOut = true;
    code = 124;
  }

  const cleanupBudget: CleanupBudget = {
    expiresAt: Date.now() + (options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS),
  };
  options.onCleanupDeadline?.(cleanupBudget.expiresAt);

  try {
    await lifecycle.sleep(0);
    const initialOutput = `${stdoutPump.snapshot()}\n${stderrPump.snapshot()}`;
    const initialDescendants = lifecyclePids(initialOutput);
    await terminateProcessTree(proc, initialDescendants, cleanupBudget, lifecycle);
    await withinCleanupBudget(exitPromise, cleanupBudget, "root process exit");

    const [stdout, stderr] = await withinCleanupBudget(
      Promise.all([stdoutPump.done, stderrPump.done]),
      cleanupBudget,
      "stdout/stderr EOF",
    );
    for (const pid of lifecyclePids(`${stdout}\n${stderr}`)) {
      await waitUntil(
        () => lifecycle.processAbsent(pid),
        cleanupBudget,
        `descendant PID ${pid} exit`,
        lifecycle.sleep,
      );
    }

    return { code: timedOut ? 124 : code, stdout, stderr, timedOut, cleanupConfirmed: true };
  } catch (error) {
    await Promise.allSettled([stdoutPump.cancel(), stderrPump.cancel()]);
    await Promise.allSettled([stdoutPump.done, stderrPump.done]);
    throw error;
  }
}

async function runDeckCommand(
  args: string[],
  env: Record<string, string>,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<DeckCommandResult> {
  return runCommand(
    [process.execPath, "apps/cli/src/main.tsx", ...args],
    { cwd: process.cwd(), env, timeoutMs },
  );
}

type CliSandbox = Readonly<{
  root: string;
  env: Record<string, string>;
  releaseVersion: string;
  cleanup: () => void;
}>;

function createCliSandbox(): CliSandbox {
  const root = mkdtempSync(join(tmpdir(), "deck-binary-smoke-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const config = join(root, "config");
  const state = join(root, "state");
  const cache = join(root, "cache");
  const temp = join(root, "tmp");
  for (const path of [home, bin, config, state, cache, temp]) mkdirSync(path, { recursive: true });
  mkdirSync(join(config, "deck"), { recursive: true });
  writeFileSync(join(config, "deck", "config.json"), JSON.stringify({ version: 1 }));

  const releaseVersion = "9.9.9-test";
  const releaseFixture = join(root, "release.json");
  writeFileSync(releaseFixture, JSON.stringify({
    schemaVersion: 1,
    version: releaseVersion,
    tag_name: `v${releaseVersion}`,
    channel: "stable",
    published_at: "2026-01-01T00:00:00.000Z",
    release_notes_url: "https://example.invalid/deck-test-release",
    items: [],
  }));

  const shim = (name: string) => {
    const path = join(bin, process.platform === "win32" ? `${name}.cmd` : name);
    const content = process.platform === "win32"
      ? `@echo off\r\nif "%~1"=="--version" if "%~2"=="" (\r\n  echo ${name} 1.0.0\r\n  exit /b 0\r\n)\r\n>&2 echo Unexpected ${name} invocation: %*\r\nexit /b 64\r\n`
      : `#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then\n  echo '${name} 1.0.0'\n  exit 0\nfi\nprintf 'Unexpected ${name} invocation: %s\\n' "$*" >&2\nexit 64\n`;
    writeFileSync(path, content);
    if (process.platform !== "win32") chmodSync(path, 0o755);
  };
  for (const name of ["deck", "opencode", "pi", "engram", "supermemory", "serena"]) shim(name);

  const piMcpPath = join(home, ".pi", "agent", "mcp.json");
  mkdirSync(dirname(piMcpPath), { recursive: true });
  writeFileSync(piMcpPath, JSON.stringify({
    mcpServers: {
      supermemory: {
        transport: "http",
        url: "https://mcp.supermemory.ai/mcp",
        headers: { "x-sm-project": "sm_project_v1_fixture_deck", "x-supermemory-api-key": "fixture-not-a-secret" },
      },
    },
  }));

  const openCodeConfig = {
    mcp: {
      supermemory: { type: "remote", url: "https://mcp.supermemory.ai/mcp", headers: { "x-sm-project": "sm_project_v1_fixture_deck" } },
      "codebase-memory-mcp": { command: [join(bin, process.platform === "win32" ? "deck.cmd" : "deck")] },
      serena: { command: [join(bin, process.platform === "win32" ? "serena.cmd" : "serena")] },
    },
  };
  for (const path of [join(config, "opencode", "opencode.json"), join(home, ".config", "opencode", "opencode.json")]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(openCodeConfig));
  }

  const manifestPath = join(state, "deck", "manifest.json");
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 2,
    generatedAt: "2026-01-01T00:00:00.000Z",
    deckVersion: getBuildInfo().version,
    files: [],
  }));

  const env: Record<string, string> = {
    PATH: `${bin}${delimiter}${dirname(process.execPath)}`,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: config,
    XDG_STATE_HOME: state,
    XDG_CACHE_HOME: cache,
    TMPDIR: temp,
    TEMP: temp,
    TMP: temp,
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    DECK_RELEASE_CHECK_FIXTURE: releaseFixture,
  };
  if (process.platform === "win32") {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.ComSpec) env.ComSpec = process.env.ComSpec;
  }

  return { root, env, releaseVersion, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}


function listFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(path.slice(root.length + 1));
    }
  };
  visit(root);
  return files.sort();
}


function snapshotFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    listFiles(root).map((file) => [file, readFileSync(join(root, file), "utf8")]),
  );
}

type OutsideSandboxInventory = Record<string, string>;

type FileBoundarySnapshot = Readonly<{
  path: string;
  exists: boolean;
  type: "missing" | "file" | "directory" | "symlink" | "other";
  size: number | null;
  mode: number | null;
  digest: string | null;
}>;

function snapshotBoundaryFile(root: string, file: string): FileBoundarySnapshot {
  const path = join(root, file);
  if (!existsSync(path)) return { path: file, exists: false, type: "missing", size: null, mode: null, digest: null };
  const stat = lstatSync(path);
  const type = stat.isSymbolicLink()
    ? "symlink"
    : stat.isFile()
      ? "file"
      : stat.isDirectory()
        ? "directory"
        : "other";
  return {
    path: file,
    exists: true,
    type,
    size: stat.size,
    mode: stat.mode & 0o777,
    digest: stat.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : null,
  };
}

function hashFiles(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(JSON.stringify(snapshotBoundaryFile(root, file)));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function snapshotRepository(root: string): string {
  const result = Bun.spawnSync(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Unable to inventory repository boundary: ${new TextDecoder().decode(result.stderr)}`);
  }
  const files = new TextDecoder().decode(result.stdout).split("\0").filter(Boolean).sort();
  return hashFiles(root, files);
}

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (
    pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

function snapshotOutsideSandbox(
  sandbox: CliSandbox,
  additionalBoundaries: Record<string, string> = {},
): OutsideSandboxInventory {
  for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "TMPDIR", "TEMP", "TMP"]) {
    const path = sandbox.env[key];
    if (!path || !isWithin(sandbox.root, path)) {
      throw new Error(`Sandbox writable root ${key} escapes ${sandbox.root}: ${path ?? "<missing>"}`);
    }
  }

  const inventory: OutsideSandboxInventory = {
    "repository-cwd": snapshotRepository(process.cwd()),
    "runtime-executable": hashFiles(dirname(process.execPath), [process.execPath.slice(dirname(process.execPath).length + 1)]),
  };
  for (const [label, root] of Object.entries(additionalBoundaries)) {
    inventory[label] = hashFiles(root, listFiles(root));
  }
  return inventory;
}

function assertOutsideSandboxUnchanged(
  before: OutsideSandboxInventory,
  after: OutsideSandboxInventory,
): void {
  const changed = Object.keys(before).filter((label) => after[label] !== before[label]);
  if (changed.length > 0) {
    throw new Error(`Outside-sandbox write detected in: ${changed.join(", ")}`);
  }
}

function descendantScript(exitCode: number): string {
  return [
    "const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { stdout: 'inherit', stderr: 'inherit' });",
    "console.log('descendant:' + child.pid);",
    "await Bun.sleep(50);",
    `process.exit(${exitCode});`,
  ].join(" ");
}

function createWindowsLifecycleSimulation(taskkillPids: number[]) {
  return {
    platform: "win32" as const,
    processAbsent,
    groupAbsent,
    signalProcessGroup: (pid: number, signal: NodeJS.Signals) => process.kill(-pid, signal),
    sleep: (milliseconds: number) => Bun.sleep(milliseconds),
    runWindowsTaskkill: async (pid: number) => {
      taskkillPids.push(pid);
      if (processAbsent(pid)) return { code: 1, stdout: "", stderr: "process not found" };
      process.kill(pid, "SIGKILL");
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

describe("Binary smoke tests", () => {
  test("version outputs version/commit/date/platform", async () => {
    const sandbox = createCliSandbox();
    try {
      const result = await runDeckCommand(["version"], sandbox.env);
      expect(result).toMatchObject({ code: 0, timedOut: false, cleanupConfirmed: true });
      expect(result.stdout).toContain("deck ");
      expect(result.stdout).toContain("commit:");
      expect(result.stdout).toContain("date:");
      expect(result.stdout).toContain("target:");
      expect(result.stdout).toContain("channel:");
    } finally {
      sandbox.cleanup();
    }
  });

  test("sandbox shims reject unexpected commands and arguments", async () => {
    const sandbox = createCliSandbox();
    try {
      const shim = join(sandbox.root, "bin", process.platform === "win32" ? "pi.cmd" : "pi");
      const result = await runCommand([shim, "install", "unexpected-package"], {
        cwd: sandbox.root,
        env: sandbox.env,
        timeoutMs: 1_000,
      });

      expect(result).toMatchObject({ code: 64, timedOut: false, cleanupConfirmed: true });
      expect(result.stderr).toContain("Unexpected pi invocation");
    } finally {
      sandbox.cleanup();
    }
  });

  test("repository containment snapshots treat absent local Deck config as stable metadata", () => {
    const repoRoot = process.cwd();
    expect(existsSync(join(repoRoot, ".deck", "config.json"))).toBe(false);
    expect(() => hashFiles(repoRoot, [".deck/config.json"])).not.toThrow();
    expect(hashFiles(repoRoot, [".deck/config.json"])).toBe(hashFiles(repoRoot, [".deck/config.json"]));
  });

  test("doctor runs and reports diagnostics", async () => {
    const sandbox = createCliSandbox();
    try {
      const result = await runDeckCommand(["doctor"], sandbox.env);
      expect(result).toMatchObject({ code: 0, timedOut: false, cleanupConfirmed: true });
      expect(result.stdout).toContain("Doctor Report");
    } finally {
      sandbox.cleanup();
    }
  }, 25_000);

  test("TUI (no args) launches with fallback output", async () => {
    const sandbox = createCliSandbox();
    try {
      const result = await runDeckCommand([], sandbox.env);
      expect(result).toMatchObject({ code: 0, timedOut: false, cleanupConfirmed: true });
      expect(result.stdout.length).toBeGreaterThan(0);
    } finally {
      sandbox.cleanup();
    }
  });

  test("outside-sandbox containment detects a child-directed write", async () => {
    const sandbox = createCliSandbox();
    const inertOutside = mkdtempSync(join(tmpdir(), "deck-binary-smoke-inert-"));
    const addressedOutside = mkdtempSync(join(tmpdir(), "deck-binary-smoke-addressed-"));
    writeFileSync(join(inertOutside, "sentinel.txt"), "outside-sandbox-sentinel");
    const inertBefore = snapshotFiles(inertOutside);
    const outsideBefore = snapshotOutsideSandbox(sandbox, { "addressed-test-boundary": addressedOutside });
    try {
      const result = await runCommand([
        process.execPath,
        "-e",
        "await Bun.write(process.env.DECK_CONTAINMENT_PROBE!, 'escaped')",
      ], {
        cwd: process.cwd(),
        env: {
          ...sandbox.env,
          DECK_CONTAINMENT_PROBE: join(addressedOutside, "escaped.txt"),
        },
        timeoutMs: 1_000,
      });

      expect(result).toMatchObject({ code: 0, timedOut: false, cleanupConfirmed: true });
      expect(snapshotFiles(inertOutside)).toEqual(inertBefore);
      const outsideAfter = snapshotOutsideSandbox(sandbox, { "addressed-test-boundary": addressedOutside });
      expect(() => assertOutsideSandboxUnchanged(outsideBefore, outsideAfter))
        .toThrow("Outside-sandbox write detected in: addressed-test-boundary");
    } finally {
      sandbox.cleanup();
      rmSync(inertOutside, { recursive: true, force: true });
      rmSync(addressedOutside, { recursive: true, force: true });
    }
  });

  test("upgrade completes from a valid empty local descriptor without payloads", async () => {
    const sandbox = createCliSandbox();
    const outsideBefore = snapshotOutsideSandbox(sandbox);
    try {
      const before = listFiles(sandbox.root);
      const result = await runDeckCommand(["upgrade", "--yes"], sandbox.env);
      expect(result).toMatchObject({ code: 0, timedOut: false, cleanupConfirmed: true });
      expect(result.stdout).toContain(`Upgrade to ${sandbox.releaseVersion} completed.`);
      const descriptor = JSON.parse(readFileSync(join(sandbox.root, "release.json"), "utf8"));
      expect(descriptor.items).toEqual([]);
      const added = listFiles(sandbox.root).filter((path) => !before.includes(path));
      expect(added.some((path) => /\.(?:zip|tar|gz|exe|bin)$/i.test(path))).toBe(false);
      assertOutsideSandboxUnchanged(outsideBefore, snapshotOutsideSandbox(sandbox));
    } finally {
      sandbox.cleanup();
    }
  }, 25_000);
});


describe("command lifecycle contract", () => {
  test("classifies a deadline as 124 only after descendant cleanup and stream EOF", async () => {
    const script = [
      "const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)']);",
      "console.log('descendant:' + child.pid);",
      "setInterval(() => {}, 1000);",
    ].join(" ");

    const result = await runCommand([process.execPath, "-e", script], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
      timeoutMs: 500,
    });

    expect(result).toMatchObject({ code: 124, timedOut: true, cleanupConfirmed: true });
    expect(result.stdout).toMatch(/descendant:\d+/);
    const pid = Number(result.stdout.match(/descendant:(\d+)/)?.[1]);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("preserves nonzero root exit and complete stdout/stderr", async () => {
    const result = await runCommand(
      [process.execPath, "-e", "console.log('stdout-eof'); console.error('stderr-eof'); process.exit(7)"],
      { cwd: process.cwd(), env: process.env as Record<string, string>, timeoutMs: 1_000 },
    );

    expect(result).toEqual({
      code: 7,
      stdout: "stdout-eof\n",
      stderr: "stderr-eof\n",
      timedOut: false,
      cleanupConfirmed: true,
    });
  });
});

describe("review repair lifecycle oracles", () => {
  for (const exitCode of [0, 7]) {
    test(`portable Windows cleanup proves descendants gone after root exit ${exitCode}`, async () => {
      const taskkillPids: number[] = [];
      const result = await runCommand(
        [process.execPath, "-e", descendantScript(exitCode)],
        {
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
          timeoutMs: 1_000,
          lifecycle: createWindowsLifecycleSimulation(taskkillPids),
        } as any,
      );

      expect(result).toMatchObject({ code: exitCode, timedOut: false, cleanupConfirmed: true });
      const descendantPid = Number(result.stdout.match(/descendant:(\d+)/)?.[1]);
      expect(descendantPid).toBeGreaterThan(0);
      expect(taskkillPids).toContain(descendantPid);
      expect(() => process.kill(descendantPid, 0)).toThrow();
    });
  }

  test("one absolute cleanup deadline cancels and settles a stalled EOF pump", async () => {
    const cleanupDeadlines: number[] = [];
    const cancellations: string[] = [];
    let settleStdout!: (value: string) => void;
    const stalledStdout = new Promise<string>((resolve) => { settleStdout = resolve; });

    const command = runCommand(
      [process.execPath, "-e", "process.exit(0)"],
      {
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        timeoutMs: 1_000,
        cleanupTimeoutMs: 25,
        onCleanupDeadline: (expiresAt: number) => cleanupDeadlines.push(expiresAt),
        streamPumpFactory: (_stream: unknown, label: string) => label === "stdout"
          ? {
              done: stalledStdout,
              snapshot: () => "",
              cancel: async () => {
                cancellations.push(label);
                settleStdout("");
              },
            }
          : {
              done: Promise.resolve(""),
              snapshot: () => "",
              cancel: async () => { cancellations.push(label); },
            },
      } as any,
    );

    await expect(command).rejects.toThrow(/stdout\/stderr EOF.*deadline|cleanup deadline/i);
    expect(cleanupDeadlines).toHaveLength(1);
    expect(cancellations).toContain("stdout");
  });
});

describe("Platform binary attributes", () => {
  test("build-info target is a valid release target", () => {
    const info = getBuildInfo();

    // Valid release targets built by scripts/build-binaries.ts.
    // Note: after a multi-target build the generated file reflects the last-built
    // target (darwin-arm64), not the current host platform. This assertion
    // verifies the target is a legitimate release target regardless of build host.
    const validTargets = [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
    ];
    expect(validTargets).toContain(info.target);
    expect(info.target).toMatch(/^(linux|darwin)-(x64|arm64)$/);
  });

  test("version is semver format", () => {
    const info = getBuildInfo();
    
    // Dev versions: 0.0.0-dev, production: x.y.z
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
