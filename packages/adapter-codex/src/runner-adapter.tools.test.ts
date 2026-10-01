import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getDefaultDeckConfig, validateDeckConfig } from "@deck/core";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { createCodexRunnerAdapter } from "./runner-adapter";
import { readyTestTools, testTools } from "./test-tools";
import type { CodexPreflightEffects } from "./preflight";

setDefaultTimeout(30_000);

const HOOK_TRUST_HELP = "Usage: codex [OPTIONS]\nexec\nresume\n      --dangerously-bypass-hook-trust\n";
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function preflight(help = HOOK_TRUST_HELP): CodexPreflightEffects {
  return {
    probe: async () => ({ found: true, version: "0.159.3", help, execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
    inspectTrust: async () => "trusted",
    readProject: async (root) => ({ config: await readFile(join(root, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: false }),
  };
}

const noSerena = { serenaReadinessResolver: async () => ({ state: "missing" as const, diagnostic: { code: "serena-not-ready", message: "Serena is unavailable." } }) };
const deckConfig = () => getDefaultDeckConfig();
/** Default config enables every package instruction; this one selects none so only explicit capability ids apply. */
const noPackagesConfig = () => {
  const base = getDefaultDeckConfig();
  return { ...base, packageInstructions: { ...base.packageInstructions, codex: Object.fromEntries(Object.keys(base.packageInstructions.codex).map((id) => [id, false])) } } as unknown as typeof base;
};
const supermemoryConfig = () => validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } });

async function withProject<T>(fn: (root: string, journalRoot: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "deck-codex-tools-project-"));
  const journalRoot = await mkdtemp(join(tmpdir(), "deck-codex-tools-journal-"));
  try {
    await mkdir(join(root, ".git", "objects", "info"), { recursive: true });
    await mkdir(join(root, ".git", "objects", "pack"), { recursive: true });
    await mkdir(join(root, ".git", "refs", "heads"), { recursive: true });
    await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(root, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]\n\turl = git@github.com:kevin15011/deck.git\n");
    return await fn(root, journalRoot);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(journalRoot, { recursive: true, force: true });
  }
}

function tarball(binary: Buffer, name: string) {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(`${binary.length.toString(8).padStart(11, "0")}\0`, 124);
  header[156] = 48;
  return gzipSync(Buffer.concat([header, binary, Buffer.alloc((512 - binary.length % 512) % 512), Buffer.alloc(1024)]));
}

describe("Codex shared tool installation through the reviewed plan", () => {
  test("offers Deck-owned install actions for every missing shared tool and Supermemory plugin hooks", async () => {
    await withProject(async (root, journalRoot) => {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
      const inventory = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: deckConfig() });
      const review = adapter.buildReviewPlan({
        runnerId: "codex",
        environmentId: "codex-development",
        selectedCapabilities: { rtk: true, "context-mode": true, "codebase-memory": true },
        packageInstructions: {},
        adaptiveMemory: { provider: "supermemory" },
      }, inventory);
      const installs = review.groups.automaticInstalls;
      expect(installs.map((action) => [action.kind, action.capabilityId])).toEqual(expect.arrayContaining([
        ["install-codex-rtk", "rtk"],
        ["install-codex-tool", "context-mode"],
        ["install-codex-codebase", "codebase-memory"],
        ["install-codex-supermemory", "adaptive-memory"],
      ]));
      expect(installs.every((action) => action.status === "ready" && action.required === true)).toBe(true);
      expect(new Set(installs.map((action) => action.id)).size).toBe(installs.length);
      expect(review.groups.configWrites.map((action) => action.capabilityId)).toEqual(expect.arrayContaining(["rtk", "context-mode", "codebase-memory", "supermemory-tool-bindings"]));
    });
  });

  test("offers no install action when every tool and the plugin artifact already verify", async () => {
    await withProject(async (root, journalRoot) => {
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools({ supermemory: true }), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
      const inventory = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: deckConfig() });
      const review = adapter.buildReviewPlan({
        runnerId: "codex",
        environmentId: "codex-development",
        selectedCapabilities: { rtk: true, "context-mode": true, "codebase-memory": true },
        packageInstructions: {},
        adaptiveMemory: { provider: "supermemory" },
      }, inventory);
      expect(review.groups.automaticInstalls).toEqual([]);
      expect(review.ready).toBe(true);
    });
  });

  test("installs a pinned RTK archive into the owner-only Deck root and verifies it without running upstream init", async () => {
    await withProject(async (_root, journalRoot) => {
      const binary = Buffer.from("fixture rtk; never executed");
      const archive = tarball(binary, "rtk");
      let fetched = 0;
      const tools = testTools({
        rtkReleaseOverride: { asset: "rtk-fixture.tar.gz", archiveSha256: sha(archive), archiveBytes: archive.length, binarySha256: sha(binary), binaryBytes: binary.length },
        rtkArtifactEffects: { fetchArchive: async () => { fetched += 1; return archive; } },
      });
      const adapter = createCodexRunnerAdapter({ tools, journalRoot, preflight: preflight() });
      const action = { id: "codex.tool.rtk.install", kind: "install-codex-rtk", title: "Install RTK", capabilityId: "rtk", status: "ready", required: true } as const;
      const first = await adapter.runAction(action, {} as never);
      expect(first).toMatchObject({ status: "executed", message: expect.stringContaining("installed") });
      const owned = join(tools.dataRoot!, "codex", "tools", "rtk-v0.50.0", `${process.platform}-${process.arch}`, "rtk");
      expect(await readFile(owned)).toEqual(binary);
      expect((await stat(owned)).mode & 0o777).toBe(0o700);
      expect(await adapter.runAction(action, {} as never)).toMatchObject({ status: "executed", message: expect.stringContaining("without changes") });
      expect(fetched).toBe(1);
      expect(await adapter.runAction({ ...action, capabilityId: "serena-not-rtk" }, {} as never)).toMatchObject({ status: "failed" });
    });
  });

  test("reports a failed RTK archive without publishing anything", async () => {
    await withProject(async (_root, journalRoot) => {
      const binary = Buffer.from("fixture rtk");
      const archive = tarball(binary, "rtk");
      const tools = testTools({
        rtkReleaseOverride: { asset: "rtk-fixture.tar.gz", archiveSha256: "0".repeat(64), archiveBytes: archive.length, binarySha256: sha(binary), binaryBytes: binary.length },
        rtkArtifactEffects: { fetchArchive: async () => archive },
      });
      const adapter = createCodexRunnerAdapter({ tools, journalRoot, preflight: preflight() });
      const result = await adapter.runAction({ id: "x", kind: "install-codex-rtk", title: "Install RTK", capabilityId: "rtk", status: "ready" }, {} as never);
      expect(result).toMatchObject({ status: "failed" });
      await expect(stat(join(tools.dataRoot!, "codex", "tools", "rtk-v0.50.0", `${process.platform}-${process.arch}`))).rejects.toThrow();
    });
  });

  test("installs Context Mode through the reviewed seam, reuses a ready one, and reports failures", async () => {
    await withProject(async (_root, journalRoot) => {
      let calls = 0;
      const missing = createCodexRunnerAdapter({ tools: testTools({ installContextMode: async () => { calls += 1; return true; } }), journalRoot, preflight: preflight() });
      const action = { id: "codex.tool.context-mode.install", kind: "install-codex-tool", title: "Install Context Mode", capabilityId: "context-mode", status: "ready" } as const;
      expect(await missing.runAction(action, {} as never)).toMatchObject({ status: "executed" });
      expect(calls).toBe(1);
      const failing = createCodexRunnerAdapter({ tools: testTools({ installContextMode: async () => false }), journalRoot, preflight: preflight() });
      expect(await failing.runAction(action, {} as never)).toMatchObject({ status: "failed" });
      const ready = createCodexRunnerAdapter({ tools: readyTestTools({ installContextMode: async () => { throw new Error("must not reinstall"); } }), journalRoot, preflight: preflight() });
      expect(await ready.runAction(action, {} as never)).toMatchObject({ status: "executed", message: expect.stringContaining("already available") });
    });
  });

  test("an existing shared Codebase Memory executable is reused instead of installing a duplicate native release", async () => {
    await withProject(async (_root, journalRoot) => {
      const adapter = createCodexRunnerAdapter({ tools: testTools({ resolveCommand: (name) => name === "codebase-memory-mcp" ? process.execPath : undefined }), journalRoot, preflight: preflight() });
      const result = await adapter.runAction({ id: "codex.tool.codebase-memory.install", kind: "install-codex-codebase", title: "Install", capabilityId: "codebase-memory", status: "ready" }, {} as never);
      expect(result).toMatchObject({ status: "executed", message: expect.stringContaining("reused") });
    });
  });
});

describe("Codex materialization pins tools and hooks to verified executables", () => {
  test("writes absolute MCP commands, the RTK hook and the plugin-only Supermemory hooks, then launches with hook-trust bypass", async () => {
    await withProject(async (root, journalRoot) => {
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools({ supermemory: true }), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
      const input = {
        projectRoot: root,
        environmentId: "codex-development" as const,
        deckConfig: supermemoryConfig(),
        capabilityIds: ["rtk", "context-mode", "codebase-memory"],
        memoryProvider: { id: "supermemory", displayName: "Supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) },
      };
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan });
      expect(await adapter.verifyDeveloperTeamInstall(plan)).toMatchObject({ valid: true });

      const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(config).toMatch(/\[mcp_servers\.context-mode\]\ncommand = "\//);
      expect(config).toMatch(/\[mcp_servers\.codebase-memory\]\ncommand = "\//);
      expect(config).toContain("# deck-codex-hook:rtk:start");
      expect(config).toContain("# deck-codex-hook:supermemory:start");
      expect(config).not.toContain("memory-bridge");
      expect(config).not.toContain("mcp_servers.supermemory");
      const script = await readFile(join(root, ".codex", "hooks", "deck-rtk-hook.cjs"), "utf8");
      expect(script).toContain("/codex/tools/rtk-v0.50.0/");
      expect((await stat(join(root, ".codex", "hooks", "deck-rtk-hook.cjs"))).isFile()).toBe(true);

      const launch = await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: supermemoryConfig() });
      expect(launch).toMatchObject({ status: "ready" });
      if (launch.status === "ready") {
        expect(launch.plan.args.slice(0, 2)).toEqual(["--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust"]);
        expect(launch.plan.envOverlay).toBeUndefined();
        expect(launch.diagnostics).toContainEqual(expect.objectContaining({ code: "codex-hook-trust-bypass" }));
      }
      const resumed = await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "resume-latest", deckConfig: supermemoryConfig() });
      if (resumed.status === "ready") expect(resumed.plan.args).toContain("--dangerously-bypass-hook-trust");

      // Re-planning with the same selection is idempotent.
      const again = adapter.buildDeveloperTeamInstallPlan(input);
      expect(again.mutationPreview).toEqual([]);
    });
  });

  test("does not request hook-trust bypass when Deck hooks are absent or the Codex release lacks the flag", async () => {
    await withProject(async (root, journalRoot) => {
      const plain = createCodexRunnerAdapter({ tools: testTools(), journalRoot, preflight: preflight() });
      const noHooks = await plain.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: deckConfig() });
      if (noHooks.status === "ready") expect(noHooks.plan.args).toEqual(["--dangerously-bypass-approvals-and-sandbox", ...noHooks.plan.args.slice(1)].filter((arg) => arg !== "--dangerously-bypass-hook-trust"));
      if (noHooks.status === "ready") expect(noHooks.plan.args).not.toContain("--dangerously-bypass-hook-trust");

      await mkdir(join(root, ".codex"), { recursive: true });
      await writeFile(join(root, ".codex", "config.toml"), "# deck-codex-hook:rtk:start\n# deck-codex-hook:rtk:end\n");
      const oldCodex = createCodexRunnerAdapter({ tools: testTools(), journalRoot, preflight: preflight("Usage: codex [OPTIONS]\nexec\nresume\n") });
      const launch = await oldCodex.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: deckConfig() });
      if (launch.status === "ready") expect(launch.plan.args).not.toContain("--dangerously-bypass-hook-trust");
      await chmod(join(root, ".codex", "config.toml"), 0o600);
    });
  });

  test("never removes user hooks when Deck hooks are turned off", async () => {
    await withProject(async (root, journalRoot) => {
      await mkdir(join(root, ".codex"), { recursive: true });
      const userConfig = '[features]\nmulti_agent = true\n\n[[hooks.Stop]]\nmatcher = "*"\n\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = "echo mine"\n';
      await writeFile(join(root, ".codex", "config.toml"), userConfig);
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools(), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
      const on = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: noPackagesConfig(), capabilityIds: ["rtk"] });
      expect(on.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan: on });
      const withRtk = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(withRtk).toContain("echo mine");
      expect(withRtk).toContain("deck-codex-hook:rtk:start");

      const off = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: noPackagesConfig(), capabilityIds: [] });
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan: off });
      const final = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(final).toContain("echo mine");
      expect(final).not.toContain("deck-codex-hook:rtk");
      await expect(stat(join(root, ".codex", "hooks", "deck-rtk-hook.cjs"))).rejects.toThrow();
    });
  });

  test("does not add a duplicate Codebase Memory server beside the user's own registration of the same executable and never edits it", async () => {
    await withProject(async (root, journalRoot) => {
      const tools = testTools({ resolveCommand: (name) => name === "codebase-memory-mcp" ? process.execPath : name === "context-mode" ? "/bin/sh" : undefined });
      const codexHome = join(tools.homeDir!, ".codex");
      await mkdir(codexHome, { recursive: true });
      const userConfig = `[features]\nhooks = true\n# >>> codebase-memory-mcp MCP >>>\n[mcp_servers.codebase-memory-mcp]\ncommand = "${process.execPath}"\nargs = []\n# <<< codebase-memory-mcp MCP <<<\n`;
      await writeFile(join(codexHome, "config.toml"), userConfig);
      const adapter = createCodexRunnerAdapter({ tools, codexHome, journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: deckConfig(), capabilityIds: ["codebase-memory", "context-mode"] });
      expect(plan.blocked).toBe(false);
      expect((plan.diagnostics ?? []).join(" ")).toContain("Deck did not add MCP server 'codebase-memory'");
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan });
      const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(config).not.toContain("mcp_servers.codebase-memory]");
      expect(config).toContain("[mcp_servers.context-mode]");
      expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(userConfig);
      const inventory = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: deckConfig() });
      expect(inventory.capabilities.find((capability) => capability.capabilityId === "codebase-memory")).toMatchObject({ isInstalled: true, diagnostics: [] });

      // A same-name unmanaged project entry is still a collision, not a duplicate to hide.
      const solo = createCodexRunnerAdapter({ tools, codexHome: join(tools.homeDir!, "none"), journalRoot, preflight: preflight(), ...noSerena });
      const again = solo.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: deckConfig(), capabilityIds: ["codebase-memory"] });
      expect((again.diagnostics ?? []).join(" ")).not.toContain("Deck did not add");
    });
  });
});

describe("Codex project scan limit", () => {
  test("a directory too large for the AGENTS.md precedence scan yields a clean blocked plan before any mutation", async () => {
    await withProject(async (root, journalRoot) => {
      const adapter = createCodexRunnerAdapter({ tools: testTools(), journalRoot, preflight: preflight(), ...noSerena });
      for (let index = 0; index < 101; index += 1) {
        const dir = join(root, `d${index}`);
        await mkdir(dir);
        await Promise.all(Array.from({ length: 100 }, (_, file) => writeFile(join(dir, `f${file}.txt`), "")));
      }
      const input = { projectRoot: root, environmentId: "codex-development" as const, deckConfig: deckConfig() };
      const prepared = await adapter.prepareDeveloperTeamInstall!(input);
      expect(prepared).toContainEqual(expect.objectContaining({ code: "codex-project-too-large", severity: "error" }));
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(plan.blocked).toBe(true);
      expect(plan.diagnostics?.join(" ")).toContain("too large to inspect safely");
      expect(plan.diagnostics?.join(" ")).toContain("Run Deck from inside a project directory");
      await expect(stat(join(root, ".codex"))).rejects.toThrow();
    });
  }, 60_000);
});

describe("Upgrade from the previous Deck version", () => {
  const OLD_WEB_SEARCH = '# deck-codex-mcp:web-search\n[mcp_servers.web-search]\ncommand = "npx"\nargs = ["-y", "tavily-mcp@0.2.22"]\nenv_vars = ["TAVILY_API_KEY"]\n';
  const OLD_V1_HOOKS = `# deck-codex-hook-v1\n${["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "Stop"].map((event) => `[[hooks.${event}]]\nmatcher = "*"\nhooks = [{ type = "command", command = "deck internal codex-memory-hook" }]\n`).join("\n")}`;
  const OLD_SUPERMEMORY_MCP = '# deck-codex-mcp:supermemory\n[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nhttp_headers = { "x-sm-project" = "sm_project_v1_kevin15011_deck" }\n';
  const webSearchAdapter = (journalRoot: string) => createCodexRunnerAdapter({
    tools: testTools({ resolveCommand: (name) => name === "npx" ? process.execPath : undefined }),
    journalRoot,
    webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
    webSearchCredential: () => "tvly-test",
    preflight: preflight(),
    codebaseIndexReadiness: () => true,
    ...noSerena,
  });
  const webSearchConfig = () => validateDeckConfig({ webSearch: { enabled: true, provider: "tavily" } });

  test("a Deck-marked web-search block with the old bare npx is upgraded in place with nothing blocked, through inventory, review and plan", async () => {
    await withProject(async (root, journalRoot) => {
      await mkdir(join(root, ".codex"), { recursive: true });
      await writeFile(join(root, ".codex", "config.toml"), `[features]\nmulti_agent = true\n${OLD_SUPERMEMORY_MCP}\n${OLD_WEB_SEARCH}\n${OLD_V1_HOOKS}`);
      const adapter = webSearchAdapter(journalRoot);
      const inventory = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: webSearchConfig() });
      const entry = inventory.capabilities.find((capability) => capability.capabilityId === "web-search");
      expect(entry).toMatchObject({ isBlocked: false, isInstalled: false, webSearchReadiness: expect.objectContaining({ code: "mcp-not-materialized" }) });
      const review = adapter.buildReviewPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: { "web-search": true }, webSearchProviderDescriptor: TAVILY_PROVIDER_DESCRIPTOR, packageInstructions: {}, adaptiveMemory: { provider: "none" } }, inventory);
      expect(review.groups.manualSteps.filter((action) => action.status === "blocked")).toEqual([]);
      expect(review.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(review.groups.configWrites).toContainEqual(expect.objectContaining({ capabilityId: "web-search" }));

      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: webSearchConfig(), capabilityIds: ["web-search"] });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan });
      const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(config).toContain(`command = ${JSON.stringify(process.execPath)}`);
      expect(config).not.toContain('command = "npx"');
      expect(config).not.toContain("mcp.supermemory.ai");
      expect(config).not.toContain("deck-codex-hook-v1");
      expect(config.match(/\[mcp_servers\.web-search\]/g)).toHaveLength(1);
      const after = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: webSearchConfig() });
      expect(after.capabilities.find((capability) => capability.capabilityId === "web-search")).toMatchObject({ isInstalled: true, isBlocked: false });
      expect(adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: webSearchConfig(), capabilityIds: ["web-search"] }).mutationPreview).toEqual([]);
    });
  });

  test("an unmarked same-name web-search entry is still a blocking conflict and is never overwritten", async () => {
    await withProject(async (root, journalRoot) => {
      await mkdir(join(root, ".codex"), { recursive: true });
      const foreign = '[mcp_servers.web-search]\ncommand = "npx"\nargs = ["-y", "tavily-mcp@0.2.22"]\nenv_vars = ["TAVILY_API_KEY"]\n';
      await writeFile(join(root, ".codex", "config.toml"), foreign);
      const adapter = webSearchAdapter(journalRoot);
      const inventory = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: webSearchConfig() });
      expect(inventory.capabilities.find((capability) => capability.capabilityId === "web-search")).toMatchObject({ isBlocked: true });
      expect(adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: webSearchConfig(), capabilityIds: ["web-search"] }).blocked).toBe(true);
      expect(await readFile(join(root, ".codex", "config.toml"), "utf8")).toBe(foreign);
    });
  });

  test("old Deck-owned context-mode, codebase-memory and serena blocks with bare commands are replaced without blocking", async () => {
    await withProject(async (root, journalRoot) => {
      await mkdir(join(root, ".codex"), { recursive: true });
      await writeFile(join(root, ".codex", "config.toml"), '[features]\nmulti_agent = true\n# deck-codex-mcp:context-mode\n[mcp_servers.context-mode]\ncommand = "context-mode"\nargs = ["mcp"]\n\n# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand = "codebase-memory-mcp"\n');
      const tools = testTools({ resolveCommand: (name) => name === "context-mode" ? process.execPath : name === "codebase-memory-mcp" ? "/bin/sh" : undefined });
      const adapter = createCodexRunnerAdapter({ tools, codexHome: join(tools.homeDir!, "none"), journalRoot, preflight: preflight(), ...noSerena });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: deckConfig(), capabilityIds: ["context-mode", "codebase-memory"] });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan });
      const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(config).toContain(`command = ${JSON.stringify(process.execPath)}`);
      expect(config).toContain('command = "/bin/sh"');
      expect(config).not.toMatch(/command = "(context-mode|codebase-memory-mcp)"/);
    });
  });
});
