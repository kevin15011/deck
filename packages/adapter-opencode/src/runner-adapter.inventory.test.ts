import { describe, expect, test } from "bun:test";
import { createDefaultOpenCodeInventoryDiscovery, createOpenCodeRunnerAdapter } from "./runner-adapter";
import type { RunnerModelInventoryResult } from "@deck/core";

const ready: Extract<RunnerModelInventoryResult, { state: "ready" }> = {
  state: "ready", source: "live", discoveredAt: 1, fingerprint: "fresh", inventory: {
    providers: [{ id: "openai", displayName: "openai", source: "runner-resolved" }],
    modelsByProvider: { openai: [{ id: "openai/exact", providerId: "openai", modelId: "exact", displayName: "exact", variants: ["CaseSensitive"], metadataSource: "runner", source: "runner-resolved" }, { id: "openai/zero", providerId: "openai", modelId: "zero", displayName: "zero", variants: [], metadataSource: "runner", source: "runner-resolved" }] },
  },
};

function productionFakes() {
  let runner = "/fixture/bin/opencode";
  let workspace = "/fixture";
  let configMtime = 1;
  let authMtime = 1;
  let pluginMtime = 1;
  const env: Record<string, string | undefined> = { OPENAI_API_KEY: "one", PATH: "/fixture/bin" };
  let config = '{"providers":{"openai":{"env":"OPENAI_API_KEY","model":"gpt-4.1"}},"plugins":["./plugin.ts"]}';
  const writes: string[] = [];
  let verboseCalls = 0;
  const fs = {
    realpath: async (path: string) => path,
    stat: async (path: string) => ({ size: 1, mtimeMs: path.endsWith("auth.json") ? authMtime : path.endsWith("plugin.ts") ? pluginMtime : path.endsWith("opencode.json") ? configMtime : 1, ctimeMs: 1, mode: path.includes("opencode-model-inventory") ? 0o700 : 0o600, isFile: () => !path.endsWith("inventory"), isDirectory: () => path.endsWith("inventory") }),
    readFile: async (path: string) => path.endsWith("opencode.json") ? config : path.endsWith("plugin.ts") ? "export const plugin = 'private';" : (() => { throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" }); })(),
    readdir: async () => [], mkdir: async () => {}, writeFile: async (path: string) => { writes.push(path); }, rename: async () => {}, chmod: async () => {}, lstat: async () => ({ mode: 0o600, isSymbolicLink: () => false }), unlink: async () => {},
  };
  const commandRunner = { run: async (request: { args: readonly string[] }) => {
    if (request.args[0] === "--version") return { exitCode: 0, signal: null, stdout: "1.17.18", stderr: "" };
    verboseCalls++;
    return { exitCode: 0, signal: null, stdout: 'openai/exact\n{"providerID":"openai","variants":{"Exact":{}}}', stderr: "" };
  } };
  return { fakes: { commandRunner, fs, now: () => 1_000, env, homeDir: "/fixture/home", xdgConfigHome: "/fixture/config", xdgDataHome: "/fixture/data", xdgCacheHome: "/fixture/cache", resolveExecutable: async () => runner, resolveWorkspaceRoot: async () => workspace, resolvePluginEntry: async (reference: string, from: string) => reference.startsWith(".") ? `${from}/${reference.slice(2)}` : null }, writes, calls: () => verboseCalls, mutate: { runner: (value: string) => { runner = value; }, workspace: (value: string) => { workspace = value; }, config: () => { configMtime++; }, configContent: (value: string) => { config = value; }, auth: () => { authMtime++; }, plugin: () => { pluginMtime++; }, env: (value: Record<string, string | undefined>) => { for (const key of Object.keys(env)) delete env[key]; Object.assign(env, value); } } };
}

describe("OpenCode adapter dynamic inventory", () => {
  test("uses the default production composition for safe invalidation and runner/project LKG scope", async () => {
    const proof = productionFakes();
    const adapter = createOpenCodeRunnerAdapter({ productionDiscoveryDependencies: proof.fakes });
    const get = (projectRoot = "/fixture/project") => adapter.getModelInventory?.({ projectRoot });
    await get(); expect(proof.calls()).toBe(1);
    proof.mutate.config(); await get(); expect(proof.calls()).toBe(2);
    proof.mutate.auth(); await get(); expect(proof.calls()).toBe(3);
    proof.mutate.plugin(); await get(); expect(proof.calls()).toBe(4);
    proof.mutate.workspace("/fixture/workspace-b"); await get(); expect(proof.calls()).toBe(5);
    proof.mutate.runner("/fixture/bin/opencode-b"); await get(); expect(proof.calls()).toBe(6);
    await get("/fixture/project-b"); expect(proof.calls()).toBe(7);
    proof.mutate.env({ OPENAI_API_KEY: "two", PATH: "/fixture/bin", UNRELATED: "changed" }); await get("/fixture/project-b");
    expect(proof.calls()).toBe(7);
    proof.mutate.configContent('{"providers":{"custom-provider":{"env":"OPENAI_API_KEY","model":"gpt-4.2","options":{"token":"secret"}}},"plugins":["./plugin-b.ts"],"controlPath":"/fixture/alternate"}');
    await get("/fixture/project-b"); expect(proof.calls()).toBe(8);
    proof.mutate.env({ PATH: "/fixture/bin", UNRELATED: "changed" }); await get("/fixture/project-b");
    expect(proof.calls()).toBe(9);
    proof.mutate.env({ PATH: "/fixture/bin", UNRELATED: "another-change" }); await get("/fixture/project-b");
    expect(proof.calls()).toBe(9);

    proof.mutate.configContent('{"providers":{"custom-provider":{"options":{"baseURL":"https://one.example","bearer":"secret-one"}}}}');
    await get("/fixture/project-b"); expect(proof.calls()).toBe(10);
    proof.mutate.configContent('{"providers":{"custom-provider":{"options":{"baseURL":"https://two.example","bearer":"secret-one"}}}}');
    await get("/fixture/project-b"); expect(proof.calls()).toBe(11);
    proof.mutate.configContent('{"providers":{"custom-provider":{"options":{"baseURL":"https://two.example","bearer":"secret-two"}}}}');
    await get("/fixture/project-b"); expect(proof.calls()).toBe(11);

    proof.mutate.env({ PATH: "/fixture/bin", OPENCODE_CONFIG_CONTENT: '{"providers":{"virtual":{"env":"CUSTOM_PROVIDER_TOKEN"}},"plugins":["./virtual-plugin.ts"]}' });
    await get("/fixture/project-b"); expect(proof.calls()).toBe(12);
    proof.mutate.env({ PATH: "/fixture/bin", CUSTOM_PROVIDER_TOKEN: "present", OPENCODE_CONFIG_CONTENT: '{"providers":{"virtual":{"env":"CUSTOM_PROVIDER_TOKEN"}},"plugins":["./virtual-plugin.ts"]}' });
    await get("/fixture/project-b"); expect(proof.calls()).toBe(13);
    proof.mutate.env({ PATH: "/fixture/bin", CUSTOM_PROVIDER_TOKEN: "present", UNRELATED: "another-change", OPENCODE_CONFIG_CONTENT: '{"providers":{"virtual":{"env":"CUSTOM_PROVIDER_TOKEN"}},"plugins":["./virtual-plugin.ts"]}' });
    await get("/fixture/project-b"); expect(proof.calls()).toBe(13);
    expect(new Set(proof.writes.map((path) => path.replace(/\.[a-f0-9]{32}\.tmp$/, ""))).size).toBeGreaterThan(2);
  });

  test("discovers runner models and variants on a fresh installation without a Deck cache directory", async () => {
    const proof = productionFakes();
    const cacheDirectory = "/fixture/cache/deck/opencode-model-inventory";
    const originalFs = proof.fakes.fs;
    let cacheDirectoryExists = false;
    const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: "ENOENT" });
    const fs = {
      ...originalFs,
      stat: async (path: string) => {
        if (path.startsWith(cacheDirectory)) {
          if (!cacheDirectoryExists) throw missing(path);
          return { size: 0, mtimeMs: 0, ctimeMs: 0, mode: path === cacheDirectory ? 0o700 : 0o600, isFile: () => path !== cacheDirectory, isDirectory: () => path === cacheDirectory };
        }
        return originalFs.stat(path);
      },
      lstat: async (path: string) => {
        if (path.startsWith(cacheDirectory)) {
          if (path === cacheDirectory && cacheDirectoryExists) return { mode: 0o700, isSymbolicLink: () => false };
          throw missing(path);
        }
        return originalFs.lstat();
      },
      mkdir: async (path: string, mode: number) => {
        if (path === cacheDirectory && mode === 0o700) cacheDirectoryExists = true;
        await originalFs.mkdir();
      },
    };
    const adapter = createOpenCodeRunnerAdapter({ productionDiscoveryDependencies: { ...proof.fakes, fs } });

    const result = await adapter.getModelInventory?.({ projectRoot: "/fixture/project" });

    expect(result).toMatchObject({ state: "ready", source: "live", inventory: { modelsByProvider: { openai: [{ id: "openai/exact", variants: ["Exact"] }] } } });
    expect(proof.calls()).toBe(1);
  });

  test("invalidates default discovery when embedded credentials become present but not when values change", async () => {
    const proof = productionFakes();
    proof.mutate.configContent('{"providers":{"custom":{"options":{"token":"Bearer {env:EMBEDDED_DEFAULT_TOKEN}"}}}}');
    const adapter = createOpenCodeRunnerAdapter({ productionDiscoveryDependencies: proof.fakes });
    const get = () => adapter.getModelInventory?.({ projectRoot: "/fixture/project" });

    await get();
    expect(proof.calls()).toBe(1);
    proof.mutate.env({ PATH: "/fixture/bin", EMBEDDED_DEFAULT_TOKEN: "first-secret" });
    await get();
    expect(proof.calls()).toBe(2);
    proof.mutate.env({ PATH: "/fixture/bin", EMBEDDED_DEFAULT_TOKEN: "second-secret" });
    await get();
    expect(proof.calls()).toBe(2);
  });

  test("makes full default discovery settle at the absolute 15,000 ms deadline", async () => {
    let now = 0, id = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const advance = (target: number) => { while (true) { const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].callback(); } now = target; };
    const base = productionFakes().fakes;
    const fakes = {
      ...base,
      now: () => now,
      timers: { setTimeout: (callback: () => void, delay: number) => { const timer = ++id; timers.set(timer, { at: now + delay, callback }); return timer as unknown as ReturnType<typeof setTimeout>; }, clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer as unknown as number); } },
      commandRunner: { run: async (request: { args: readonly string[] }) => request.args[0] === "--version" ? { exitCode: 0, signal: null, stdout: "1", stderr: "" } : await new Promise<never>(() => {}) },
    };
    const result = createDefaultOpenCodeInventoryDiscovery(fakes)({ projectRoot: "/fixture/project" });
    for (let step = 0; step < 8; step++) await Promise.resolve();
    advance(14_999);
    let settled = false; void result.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
    advance(15_000); await expect(result).resolves.toMatchObject({ state: "blocked", error: { code: "timeout" } });
  });
  test("propagates ready data and validates exact changed assignments only", async () => {
    const adapter = createOpenCodeRunnerAdapter({ inventoryDiscovery: async () => ready });
    expect(await adapter.getModelInventory?.({ projectRoot: "/workspace" })).toBe(ready);
    expect(adapter.getThinkingLevels("openai/exact")).toEqual(["CaseSensitive"]);
    expect(adapter.getThinkingLevels("exact")).toEqual([]);
    expect(await adapter.validateModelAssignments?.({ projectRoot: "/workspace", modelAssignments: { changed: "openai/exact", untouched: "missing/model" }, thinkingAssignments: { changed: "CaseSensitive", untouched: "old" }, changedAgentIds: ["changed"], expectedFingerprint: "fresh" })).toEqual({ valid: true, fingerprint: "fresh" });
    const invalid = await adapter.validateModelAssignments?.({ projectRoot: "/workspace", modelAssignments: { changed: "openai/exact" }, thinkingAssignments: { changed: "casesensitive" }, changedAgentIds: ["changed"] });
    expect(invalid).toMatchObject({ valid: false, issues: [{ code: "variant-unavailable" }] });
  });

  test("blocks writes for stale or blocked inventories", async () => {
    const adapter = createOpenCodeRunnerAdapter({ inventoryDiscovery: async () => ({ state: "stale", source: "last-known-good", discoveredAt: 1, fingerprint: "old", inventory: ready.inventory, error: { code: "timeout", message: "timed out", retryable: true } }) });
    expect(await adapter.validateModelAssignments?.({ projectRoot: "/workspace", modelAssignments: { changed: "openai/exact" }, thinkingAssignments: {}, changedAgentIds: ["changed"] })).toMatchObject({ valid: false, issues: [{ code: "inventory-not-ready" }] });
  });

  test("keeps a runner-only non-canonical variant exact through live validation", async () => {
    const adapter = createOpenCodeRunnerAdapter({ inventoryDiscovery: async () => ({
      ...ready,
      inventory: {
        providers: [{ id: "runner-plugin", displayName: "Runner Plugin", source: "runner-resolved" }],
        modelsByProvider: {
          "runner-plugin": [{
            id: "runner-plugin/runner-only-model",
            providerId: "runner-plugin",
            modelId: "runner-only-model",
            displayName: "Runner-only Model",
            variants: ["exact/runner-key"],
            metadataSource: "runner",
            source: "runner-resolved",
          }],
        },
      },
    }) });
    await adapter.getModelInventory?.({ projectRoot: "/workspace", mode: "rescan" });

    expect(adapter.resolveThinking("runner-plugin/runner-only-model", "exact/runner-key")).toBe("exact/runner-key");
    expect(await adapter.validateModelAssignments?.({
      projectRoot: "/workspace",
      modelAssignments: { changed: "runner-plugin/runner-only-model" },
      thinkingAssignments: { changed: "exact/runner-key" },
      changedAgentIds: ["changed"],
      expectedFingerprint: "fresh",
    })).toEqual({ valid: true, fingerprint: "fresh" });
  });
});
