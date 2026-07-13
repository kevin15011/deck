import { describe, expect, test } from "bun:test";
import { LastKnownGoodStore, ModelInventoryCache, buildDiscoveryFingerprint } from "./model-inventory-cache";
import type { OpenCodeDiscoveryContext } from "./model-discovery-context";
import type { RunnerModelInventory } from "@deck/core";

const inventory: RunnerModelInventory = {
  providers: [{ id: "openai", displayName: "openai", source: "runner-resolved" as const }],
  modelsByProvider: {
    openai: [{ id: "openai/a", modelId: "a", providerId: "openai", displayName: "a", variants: ["exact"], metadataSource: "runner", source: "runner-resolved" as const }],
  },
};

function context(overrides: Partial<OpenCodeDiscoveryContext> = {}): OpenCodeDiscoveryContext {
  return {
    schema: 2,
    runner: { realPath: "/bin/opencode", version: "1.17.18", stat: { logicalPath: "/bin/opencode", realPath: "/bin/opencode", exists: true, kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1, mode: 0o755, dev: 1, ino: 1, safeDigest: null, digestDisposition: "not-applicable" } },
    scope: { projectRoot: "/project", workspaceRoot: "/workspace" },
    configCandidates: [{ logicalPath: "/config/opencode.json", realPath: "/config/opencode.json", exists: true, kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1, mode: 0o600, dev: 1, ino: 2, safeDigest: "config", digestDisposition: "sanitized" }],
    authFile: { logicalPath: "/auth.json", realPath: "/auth.json", exists: true, kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1, mode: 0o600, dev: 1, ino: 3 },
    pluginFiles: [{ logicalPath: "/plugin.ts", realPath: "/plugin.ts", exists: true, kind: "file", size: 1, mtimeMs: 1, ctimeMs: 1, mode: 0o600, dev: 1, ino: 4, safeDigest: "plugin", digestDisposition: "sanitized" }],
    controlEnvironment: { OPENCODE_PURE: false }, credentialEnvironment: [{ name: "OPENAI_API_KEY", present: true }], ...overrides,
  };
}

describe("ModelInventoryCache", () => {
  test("reuses a matching entry at 4:59, refreshes at 5:00, and bypasses memory on rescan", async () => {
    let now = 0;
    let calls = 0;
    const cache = new ModelInventoryCache({ now: () => now });
    const load = async () => { calls++; return inventory; };
    await cache.getOrDiscover("fp", "prefer-cache", load);
    now = 299_999;
    expect((await cache.getOrDiscover("fp", "prefer-cache", load)).source).toBe("memory");
    now = 300_000;
    expect((await cache.getOrDiscover("fp", "prefer-cache", load)).source).toBe("live");
    await cache.getOrDiscover("fp", "rescan", load);
    expect(calls).toBe(3);
  });

  test("hashes only relevant credential presence, never credential values", async () => {
    const a = await buildDiscoveryFingerprint(context());
    const b = await buildDiscoveryFingerprint(context());
    const c = await buildDiscoveryFingerprint(context({ credentialEnvironment: [{ name: "OPENAI_API_KEY", present: false }] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("rejects snapshots with unknown fields, future timestamps, or non-private modes", async () => {
    let body = JSON.stringify({
      schemaVersion: 1,
      source: "runner-resolved",
      fingerprint: "f".repeat(64),
      discoveredAt: 100,
      inventory,
      leakedSecret: "must-not-be-accepted",
    });
    const store = new LastKnownGoodStore({
      now: () => 100,
      fs: {
        stat: async () => ({ size: body.length, mtimeMs: 100, mode: 0o600 }),
        readFile: async () => body,
        realpath: async (path) => path,
        mkdir: async () => {},
        writeFile: async () => {},
        rename: async () => {},
      },
    }, "/safe", "scope");

    expect(await store.read("f".repeat(64))).toBeUndefined();
    body = JSON.stringify({ schemaVersion: 1, source: "runner-resolved", fingerprint: "f".repeat(64), discoveredAt: 101, inventory });
    expect(await store.read("f".repeat(64))).toBeUndefined();
    body = JSON.stringify({ schemaVersion: 1, source: "runner-resolved", fingerprint: "f".repeat(64), discoveredAt: 100, inventory });
    expect(await store.read("f".repeat(64))).toEqual({ inventory, discoveredAt: 100 });
  });

  test("coalesces in-flight work, retries failures, evicts the least-recently-used fingerprint, and keeps rescans live", async () => {
    let now = 0;
    let calls = 0;
    let resolveFirst: ((value: RunnerModelInventory) => void) | undefined;
    const cache = new ModelInventoryCache({ now: () => now });
    const pending = new Promise<RunnerModelInventory>((resolve) => { resolveFirst = resolve; });
    const first = cache.getOrDiscover("shared", undefined, () => { calls++; return pending; });
    const second = cache.getOrDiscover("shared", undefined, () => { calls++; return pending; });
    expect(calls).toBe(1);
    resolveFirst?.(inventory);
    expect(await first).toMatchObject({ source: "live" });
    expect(await second).toMatchObject({ source: "live" });

    await expect(cache.getOrDiscover("retry", undefined, async () => { calls++; throw new Error("fixture failure"); })).rejects.toThrow("fixture failure");
    await expect(cache.getOrDiscover("retry", undefined, async () => { calls++; return inventory; })).resolves.toMatchObject({ source: "live" });
    for (let index = 0; index < 9; index++) {
      now++;
      await cache.getOrDiscover(`lru-${index}`, undefined, async () => inventory);
    }
    await cache.getOrDiscover("lru-0", undefined, async () => { calls++; return inventory; });
    expect(calls).toBe(4);
    expect(await cache.getOrDiscover("shared", "rescan", async () => { calls++; return inventory; })).toMatchObject({ source: "live" });
    expect(calls).toBe(5);
  });

  test("fingerprints every safe production dimension while ignoring unrelated environment", async () => {
    const base = context();
    const fingerprint = await buildDiscoveryFingerprint(base);
    await expect(buildDiscoveryFingerprint(context({ runner: { ...base.runner, realPath: "/other/opencode" } }))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context({ scope: { ...base.scope, workspaceRoot: "/other-workspace" } }))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context({ runner: { ...base.runner, version: "1.17.19" } }))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context({ configCandidates: [{ ...base.configCandidates[0]!, safeDigest: "other" }]}))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context({ authFile: { ...base.authFile, mtimeMs: 2 } }))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context({ pluginFiles: [{ ...base.pluginFiles[0]!, safeDigest: "other" }]}))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context({ credentialEnvironment: [{ name: "OPENAI_API_KEY", present: false }]}))).resolves.not.toBe(fingerprint);
    await expect(buildDiscoveryFingerprint(context())).resolves.toBe(fingerprint);
  });

  test("requires a private directory and exact LKG compatibility, then writes atomically with private modes", async () => {
    const fingerprint = "f".repeat(64);
    const directory = "/safe";
    let directoryMode = 0o755;
    let body = JSON.stringify({ schemaVersion: 1, source: "runner-resolved", fingerprint, discoveredAt: 100, inventory });
    const operations: Array<readonly unknown[]> = [];
    const store = new LastKnownGoodStore({
      now: () => 100 + 24 * 60 * 60_000,
      fs: {
        stat: async (path) => ({ size: body.length, mtimeMs: 0, mode: path === directory ? directoryMode : 0o600 }),
        readFile: async () => body,
        realpath: async (path) => path,
        lstat: async () => ({ mode: 0o600, isSymbolicLink: () => false }),
        mkdir: async (path, mode) => { operations.push(["mkdir", path, mode]); },
        writeFile: async (path, value, mode) => { operations.push(["write", path, value, mode]); },
        rename: async (from, to) => { operations.push(["rename", from, to]); },
        chmod: async (path, mode) => { operations.push(["chmod", path, mode]); },
        unlink: async (path) => { operations.push(["unlink", path]); },
      },
    }, directory, "scope");

    expect(await store.read(fingerprint)).toBeUndefined();
    directoryMode = 0o700;
    expect(await store.read(fingerprint)).toEqual({ inventory, discoveredAt: 100 });
    for (const incompatible of [
      { schemaVersion: 2, source: "runner-resolved", fingerprint, discoveredAt: 100, inventory },
      { schemaVersion: 1, source: "runner-cache", fingerprint, discoveredAt: 100, inventory },
      { schemaVersion: 1, source: "runner-resolved", fingerprint: "a".repeat(64), discoveredAt: 100, inventory },
      { schemaVersion: 1, source: "runner-resolved", fingerprint, discoveredAt: -1, inventory },
    ]) {
      body = JSON.stringify(incompatible);
      expect(await store.read(fingerprint)).toBeUndefined();
    }

    body = JSON.stringify({ schemaVersion: 1, source: "runner-resolved", fingerprint, discoveredAt: 100, inventory });
    await store.write(fingerprint, inventory, 100);
    expect(operations).toContainEqual(["mkdir", directory, 0o700]);
    expect(operations).toContainEqual(["chmod", directory, 0o700]);
    expect(operations.some(([operation, path, , mode]) => operation === "write" && String(path).startsWith(`${directory}/scope.json.`) && mode === 0o600)).toBe(true);
    expect(operations.some(([operation, from, to]) => operation === "rename" && String(from).startsWith(`${directory}/scope.json.`) && to === `${directory}/scope.json`)).toBe(true);
  });


  test("treats a missing fresh-scope file as safe while writing the first LKG snapshot", async () => {
    const fingerprint = "f".repeat(64);
    const directory = "/fresh/deck/opencode-model-inventory";
    const target = `${directory}/scope.json`;
    const operations: Array<readonly unknown[]> = [];
    const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const store = new LastKnownGoodStore({
      now: () => 100,
      fs: {
        stat: async () => ({ size: 0, mtimeMs: 0, mode: 0o700 }),
        readFile: async () => "",
        realpath: async (path) => path,
        lstat: async (path) => {
          if (path === target) throw missing;
          return { mode: 0o700, isSymbolicLink: () => false };
        },
        mkdir: async (path, mode) => { operations.push(["mkdir", path, mode]); },
        writeFile: async (path, body, mode) => { operations.push(["write", path, body, mode]); },
        rename: async (from, to) => { operations.push(["rename", from, to]); },
      },
    }, directory, "scope");

    await expect(store.write(fingerprint, inventory, 100)).resolves.toBeUndefined();
    expect(operations).toContainEqual(["mkdir", directory, 0o700]);
    expect(operations.some(([operation, path, , mode]) => operation === "write" && String(path).startsWith(`${target}.`) && mode === 0o600)).toBe(true);
  });


  test("propagates unexpected LKG filesystem errors instead of treating them as cache misses", async () => {
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const store = new LastKnownGoodStore({
      now: () => 100,
      fs: {
        stat: async () => ({ size: 0, mtimeMs: 0, mode: 0o700 }),
        readFile: async () => "",
        realpath: async (path) => path,
        lstat: async () => { throw denied; },
        mkdir: async () => {},
        writeFile: async () => {},
        rename: async () => {},
      },
    }, "/restricted", "scope");

    await expect(store.read("f".repeat(64))).rejects.toBe(denied);
  });
});
