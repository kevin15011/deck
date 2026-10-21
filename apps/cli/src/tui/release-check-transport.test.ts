import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_RELEASE_CHECK_TIMEOUT_MS } from "./release-check";

const probe = resolve(import.meta.dir, "../upgrade-command/__tests__/fixtures/release-check-probe.ts");
async function exercise(mode: string, check: (result: any, root: string, children: { pid: number; api: boolean }[]) => void) {
  const root = mkdtempSync(join(tmpdir(), "drc-probe-"));
  const child = Bun.spawn([process.execPath, probe], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, CODEX_HOME: join(root, "codex"),
      XDG_CONFIG_HOME: root, XDG_STATE_HOME: root, XDG_CACHE_HOME: root, TMPDIR: root,
      RELEASE_PROBE_ROOT: root, RELEASE_PROBE_MODE: mode,
    }, stdout: "pipe", stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 8000);
  let children: { pid: number; api: boolean }[] = [];
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
    if (existsSync(join(root, "children.jsonl"))) children = readFileSync(join(root, "children.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    // The caller must exit naturally after closing/reaping every directly owned curl.
    for (const entry of children) expect(() => process.kill(entry.pid, 0)).toThrow();
    check(JSON.parse(readFileSync(join(root, "result.json"), "utf8")), root, children);
  } finally {
    clearTimeout(deadline);
    child.kill("SIGKILL");
    for (const entry of children) { try { process.kill(entry.pid, "SIGKILL"); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
}

// These executable fixtures need POSIX exec; production transport itself uses no shell.
const localTest = process.platform === "win32" ? test.skip : test;
localTest("default 5000ms deadline remains responsive and kills/reaps held local curl", async () => {
  expect(DEFAULT_RELEASE_CHECK_TIMEOUT_MS).toBe(5000);
  await exercise("hold", (result, root, children) => {
    expect(result.state).toEqual({ kind: "network-error", error: "Release check timed out after 5000ms" });
    expect(result.beats).toBeGreaterThan(20);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(4900);
    expect(result.elapsedMs).toBeLessThan(6000);
    expect(children).toHaveLength(1);
    expect(existsSync(join(root, "deck/releases/latest-release.json"))).toBe(false);
  });
}, 10000);

localTest("preabort spawns nothing; active API/asset cancellation cleans up without fallback/cache", async () => {
  for (const mode of ["preabort", "cancel", "asset-abort"]) await exercise(mode, (result, root, children) => {
    expect(result.state.kind).toBe(mode === "asset-abort" ? "cancelled" : "network-error");
    expect(children).toHaveLength(mode === "preabort" ? 0 : mode === "asset-abort" ? 2 : 1);
    expect(existsSync(join(root, "cache.json"))).toBe(false);
  });
}, 10000);

localTest("async transport preserves sync descriptor/cache/legacy/error validation", async () => {
  for (const mode of ["success", "sync", "invalid", "mismatch", "missing", "api-error"]) await exercise(mode, (result, root, children) => {
    if (mode === "success" || mode === "sync") {
      expect(result.state.kind).toBe("descriptor");
      expect(result.state.commit).toBe("abcdef1234567");
      expect(JSON.parse(readFileSync(join(root, "cache.json"), "utf8")).version).toBe("99.0.0");
    } else {
      expect(existsSync(join(root, "cache.json"))).toBe(false);
      expect(result.state.kind).toBe(mode === "api-error" ? "network-error" : "legacy");
      if (mode !== "api-error") expect(result.state.reason).toBe(mode === "missing" ? "missing" : "invalid");
    }
    expect(children).toHaveLength(mode === "missing" || mode === "api-error" ? 1 : 2);
  });
}, 10000);
