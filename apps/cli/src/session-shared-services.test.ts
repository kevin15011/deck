import { afterEach, describe, expect, test } from "bun:test";
import { getDefaultDeckConfig, type RunnerAdapter } from "@deck/core";
import { createSessionMemoryPort, resolveSessionChildMcp } from "./session-shared-services";
import type { SupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("cross-session shared services", () => {
  test("memory is lazy, scoped to one Deck session, and uses explicit host operations only", async () => {
    const config = getDefaultDeckConfig();
    config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
    const calls: unknown[] = [];
    let creations = 0;
    const port = createSessionMemoryPort({ sessionId: "s1", projectRoot: "/project", leadRunnerId: "pi" }, config, async (input) => {
      creations++;
      expect(input).toMatchObject({ sessionId: "s1", projectRoot: "/project", runnerId: "pi", role: "lead", deferInitialRecallToLoopback: true });
      return { enabled: true, explicitRecall: async (q: string) => { calls.push(["recall", q]); return { ok: true, advisoryText: "advisory", diagnostics: [] }; },
        explicitRemember: async (c: string) => { calls.push(["remember", c]); return { ok: true, diagnostics: [], metrics: [] }; },
        recordLifecycle: (...args: unknown[]) => calls.push(args),
        startLoopbackBridge: () => { throw new Error("child memory bridge is forbidden"); },
      } as unknown as SupermemoryRuntimeHost;
    });
    expect(creations).toBe(0);
    expect(await port?.recall("context")).toEqual({ ok: true, advisoryText: "advisory" });
    expect(await port?.propose("fact")).toEqual({ ok: true });
    expect(creations).toBe(1);
    await port?.close?.();
    expect(calls).toEqual([["recall", "context"], ["remember", "fact"], ["runtime-cleanup"]]);
  });

  test("disabled memory never constructs a provider runtime", () => {
    expect(createSessionMemoryPort({ sessionId: "s", projectRoot: "/p", leadRunnerId: "codex" }, getDefaultDeckConfig(), async () => { throw new Error("must not initialize"); })).toBeUndefined();
  });

  test("the production Supermemory adapter recalls and writes within its canonical project scope", async () => {
    const config = getDefaultDeckConfig(); config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
    const writes: unknown[] = [];
    const searches: unknown[] = [];
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-sm-session-")); roots.push(projectRoot);
    execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/session-fixture.git"], { cwd: projectRoot, stdio: "ignore" });
    const port = createSessionMemoryPort({ sessionId: "deck-session", projectRoot, leadRunnerId: "pi" }, config, (input) => createSupermemoryRuntimeHost({
      projectRoot: input.projectRoot, sessionId: input.sessionId, runnerId: input.runnerId,
      deckConfig: input.deckConfig, role: input.role, deferInitialRecallToLoopback: input.deferInitialRecallToLoopback,
      stateHome: projectRoot, apiKey: "fixture-only-not-networked",
      transport: { async health() {}, async profile() { return { profile: { static: ["Canonical project context"] } }; }, async search(payload) { searches.push(payload); return { results: [{ content: "Project convention" }] }; }, async add(payload) { writes.push(payload); } },
      observabilitySink: { path: "memory://fixture", healthy: true, diagnostics: [], observe() {}, health: () => ({ healthy: true, diagnostics: [] }) },
      runtimeExecutableReceiptResolver: () => ({ ok: false, diagnostics: ["fixture"] }),
    }));
    expect(await port?.recall("convention")).toMatchObject({ ok: true, advisoryText: expect.stringContaining("Project convention") });
    expect(await port?.propose("Decision: keep one daemon memory writer per Deck session and preserve canonical project isolation for every delegated child.")).toEqual({ ok: true });
    expect(searches.length).toBe(1);
    expect(writes.length).toBe(1);
    expect(JSON.stringify(writes)).not.toContain("fixture-only-not-networked");
    expect(JSON.stringify(writes)).toContain("one daemon memory writer");
    await port?.close?.();
  });

  test.each(["claude", "codex", "opencode"])("%s receives the single configured provider with secrets only in its spawn overlay", async (runnerId) => {
    const config = getDefaultDeckConfig();
    config.webSearch = { enabled: true, provider: "tavily" };
    const resolver = await resolveSessionChildMcp({ runnerId, readSessionMcpServers: async () => ({ supermemory: { command: "forbidden", args: [], env: {} }, context7: { command: "context7", args: [], env: {} } }) } as unknown as RunnerAdapter, config, { TAVILY_API_KEY: "fixture-sensitive-value" });
    expect(resolver.webSearch).toEqual({ enabled: true, serverId: "web-search" });
    expect(resolver.envOverlay).toEqual({ TAVILY_API_KEY: "fixture-sensitive-value" });
    const spec = resolver.resolveServer("web-search");
    expect(spec).toMatchObject({ command: "npx", args: ["-y", "tavily-mcp@0.2.22"], env: {} });
    expect(JSON.stringify(spec)).not.toContain("fixture-sensitive-value");
    expect(resolver.memoryProviderIds).toContain("supermemory");
    expect(resolver.runnerPackages(runnerId)).toContain("context7");
  });

  test("missing provider credentials fail before driver launch with a value-free diagnostic", async () => {
    const config = getDefaultDeckConfig(); config.webSearch = { enabled: true, provider: "tavily" };
    await expect(resolveSessionChildMcp({ runnerId: "codex" } as RunnerAdapter, config, {})).rejects.toThrow("web-search-credential-missing");
    config.webSearch.provider = "unknown";
    await expect(resolveSessionChildMcp({ runnerId: "codex" } as RunnerAdapter, config, {})).rejects.toThrow("web-search-provider-unconfigured");
  });

  test("global disable and explicit runner deselection omit web search without requiring a credential", async () => {
    const config = getDefaultDeckConfig();
    expect((await resolveSessionChildMcp({ runnerId: "codex" } as RunnerAdapter, config, {})).webSearch).toEqual({ enabled: false });
    config.webSearch = { enabled: true, provider: "tavily" };
    const resolver = await resolveSessionChildMcp({ runnerId: "claude", readSelectedCapabilityIds: () => ["context7"] } as unknown as RunnerAdapter, config, {});
    expect(resolver.webSearch).toEqual({ enabled: false });
    expect(resolver.envOverlay).toBeUndefined();
  });
});


test.each(["claude", "codex", "opencode"])("native %s never constructs daemon memory even when configured", runnerId => {
  const config = getDefaultDeckConfig(); config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
  expect(createSessionMemoryPort({ sessionId: "s", projectRoot: "/p", leadRunnerId: runnerId }, config, async () => { throw new Error("daemon memory forbidden"); })).toBeUndefined();
});
