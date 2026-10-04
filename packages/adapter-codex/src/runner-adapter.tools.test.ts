import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getDefaultDeckConfig, prepareAndBuildDeveloperTeamInstallPlan, validateDeckConfig } from "@deck/core";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { createCodexRunnerAdapter } from "./runner-adapter";
import { CURRENT_CODEX_MODELS_FIXTURE } from "./__fixtures__/codex/models";
import { parseCodexModels } from "./codex-model-discovery";
import { layout, readyTestTools, testTools } from "./test-tools";
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
// These tool/ownership fixtures expose Serena as unavailable and do not test its setup.
const withoutSerena = (config: ReturnType<typeof getDefaultDeckConfig>) => ({
  ...config,
  packageInstructions: { ...config.packageInstructions, codex: { ...config.packageInstructions.codex, serena: false } },
});
const deckConfig = () => withoutSerena(getDefaultDeckConfig());
/** Default config enables every package instruction; this one selects none so only explicit capability ids apply. */
const noPackagesConfig = () => {
  const base = getDefaultDeckConfig();
  return { ...base, packageInstructions: { ...base.packageInstructions, codex: Object.fromEntries(Object.keys(base.packageInstructions.codex).map((id) => [id, false])) } } as unknown as typeof base;
};
const supermemoryConfig = () => withoutSerena(validateDeckConfig({ adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }));

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
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(root), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
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
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools({ supermemory: true }), ...layout(root), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
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
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools({ supermemory: true }), ...layout(root), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
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
      const script = await readFile(join(root, ".codex", "deck", "hooks", "deck-rtk-hook.cjs"), "utf8");
      expect(script).toContain("/codex/tools/rtk-v0.50.0/");
      expect((await stat(join(root, ".codex", "deck", "hooks", "deck-rtk-hook.cjs"))).isFile()).toBe(true);

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
  }, 120_000);

  test("does not request hook-trust bypass when Deck hooks are absent or the Codex release lacks the flag", async () => {
    await withProject(async (root, journalRoot) => {
      const plain = createCodexRunnerAdapter({ tools: testTools(), ...layout(root), journalRoot, preflight: preflight() });
      const noHooks = await plain.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: deckConfig() });
      if (noHooks.status === "ready") expect(noHooks.plan.args).toEqual(["--dangerously-bypass-approvals-and-sandbox", ...noHooks.plan.args.slice(1)].filter((arg) => arg !== "--dangerously-bypass-hook-trust"));
      if (noHooks.status === "ready") expect(noHooks.plan.args).not.toContain("--dangerously-bypass-hook-trust");

      await mkdir(join(root, ".codex"), { recursive: true });
      await writeFile(join(root, ".codex", "config.toml"), "# deck-codex-hook:rtk:start\n# deck-codex-hook:rtk:end\n");
      const oldCodex = createCodexRunnerAdapter({ tools: testTools(), ...layout(root), journalRoot, preflight: preflight("Usage: codex [OPTIONS]\nexec\nresume\n") });
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
      const adapter = createCodexRunnerAdapter({ tools: readyTestTools(), ...layout(root), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
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
      await expect(stat(join(root, ".codex", "deck", "hooks", "deck-rtk-hook.cjs"))).rejects.toThrow();
    });
  }, 120_000);

  test("does not add a duplicate Codebase Memory server beside the user's own registration of the same executable and never edits it", async () => {
    await withProject(async (root, journalRoot) => {
      const tools = testTools({ resolveCommand: (name) => name === "codebase-memory-mcp" ? process.execPath : name === "context-mode" ? "/bin/sh" : undefined });
      const { codexHome } = layout(root);
      await mkdir(codexHome, { recursive: true });
      const userConfig = `[features]\nhooks = true\n# >>> codebase-memory-mcp MCP >>>\n[mcp_servers.codebase-memory-mcp]\ncommand = "${process.execPath}"\nargs = []\n# <<< codebase-memory-mcp MCP <<<\n`;
      await writeFile(join(codexHome, "config.toml"), userConfig);
      const adapter = createCodexRunnerAdapter({ tools, ...layout(root), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: deckConfig(), capabilityIds: ["codebase-memory", "context-mode"] });
      expect(plan.blocked).toBe(false);
      expect((plan.diagnostics ?? []).join(" ")).toContain("Deck did not add MCP server 'codebase-memory'");
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan });
      const config = await readFile(join(codexHome, "config.toml"), "utf8");
      expect(config).not.toContain("mcp_servers.codebase-memory]");
      expect(config).toContain("[mcp_servers.context-mode]");
      expect(config).toContain("# >>> codebase-memory-mcp MCP >>>\n[mcp_servers.codebase-memory-mcp]\ncommand = ");
      expect(config).toContain("# <<< codebase-memory-mcp MCP <<<\n");
      const inventory = await adapter.getCapabilityInventory({ projectRoot: root, environmentId: "codex-development", runnerId: "codex", deckConfig: deckConfig() });
      expect(inventory.capabilities.find((capability) => capability.capabilityId === "codebase-memory")).toMatchObject({ isInstalled: true, diagnostics: [] });
    });
  }, 120_000);
});

describe("Codex global install", () => {
  test("planning and applying from a huge project directory neither scans nor writes anything in the project", async () => {
    await withProject(async (root, journalRoot) => {
      const globalRoot = await mkdtemp(join(tmpdir(), "deck-codex-global-"));
      const project = join(root, "big");
      await mkdir(project, { recursive: true });
      for (let index = 0; index < 101; index += 1) {
        const dir = join(project, `d${index}`);
        await mkdir(dir);
        await Promise.all(Array.from({ length: 100 }, (_, file) => writeFile(join(dir, `f${file}.txt`), "")));
      }
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(globalRoot), journalRoot, preflight: preflight(), ...noSerena });
      const input = { projectRoot: project, environmentId: "codex-development" as const, deckConfig: deckConfig() };
      expect(await adapter.prepareDeveloperTeamInstall!(input)).toEqual([]);
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: project, environmentId: "codex-development", plan });
      await expect(stat(join(project, ".codex"))).rejects.toThrow();
      await expect(stat(join(project, ".agents"))).rejects.toThrow();
      expect((await stat(join(globalRoot, ".codex", "agents", "deck-lead.toml"))).isFile()).toBe(true);
      expect((await stat(join(globalRoot, ".agents", "skills", "deck-lead", "SKILL.md"))).isFile()).toBe(true);
      expect((await stat(join(globalRoot, ".codex", "deck", "manifest.json"))).isFile()).toBe(true);
      await rm(globalRoot, { recursive: true, force: true });
    });
  }, 60_000);
});

describe("Upgrade from the previous Deck version", () => {
  const OLD_WEB_SEARCH = '# deck-codex-mcp:web-search\n[mcp_servers.web-search]\ncommand = "npx"\nargs = ["-y", "tavily-mcp@0.2.22"]\nenv_vars = ["TAVILY_API_KEY"]\n';
  const OLD_V1_HOOKS = `# deck-codex-hook-v1\n${["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "Stop"].map((event) => `[[hooks.${event}]]\nmatcher = "*"\nhooks = [{ type = "command", command = "deck internal codex-memory-hook" }]\n`).join("\n")}`;
  const OLD_SUPERMEMORY_MCP = '# deck-codex-mcp:supermemory\n[mcp_servers.supermemory]\nurl = "https://mcp.supermemory.ai/mcp"\nhttp_headers = { "x-sm-project" = "sm_project_v1_kevin15011_deck" }\n';
  const webSearchAdapter = (root: string, journalRoot: string) => createCodexRunnerAdapter({
    ...layout(root),
    tools: testTools({ resolveCommand: (name) => name === "npx" ? process.execPath : undefined }),
    journalRoot,
    webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
    webSearchCredential: () => "tvly-test",
    preflight: preflight(),
    codebaseIndexReadiness: () => true,
    ...noSerena,
  });
  const webSearchConfig = () => withoutSerena(validateDeckConfig({ webSearch: { enabled: true, provider: "tavily" } }));

  test("a Deck-marked web-search block with the old bare npx is upgraded in place with nothing blocked, through inventory, review and plan", async () => {
    await withProject(async (root, journalRoot) => {
      await mkdir(join(root, ".codex"), { recursive: true });
      await writeFile(join(root, ".codex", "config.toml"), `[features]\nmulti_agent = true\n${OLD_SUPERMEMORY_MCP}\n${OLD_WEB_SEARCH}\n${OLD_V1_HOOKS}`);
      const adapter = webSearchAdapter(root, journalRoot);
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
  }, 120_000);

  test("an unmarked same-name web-search entry is still a blocking conflict and is never overwritten", async () => {
    await withProject(async (root, journalRoot) => {
      await mkdir(join(root, ".codex"), { recursive: true });
      const foreign = '[mcp_servers.web-search]\ncommand = "npx"\nargs = ["-y", "tavily-mcp@0.2.22"]\nenv_vars = ["TAVILY_API_KEY"]\n';
      await writeFile(join(root, ".codex", "config.toml"), foreign);
      const adapter = webSearchAdapter(root, journalRoot);
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
      const adapter = createCodexRunnerAdapter({ tools, ...layout(root), journalRoot, preflight: preflight(), ...noSerena });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "codex-development", deckConfig: deckConfig(), capabilityIds: ["context-mode", "codebase-memory"] });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "codex-development", plan });
      const config = await readFile(join(root, ".codex", "config.toml"), "utf8");
      expect(config).toContain(`command = ${JSON.stringify(process.execPath)}`);
      expect(config).toContain('command = "/bin/sh"');
      expect(config).not.toMatch(/command = "(context-mode|codebase-memory-mcp)"/);
    });
  }, 120_000);
});

describe("Codex global ownership and migration", () => {
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  const globalAdapter = async (root: string, journalRoot: string, extra: Record<string, unknown> = {}) => {
    const cwd = join(root, "cwd");
    await mkdir(cwd, { recursive: true });
    const g = join(root, "global");
    await mkdir(g, { recursive: true });
    return { cwd, g, adapter: createCodexRunnerAdapter({ tools: testTools(), ...layout(g), journalRoot, preflight: preflight(), codebaseIndexReadiness: () => true, ...noSerena, ...extra }) };
  };
  const plan = (adapter: ReturnType<typeof createCodexRunnerAdapter>, cwd: string, extra: Record<string, unknown> = {}) =>
    adapter.buildDeveloperTeamInstallPlan({ projectRoot: cwd, environmentId: "codex-development", deckConfig: deckConfig(), ...extra });

  test("installs only under the Codex home and ~/.agents/skills, preserving foreign agents, hooks.json and AGENTS.md", async () => {
    await withProject(async (root, journalRoot) => {
      const { cwd, g, adapter } = await globalAdapter(root, journalRoot);
      await mkdir(join(g, ".codex", "agents"), { recursive: true });
      const foreignAgent = 'name = "codebase-memory"\ndescription = "mine"\ndeveloper_instructions = "x"\n';
      await writeFile(join(g, ".codex", "agents", "codebase-memory.toml"), foreignAgent);
      await writeFile(join(g, ".codex", "hooks.json"), '{"hooks":{"Stop":[]}}');
      await writeFile(join(g, ".codex", "AGENTS.md"), "# my global rules\n");
      const first = plan(adapter, cwd);
      expect(first.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: cwd, environmentId: "codex-development", plan: first });
      expect(await readFile(join(g, ".codex", "agents", "codebase-memory.toml"), "utf8")).toBe(foreignAgent);
      expect(await readFile(join(g, ".codex", "hooks.json"), "utf8")).toBe('{"hooks":{"Stop":[]}}');
      expect(await readFile(join(g, ".codex", "AGENTS.md"), "utf8")).toBe("# my global rules\n");
      for (const role of ["deck-lead", "deck-investigate", "deck-quality"]) expect((await stat(join(g, ".codex", "agents", `${role}.toml`))).isFile()).toBe(true);
      expect((await stat(join(g, ".agents", "skills", "deck-lead", "SKILL.md"))).isFile()).toBe(true);
      expect((await stat(join(g, ".codex", "deck", "manifest.json"))).isFile()).toBe(true);
      for (const name of [".codex", ".agents", "AGENTS.md"]) await expect(stat(join(cwd, name))).rejects.toThrow();
      expect(first.mutationPreview?.every((entry) => entry.path.startsWith(g))).toBe(true);
      expect(first.diagnostics?.join(" ")).not.toMatch(/project[- ]trust|trust is absent|inactive/i);
      expect(await adapter.verifyDeveloperTeamInstall(first)).toMatchObject({ valid: true });
      expect(plan(adapter, cwd).mutationPreview).toEqual([]);
      const detected = await adapter.detectDeckInstall!({ projectRoot: cwd });
      expect(detected).toMatchObject({ installed: true });
      expect(detected.managedPaths).toContain(join(g, ".codex", "deck", "manifest.json"));
      expect(detected.managedPaths.every((path) => path.startsWith(g))).toBe(true);
    });
  }, 120_000);

  test("blocks, without overwriting, when a foreign agent or skill already uses a Deck name", async () => {
    await withProject(async (root, journalRoot) => {
      const { cwd, g, adapter } = await globalAdapter(root, journalRoot);
      await mkdir(join(g, ".codex", "agents"), { recursive: true });
      await mkdir(join(g, ".agents", "skills", "api-and-interface-design"), { recursive: true });
      const agent = 'name = "deck-lead"\ndescription = "not Deck"\ndeveloper_instructions = "x"\n';
      const skill = "---\nname: api-and-interface-design\ndescription: mine\n---\nmine\n";
      await writeFile(join(g, ".codex", "agents", "deck-lead.toml"), agent);
      await writeFile(join(g, ".agents", "skills", "api-and-interface-design", "SKILL.md"), skill);
      const blocked = plan(adapter, cwd);
      expect(blocked.blocked).toBe(true);
      expect(blocked.diagnostics?.filter((message) => message.startsWith("Refusing to overwrite")).length).toBeGreaterThanOrEqual(2);
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: cwd, environmentId: "codex-development", plan: blocked })).rejects.toThrow();
      expect(await readFile(join(g, ".codex", "agents", "deck-lead.toml"), "utf8")).toBe(agent);
      expect(await readFile(join(g, ".agents", "skills", "api-and-interface-design", "SKILL.md"), "utf8")).toBe(skill);
      await expect(stat(join(g, ".codex", "deck", "manifest.json"))).rejects.toThrow();
    });
  });

  test("a failure in the Codex home after skills were written restores the skills root (all-or-nothing across roots)", async () => {
    await withProject(async (root, journalRoot) => {
      const { createNodeCodexFileEffects } = await import("./node-effects");
      const base = createNodeCodexFileEffects({ journalRoot });
      const g = join(root, "global");
      await mkdir(g, { recursive: true });
      const failing = { ...base, writeAtomic: async (path: string, content: string, mode: number, guard: never) => {
        if (path.endsWith(`${join(".codex", "config.toml")}`)) throw new Error("injected config write failure");
        return base.writeAtomic(path, content, mode, guard);
      } };
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(g), journalRoot, fileEffects: failing, preflight: preflight(), ...noSerena });
      const cwd = join(root, "cwd");
      await mkdir(cwd, { recursive: true });
      const reviewed = plan(adapter, cwd);
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: cwd, environmentId: "codex-development", plan: reviewed })).rejects.toThrow(/injected config write failure/);
      await expect(stat(join(g, ".agents", "skills", "deck-lead", "SKILL.md"))).rejects.toThrow();
      await expect(stat(join(g, ".codex", "agents", "deck-lead.toml"))).rejects.toThrow();
    });
  }, 120_000);

  test("reports a legacy per-project install, never deletes it implicitly, and removes only unmodified Deck files on opt-in", async () => {
    await withProject(async (root, journalRoot) => {
      const { cwd, adapter } = await globalAdapter(root, journalRoot);
      const files: Record<string, string> = {
        ".codex/agents/deck-lead.toml": "name = \"Lead\"\n",
        ".agents/skills/deck-lead/SKILL.md": "---\nname: deck-lead\ndescription: d\n---\nbody\n",
        ".agents/skills/deck-modified/SKILL.md": "---\nname: deck-modified\ndescription: d\n---\noriginal\n",
        ".codex/config.toml": "[features]\nmulti_agent = true\n# deck-codex-mcp:context7\n[mcp_servers.context7]\nurl = \"https://mcp.context7.com/mcp\"\n\n[profiles.mine]\nmodel = \"x\"\n",
      };
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(cwd, path, ".."), { recursive: true });
        await writeFile(join(cwd, path), content);
      }
      const recorded = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, sha(path === ".agents/skills/deck-modified/SKILL.md" ? "original-changed-later" : content)]));
      await writeFile(join(cwd, ".codex", "deck-manifest.json"), `${JSON.stringify({ version: 1, files: recorded })}\n`);
      await writeFile(join(cwd, "unrelated.txt"), "keep");

      const reviewed = plan(adapter, cwd);
      const legacy = reviewed.diagnostics?.find((message) => message.includes("previous per-project Deck install"));
      expect(legacy).toContain("overrides the global team files");
      expect(legacy).toContain("--cleanup-legacy");
      expect(await readFile(join(cwd, ".codex", "agents", "deck-lead.toml"), "utf8")).toBe(files[".codex/agents/deck-lead.toml"]);

      const result = await adapter.cleanupLegacyInstall!(cwd, { deckConfig: deckConfig() });
      expect(result.removed).toEqual(expect.arrayContaining([".codex/agents/deck-lead.toml", ".agents/skills/deck-lead/SKILL.md", ".codex/deck-manifest.json"]));
      expect(result.preserved).toEqual([".agents/skills/deck-modified/SKILL.md"]);
      await expect(stat(join(cwd, ".codex", "agents", "deck-lead.toml"))).rejects.toThrow();
      await expect(stat(join(cwd, ".codex", "deck-manifest.json"))).rejects.toThrow();
      expect(await readFile(join(cwd, ".agents", "skills", "deck-modified", "SKILL.md"), "utf8")).toBe(files[".agents/skills/deck-modified/SKILL.md"]);
      const config = await readFile(join(cwd, ".codex", "config.toml"), "utf8");
      expect(config).toContain("[profiles.mine]");
      expect(config).not.toContain("mcp_servers.context7");
      expect(await readFile(join(cwd, "unrelated.txt"), "utf8")).toBe("keep");
      expect((await adapter.cleanupLegacyInstall!(cwd, { deckConfig: deckConfig() })).diagnostics).toEqual(["No legacy per-project Deck install was found."]);
    });
  });

  test("a launch-time plan keeps Deck-managed servers chosen in the TUI (for example Context7) instead of dropping them", async () => {
    await withProject(async (root, journalRoot) => {
      const { cwd, g, adapter } = await globalAdapter(root, journalRoot);
      const tuiPlan = plan(adapter, cwd, { capabilityIds: ["context7"] });
      await adapter.applyDeveloperTeamInstall({ projectRoot: cwd, environmentId: "codex-development", plan: tuiPlan });
      expect(await readFile(join(g, ".codex", "config.toml"), "utf8")).toContain("[mcp_servers.context7]");
      const launchPlan = plan(adapter, cwd);
      expect(launchPlan.mutationPreview).toEqual([]);
      const dropped = plan(adapter, cwd, { capabilityIds: [] });
      expect(dropped.mutationPreview?.length).toBeGreaterThan(0);
    });
  }, 120_000);

  test("assignments are global: read from and written to the Codex home agents whatever project is open", async () => {
    await withProject(async (root, journalRoot) => {
      const catalog = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);
      if (!catalog.ok) throw new Error("expected Codex fixture to parse");
      const { cwd, g, adapter } = await globalAdapter(root, journalRoot, {
        inventoryDiscovery: async () => ({ state: "ready", source: "live", discoveredAt: 1, fingerprint: "current-codex", inventory: catalog.inventory }),
      });
      const modelAssignments = { "deck-lead": "openai-codex/gpt-5.6-terra" };
      const thinkingAssignments = { "deck-lead": "ultra" };
      const { plan: withModels } = await prepareAndBuildDeveloperTeamInstallPlan(adapter, {
        projectRoot: cwd,
        environmentId: "codex-development",
        deckConfig: deckConfig(),
        modelAssignments,
        thinkingAssignments,
      });
      expect(withModels.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: cwd, environmentId: "codex-development", plan: withModels });
      expect(adapter.readModelAssignments(cwd)).toEqual(modelAssignments);
      const toml = await readFile(join(g, ".codex", "agents", "deck-lead.toml"), "utf8");
      expect(toml).toContain('model = "gpt-5.6-terra"');
      expect(toml).toContain('model_reasoning_effort = "ultra"');
      expect(adapter.readModelAssignments(join(root, "some-other-project"))).toEqual(modelAssignments);
      expect(adapter.readThinkingAssignments(cwd)).toEqual(thinkingAssignments);
    });
  }, 120_000);
});
