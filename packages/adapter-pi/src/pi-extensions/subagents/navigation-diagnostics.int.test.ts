import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureNavigationFailure } from "./navigation-diagnostics.test-support";
import { childSessionPath } from "./storage";

test("failure evidence retains terminal/header/IPC identity, redacts secrets and leaves ownership intact", () => {
  const root = mkdtempSync(join(tmpdir(), "dnav-evidence-"));
  const parentFile = join(root, "parent.jsonl"), childLog = join(root, "log");
  const job = { parent: "parent", childId: "child", state: "failed", failureKind: "ownership_unsettled", exitCode: 1, output: "Bearer fixture-secret" };
  const file = childSessionPath(parentFile, job.parent, job.childId);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ type: "session", id: "child", deckParent: "parent", deckTaskId: "task" }) + "\n", { mode: 0o600 });
  writeFileSync(childLog, JSON.stringify({ pid: 123, argv: ["private-prompt"], env: { PASSWORD: "fixture-secret" } }), { mode: 0o600 });
  const lease = JSON.stringify({ version: 2, effectsUncertain: false, nonce: "fixture-secret", parentId: "parent", taskId: "task", parent: { pid: process.pid } });
  writeFileSync(file + ".execution", lease, { mode: 0o600 });
  mkdirSync(file + ".execution.gate", { mode: 0o700 });
  const prior = Reflect.get(globalThis, "__deckPiNavigationTrace");
  Reflect.set(globalThis, "__deckPiNavigationTrace", () => ({ events: [{ stage: "ipc", type: "deck_child_exit", code: 0 }, { stage: "close", signal: "SIGKILL" }] }));
  let artifact: string | undefined;
  try {
    artifact = captureNavigationFailure({ cwd: root, parentFile, childLog, job, accepted: { token: "fixture-secret" }, journal: [job], controls: {} });
    const raw = readFileSync(artifact, "utf8"), parsed = JSON.parse(raw);
    expect(raw).not.toContain("fixture-secret");
    expect(raw).not.toContain("private-prompt");
    expect(JSON.parse(parsed.job.text).failureKind).toBe("ownership_unsettled");
    expect(parsed.history.lines[0]).toEqual({ type: "session", id: "child", deckParent: "parent", deckTaskId: "task" });
    expect(JSON.parse(parsed.trace.text).events[0]).toEqual({ stage: "ipc", type: "deck_child_exit", code: 0 });
    expect(readFileSync(file + ".execution", "utf8")).toBe(lease);
    expect(existsSync(file + ".execution.gate")).toBe(true);
    expect(statSync(dirname(artifact)).mode & 0o777).toBe(0o700);
    expect(statSync(artifact).mode & 0o777).toBe(0o600);
  } finally {
    if (prior === undefined) Reflect.deleteProperty(globalThis, "__deckPiNavigationTrace"); else Reflect.set(globalThis, "__deckPiNavigationTrace", prior);
    if (artifact) rmSync(dirname(artifact), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing job and oversized or symlinked input cannot expose raw history", () => {
  const root = mkdtempSync(join(tmpdir(), "dnav-missing-"));
  const parentFile = join(root, "parent.jsonl"), childLog = join(root, "log"), target = join(root, "target");
  writeFileSync(target, "private-history".repeat(6000));
  symlinkSync(target, childLog);
  const artifact = captureNavigationFailure({ cwd: root, parentFile, childLog, accepted: "x".repeat(4096), journal: [], controls: {} });
  let oversized: string | undefined;
  try {
    const raw = readFileSync(artifact, "utf8"), parsed = JSON.parse(raw);
    expect(parsed.accepted.truncated).toBe(true);
    expect(parsed.childLog.metadata.symlink).toBe(true);
    expect(parsed.childLog.sha256).toBeUndefined();
    expect(raw).not.toContain("private-history");
    expect(parsed.history.metadata.error).toBe("ENOENT");
    oversized = captureNavigationFailure({ cwd: root, parentFile, childLog: target, accepted: {}, journal: [], controls: {} });
    const large = JSON.parse(readFileSync(oversized, "utf8"));
    expect(large.childLog.metadata.size).toBeGreaterThan(64 * 1024);
    expect(large.childLog.sha256).toBeUndefined();
    expect(large.childLog.error).toContain("Unsafe diagnostic input");
  } finally { if (oversized) rmSync(dirname(oversized), { recursive: true, force: true }); rmSync(dirname(artifact), { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("FIFO inputs refuse promptly; original error/cleanup survive and growing reads stay bounded", async () => {
  const probe = fileURLToPath(new URL("../../__fixtures__/navigation-diagnostic-input.ts", import.meta.url));
  for (const mode of ["lease", "history", "log", "growth"]) {
    const root = mkdtempSync(join(tmpdir(), "dnav-input-")), project = join(root, "project");
    const parentFile = join(project, "parent.jsonl"), childLog = join(project, "log");
    const job = { parent: "parent", childId: "child", state: "failed" };
    const file = childSessionPath(parentFile, job.parent, job.childId);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, '{"type":"session","id":"child"}\n', { mode: 0o600 });
    writeFileSync(childLog, '{"pid":1}\n', { mode: 0o600 });
    const target = mode === "lease" ? file + ".execution" : mode === "history" ? file : childLog;
    if (mode !== "growth") {
      rmSync(target, { force: true });
      expect(Bun.spawnSync(["mkfifo", "-m", "600", target]).exitCode).toBe(0);
    }
    writeFileSync(join(root, "input.json"), JSON.stringify({ mode, project, growthTarget: target,
      input: { cwd: project, parentFile, childLog, job, accepted: {}, journal: [job], controls: {} } }));
    const child = Bun.spawn([process.execPath, probe], { env: {
      DECK_PI_NAV_DIAGNOSTIC_FIXTURE_ROOT: root,
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, CODEX_HOME: join(root, "codex"), TMPDIR: root,
      XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_CACHE_HOME: root,
    }, stdout: "pipe", stderr: "pipe" });
    let watchdogFired = false;
    const watchdog = setTimeout(() => { watchdogFired = true; child.kill("SIGKILL"); }, 1500);
    try {
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ mode, watchdogFired, code, stdout, stderr }).toEqual({ mode, watchdogFired: false, code: 0, stdout: "", stderr: "" });
      const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
      expect(result.originalErrorPreserved).toBe(true);
      expect(JSON.parse(readFileSync(join(root, "cleanup.json"), "utf8"))).toEqual({ finallyRan: true, originalErrorPreserved: true });
      expect(existsSync(project)).toBe(false);
      const artifact = JSON.parse(readFileSync(result.artifact, "utf8"));
      if (mode === "lease") { expect(artifact.lease.metadata.file).toBe(false); expect(artifact.lease.value).toBeUndefined(); }
      else {
        const summary = mode === "history" ? artifact.history : artifact.childLog;
        expect(summary.sha256).toBeUndefined();
        expect(summary.error).toContain("Unsafe diagnostic input");
      }
      if (mode === "growth") {
        expect(result.reads.length).toBeGreaterThan(0);
        expect(result.reads.reduce((sum: number, item: any) => sum + item.received, 0)).toBeLessThanOrEqual(65537);
      }
    } finally { clearTimeout(watchdog); child.kill("SIGKILL"); rmSync(root, { recursive: true, force: true }); }
  }
}, 10000);
