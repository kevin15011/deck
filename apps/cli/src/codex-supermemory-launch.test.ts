import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCodexRunnerAdapter } from "@deck/adapter-codex";
import { storeOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import { createOwnerOnlyFileSecretStore, getDefaultDeckConfig } from "@deck/core";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { readyTestTools } from "../../../packages/adapter-codex/src/test-tools";
import { runRunnerLaunch } from "./runner-launch-command";
import {
  VERIFIED_CODEX_SUPERMEMORY_BINDING,
  assertCodexSupermemoryReady,
  buildCodexSupermemoryLaunchOverlay,
  resolveCodexSupermemoryLaunchCredential,
} from "./codex-supermemory-launch";

import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";

/** The official-plugin route never reaches Deck's runtime transport; the stub proves it stays unused and isolated. */
const fakeTransport = {} as unknown as SupermemoryRuntimeTransport;
const TOKEN = "sm_codex_profile_SHOULD_NOT_LEAK_0123456789";
setDefaultTimeout(30_000);
const created: string[] = [];
afterEach(() => { for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true }); });

function temp(prefix: string): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(path);
  return path;
}

function fixture(options: { userHooks?: string; userConfig?: string; projectHooksJson?: string; webSearch?: boolean; memoryTools?: boolean } = {}) {
  const projectRoot = temp("deck-codex-sm-launch-project-");
  execFileSync("git", ["init", "-q"], { cwd: projectRoot });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:kevin15011/deck.git"], { cwd: projectRoot });
  const configHome = temp("deck-codex-sm-launch-secrets-");
  const store = createOwnerOnlyFileSecretStore({ configHome });
  storeOpenCodeSupermemoryCredential({ store, token: TOKEN, makeDefault: true, eligibleAliases: [] });
  const tools = readyTestTools({ supermemory: true, ...(options.webSearch ? { resolveCommand: (name: string) => name === "context-mode" || name === "npx" ? process.execPath : undefined } : {}) });
  const codexHome = join(tools.homeDir!, ".codex");
  mkdirSync(codexHome, { recursive: true });
  if (options.userHooks) writeFileSync(join(codexHome, "hooks.json"), options.userHooks);
  if (options.userConfig) writeFileSync(join(codexHome, "config.toml"), options.userConfig);
  if (options.projectHooksJson) { mkdirSync(join(projectRoot, ".codex"), { recursive: true }); writeFileSync(join(projectRoot, ".codex", "hooks.json"), options.projectHooksJson); }
  const effects = {
    home: tools.homeDir!,
    codexHome,
    store,
    tools,
    origin: () => "git@github.com:kevin15011/deck.git",
    discoverAliases: () => ({ aliases: [], ambiguousAliases: [], status: "trusted" as const }),
  };
  const adapter = createCodexRunnerAdapter({
    tools,
    userHome: tools.homeDir!,
    codexHome,
    journalRoot: temp("deck-codex-sm-launch-journal-"),
    preflight: {
      probe: async () => ({ found: true, version: "0.159.3", help: "Usage: codex [OPTIONS]\n--dangerously-bypass-hook-trust\n", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
      inspectTrust: async () => "trusted",
      readProject: async (root) => ({ config: await Bun.file(join(root, ".codex", "config.toml")).text().catch(() => null), roles: [], skills: [], agentsInstructions: false }),
    },
    codebaseIndexReadiness: () => true,
    ...(options.memoryTools ? { deckMemoryMcpCommand: ["/opt/deck/deck", "internal", "memory-mcp"] } : {}),
    ...(options.webSearch ? { webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR, webSearchCredential: () => "tvly-test-credential-value" } : {}),
  });
  return { projectRoot, effects, adapter, store, stateHome: temp("deck-codex-sm-launch-state-") };
}

type DeckCfg = ReturnType<typeof getDefaultDeckConfig>;
const memoryConfig = (): DeckCfg => {
  const config = getDefaultDeckConfig();
  config.packageInstructions.codex.serena = false;
  return { ...config, adaptiveMemory: { enabled: true, activeProvider: "supermemory" } };
};

async function launch(f: ReturnType<typeof fixture>, extra: { env?: Record<string, string>; deckConfig?: DeckCfg; transport?: SupermemoryRuntimeTransport; onSpawn?: (env: Record<string, string>) => Promise<void> } = {}) {
  let childEnv: Record<string, string> | undefined;
  let childArgs: readonly string[] = [];
  const previews: string[] = [];
  // This suite verifies memory hooks, not Serena provisioning; never run its external probes.
  const selected = extra.deckConfig ?? memoryConfig();
  const deckConfig = { ...selected, packageInstructions: { ...selected.packageInstructions, codex: { ...selected.packageInstructions.codex, serena: false } } };
  const result = await runRunnerLaunch({
    adapter: f.adapter,
    launch: { projectRoot: f.projectRoot, teamId: "developer-team", mode: "interactive", deckConfig },
    interactive: false,
    yes: true,
    presentPreview: async (preview) => { previews.push(preview); },
    codexSupermemoryLaunchEffects: f.effects,
    supermemoryRuntime: { transport: extra.transport ?? fakeTransport, stateHome: f.stateHome },
    processEffects: {
      inheritedEnv: { PATH: "/bin", ...extra.env },
      spawn: async (_command, args, options) => { childEnv = options.env; childArgs = args; await extra.onSpawn?.(options.env); return { exitCode: 0, stdout: "", stderr: "" }; },
    },
  });
  return { result, childEnv, childArgs, previews };
}

describe("official Codex Supermemory plugin launch", () => {
  test("injects the stored profile credential into the child process only and never starts Deck's memory host or writes the token", async () => {
    const f = fixture();
    const { result, childEnv, childArgs } = await launch(f, { env: { SUPERMEMORY_CODEX_API_KEY: "stale-parent", SUPERMEMORY_REPO_TAG: "stale", DECK_RUNNER_MEMORY_TOKEN: "stale-loopback", OPENAI_API_KEY: "sk-parent-should-be-stripped-12345" } });
    expect(result.status).toBe("launched");
    expect(childEnv?.SUPERMEMORY_CODEX_API_KEY).toBe(TOKEN);
    expect(childEnv?.SUPERMEMORY_API_URL).toBe("https://api.supermemory.ai");
    expect(childEnv?.SUPERMEMORY_REPO_TAG).toMatch(/^sm_project_v1_/);
    expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_TOKEN");
    expect(childEnv).not.toHaveProperty("DECK_CODEX_BRIDGE_TOKEN");
    expect(childEnv).not.toHaveProperty("OPENAI_API_KEY");
    expect(childArgs.join(" ")).not.toContain(TOKEN);
    expect(childArgs.slice(0, 2)).toEqual(["--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust"]);
    const printed = JSON.stringify(result);
    expect(printed).not.toContain(TOKEN);
    expect(printed).toContain("[REDACTED]");
    expect(printed).toContain("codex-supermemory-profile");
    expect(existsSync(join(f.projectRoot, ".codex")), "no project files are created").toBe(false);
    expect(existsSync(join(f.projectRoot, ".agents"))).toBe(false);
    const config = await Bun.file(join(f.effects.codexHome, "config.toml")).text();
    expect(config).toContain("deck-codex-hook:supermemory:start");
    expect(config).not.toContain("memory-bridge");
    expect(config).not.toContain(TOKEN);
    expect(config).not.toContain("mcp_servers.supermemory");
    for (const file of ["hooks.json", "config.toml"]) expect(await Bun.file(join(f.effects.codexHome, file)).text().catch(() => "")).not.toContain(TOKEN);
  });

  test("with the Deck memory MCP entry installed the launch also serves explicit memory tools through a token-file loopback bound to the plugin's tag", async () => {
    const f = fixture({ memoryTools: true });
    const searches: string[] = [];
    const adds: string[] = [];
    const transport: SupermemoryRuntimeTransport = {
      async health() {},
      async profile() { return { profile: {} }; },
      async search(payload) { searches.push(payload.containerTag); return { results: [{ content: "Convention: Codex memory tools share the plugin tag." }] }; },
      async add(payload) { adds.push(payload.containerTag); },
    };
    let tokenFile = "";
    let endpoint = "";
    let seenEnv: Record<string, string> = {};
    let searchResult: any;
    let readOnlySave: any;
    let leadSave: any;
    const { result, childEnv } = await launch(f, {
      transport,
      onSpawn: async (env) => {
        seenEnv = env;
        tokenFile = env.DECK_RUNNER_MEMORY_TOKEN_FILE!;
        endpoint = env.DECK_RUNNER_MEMORY_ENDPOINT!;
        const token = (await Bun.file(tokenFile).text()).trim();
        const post = async (body: Record<string, unknown>) => (await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "codex", timestamp: Date.now(), sessionId: "codex-mcp-test", ...body }) })).json();
        searchResult = await post({ eventId: "s1", event: "search", role: "lead", query: "what is the convention" });
        readOnlySave = await post({ eventId: "s2", event: "save", role: "quality", content: "Decision: a read-only role must not be able to save into project memory." });
        leadSave = await post({ eventId: "s3", event: "save", role: "lead", content: "Decision: the Codex memory tools persist through the shared loopback host." });
      },
    });
    expect(result.status, JSON.stringify(result).slice(0, 1500)).toBe("launched");
    expect(seenEnv.SUPERMEMORY_CODEX_API_KEY).toBe(TOKEN);
    expect(seenEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_TOKEN");
    expect(seenEnv).not.toHaveProperty("DECK_CODEX_BRIDGE_TOKEN");
    expect(JSON.stringify(seenEnv)).not.toContain("deck-loopback-");
    expect(searchResult.ok).toBe(true);
    expect(searchResult.advisoryText).toContain("share the plugin tag");
    expect(readOnlySave).toMatchObject({ ok: false, diagnostics: ["role-not-permitted"] });
    expect(leadSave.ok).toBe(true);
    expect(searches).toEqual([seenEnv.SUPERMEMORY_REPO_TAG!]);
    expect(adds).toEqual([seenEnv.SUPERMEMORY_REPO_TAG!]);
    // Cleanup: no bearer left on disk and the host is gone once Codex exits.
    expect(existsSync(tokenFile)).toBe(false);
    await expect(fetch(endpoint, { method: "POST", body: "{}" })).rejects.toThrow();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(childEnv).toBeDefined();
    const config = await Bun.file(join(f.effects.codexHome, "config.toml")).text();
    expect(config).toContain("# deck-codex-mcp:deck-memory");
    expect(config).not.toMatch(/deck-loopback-/);
  });

  test("the memory tools do not start a host when the entry is not installed", async () => {
    const f = fixture();
    const { childEnv } = await launch(f);
    expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_ENDPOINT");
    expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_TOKEN_FILE");
  });

  test("an unreachable provider leaves the launch and the plugin hooks untouched, without loopback variables", async () => {
    const g = fixture({ memoryTools: true });
    const down: SupermemoryRuntimeTransport = { async health() { throw new Error("offline"); }, async profile() { throw new Error("offline"); }, async search() { throw new Error("offline"); }, async add() { throw new Error("offline"); } };
    const unreachable = await launch(g, { transport: down });
    expect(unreachable.result.status, JSON.stringify(unreachable.result).slice(0, 1200)).toBe("launched");
    expect(unreachable.childEnv?.SUPERMEMORY_CODEX_API_KEY).toBe(TOKEN);
    expect(unreachable.childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_ENDPOINT");
  });

  test("a launch without Supermemory carries no plugin credential and keeps Deck's bridge", async () => {
    const f = fixture();
    const { result, childEnv } = await launch(f, { deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: false, activeProvider: "none" } } });
    expect(result.status).toBe("launched");
    expect(childEnv).not.toHaveProperty("SUPERMEMORY_CODEX_API_KEY");
    expect(await Bun.file(join(f.effects.codexHome, "config.toml")).text()).toContain("deck-codex-hook:memory-bridge:start");
  });

  test("blocks without a stored credential, a user Supermemory plugin or a project-level conflict (no double integration)", async () => {
    const emptyStore = fixture();
    emptyStore.effects.store = createOwnerOnlyFileSecretStore({ configHome: temp("deck-codex-sm-empty-") });
    expect(await launch(emptyStore)).toMatchObject({ result: { status: "blocked", message: expect.stringContaining("No credential") } });

    const userPlugin = fixture({ userHooks: JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node /home/u/.codex/supermemory/recall.js" }] }] } }) });
    const blockedByHooks = await launch(userPlugin);
    expect(blockedByHooks.result).toMatchObject({ status: "blocked", message: expect.stringContaining("double-integrate") });
    expect(JSON.stringify(blockedByHooks.result)).not.toContain(TOKEN);

    const userMcp = fixture({ userConfig: '[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\n' });
    expect(await launch(userMcp)).toMatchObject({ result: { status: "blocked" } });

    const projectJson = fixture({ projectHooksJson: '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"supermemory flush"}]}]}}' });
    expect(await launch(projectJson)).toMatchObject({ result: { status: "blocked" } });
  }, 120_000);

  test("readiness checks require the owned pinned artifact and project hooks", () => {
    const f = fixture();
    expect(() => assertCodexSupermemoryReady(f.projectRoot, f.effects)).toThrow(/no Deck-owned Supermemory plugin hooks/);
    const bare = fixture();
    bare.effects.tools = { ...bare.effects.tools, supermemoryManifest: [["recall.js", "x", "0".repeat(64), 1], ["flush.js", "y", "0".repeat(64), 1]] };
    expect(() => assertCodexSupermemoryReady(bare.projectRoot, bare.effects)).toThrow(/not installed and verified/);
  });

  test("overlay carries only the plugin credential, endpoint and canonical tag; empty tokens are rejected", () => {
    const f = fixture();
    const credential = resolveCodexSupermemoryLaunchCredential(f.projectRoot, f.effects);
    expect(credential).toMatchObject({ token: TOKEN, profile: "default" });
    const overlay = buildCodexSupermemoryLaunchOverlay({ token: credential.token, projectRoot: f.projectRoot, canonicalRepoTag: credential.canonicalRepoTag });
    expect(Object.keys(overlay).sort()).toEqual(["SUPERMEMORY_API_URL", "SUPERMEMORY_CODEX_API_KEY", "SUPERMEMORY_REPO_TAG"]);
    expect(overlay.SUPERMEMORY_CODEX_API_KEY).toEqual({ value: TOKEN, sensitive: true });
    expect(() => buildCodexSupermemoryLaunchOverlay({ token: "  ", projectRoot: f.projectRoot })).toThrow();
    expect(VERIFIED_CODEX_SUPERMEMORY_BINDING).toBe("deck-codex-launch-v1");
  });

  test("a project repoContainerTag override that disagrees with the canonical tag blocks the launch", async () => {
    const f = fixture();
    mkdirSync(join(f.projectRoot, ".claude", ".supermemory-claude"), { recursive: true });
    writeFileSync(join(f.projectRoot, ".claude", ".supermemory-claude", "config.json"), JSON.stringify({ repoContainerTag: "other_tag" }));
    expect(await launch(f)).toMatchObject({ result: { status: "blocked", message: expect.stringContaining("repoContainerTag") } });
  });

  test("Web Search and Supermemory credentials both reach the child through one narrow binding, never config files or argv", async () => {
    const f = fixture({ webSearch: true });
    const deckConfig = { ...memoryConfig(), webSearch: { enabled: true, provider: "tavily" } } as DeckCfg;
    const { result, childEnv, childArgs } = await launch(f, { deckConfig, env: { TAVILY_API_KEY: "stale-parent-tavily" } });
    expect(result.status).toBe("launched");
    expect(childEnv?.TAVILY_API_KEY).toBe("tvly-test-credential-value");
    expect(childEnv?.SUPERMEMORY_CODEX_API_KEY).toBe(TOKEN);
    expect(childArgs.join(" ")).not.toContain("tvly-test-credential-value");
    const config = await Bun.file(join(f.effects.codexHome, "config.toml")).text();
    expect(config).toContain("[mcp_servers.web-search]");
    expect(config).toContain('env_vars = ["TAVILY_API_KEY"]');
    expect(config).not.toContain("tvly-test-credential-value");
    expect(JSON.stringify(result)).not.toContain("tvly-test-credential-value");

    const off = await launch(fixture({ webSearch: true }), { env: { TAVILY_API_KEY: "stale-parent-tavily" } });
    expect(off.childEnv).not.toHaveProperty("TAVILY_API_KEY");
  }, 120_000);

  test("dry-run explains the plugin memory route precisely, without secrets and without Deck's runtime label", async () => {
    for (const hasCredential of [true, false]) {
      const f = fixture();
      if (!hasCredential) f.effects.store = createOwnerOnlyFileSecretStore({ configHome: temp("deck-codex-sm-dry-empty-") });
      const previews: string[] = [];
      const result = await runRunnerLaunch({
        adapter: f.adapter,
        launch: { projectRoot: f.projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: memoryConfig() },
        dryRun: true,
        interactive: false,
        presentPreview: async (preview) => { previews.push(preview); },
        codexSupermemoryLaunchEffects: f.effects,
        supermemoryRuntime: { transport: fakeTransport, stateHome: f.stateHome },
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      });
      expect(result.status).toBe("dry-run");
      const text = previews.join("\n");
      expect(text).toContain("Adaptive memory: official Supermemory plugin hooks");
      expect(text).not.toContain("adaptive-memory=disabled");
      expect(text).not.toContain(TOKEN);
      expect(text).toContain(hasCredential ? "profile 'default' will be passed" : "no credential resolved");
    }
  });
});
