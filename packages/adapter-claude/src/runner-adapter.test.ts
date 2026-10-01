import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, lstat, mkdir, writeFile, symlink, rename, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { getDefaultDeckConfig, getAgentContent } from "../../core/src/index";
import { buildCapabilityInstructionBundle, validateSerenaOperationAuthorization, type SerenaBootstrapRequest, type SerenaReadinessEvidence } from "../../core/src/index";
import { createClaudeRunnerAdapter } from "./runner-adapter";
import { TAVILY_PROVIDER_DESCRIPTOR } from "../../provider-tavily/src/index";
import { createHash } from "node:crypto";
import { CLAUDE_SUPERMEMORY_COMMIT } from "./supermemory-artifact";
import { claudeModelMetadata } from "./models";
import { gzipSync } from "node:zlib";

describe("Claude Deck-owned global plugin adapter", () => {
  test("late discovery results cannot replace or clear a newer ready snapshot across roots", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-model-generation-"));
    try {
      for (const scope of ["same-root", "other-root"] as const) for (const late of ["success", "failure", "cancel"] as const) {
        let resolveOld!: (models: { value: string; displayName: string; description: string }[]) => void;
        let rejectOld!: (error: Error) => void;
        const rootA = join(home, "a"), rootB = scope === "same-root" ? rootA : join(home, "b");
        let requests = 0;
        const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => ++requests === 1 ? await new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }) : [{ value: "newer-id", displayName: "Newer", description: "fixture", supportsEffort: true, supportedEffortLevels: ["max"] }] });
        const controller = new AbortController(); const old = adapter.getModelInventory!({ projectRoot: rootA, signal: controller.signal });
        expect((await adapter.getModelInventory!({ projectRoot: rootB })).state).toBe("ready");
        if (late === "failure") rejectOld(new Error("old failure"));
        else { if (late === "cancel") controller.abort(); resolveOld([{ value: "older-id", displayName: "Older", description: "fixture" }]); }
        await old;
        expect(adapter.getThinkingLevels("newer-id")).toEqual(["max"]);
        const input = { environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), modelAssignments: { "deck-lead": "newer-id" } };
        expect(adapter.buildDeveloperTeamInstallPlan({ ...input, projectRoot: rootB }).blocked).toBe(false);
        expect(adapter.buildDeveloperTeamInstallPlan({ ...input, projectRoot: rootA }).blocked).toBe(scope !== "same-root");
        expect(adapter.buildDeveloperTeamInstallPlan({ ...input, projectRoot: rootB, modelAssignments: { "deck-lead": "older-id" } }).blocked).toBe(true);
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("model frontmatter roundtrips boolean, null and numeric-looking IDs as exact strings", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-model-yaml-"));
    try {
      const ids = ["true", "false", "null", "123", "1.25"];
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => ids.map((value) => ({ value, displayName: value, description: "fixture" })) });
      await adapter.getModelInventory!({ projectRoot: home });
      for (const id of ids) {
        const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), modelAssignments: { "deck-lead": id } });
        expect(plan.blocked).toBe(false);
        const matter = plan.files.find((file) => file.path.endsWith("/agents/deck-lead.md"))!.content.split("---")[1]!;
        expect((Bun.YAML.parse(matter) as { model: unknown }).model).toBe(id);
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("lost selected executable can be deselected or republished at a new immutable content version", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-capability-repair-"));
    try {
      const first = join(home, "first-context-mode");
      const replacement = join(home, "replacement-context-mode");
      await writeFile(first, "fixture executable", { mode: 0o700 });
      await writeFile(replacement, "fixture executable", { mode: 0o700 });
      let current: string | undefined = first;
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => name === "context-mode" ? current : undefined });
      const deckConfig = getDefaultDeckConfig();
      const selected = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, capabilityIds: ["claude-team-files", "context-mode"] });
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: selected });
      const original = selected.files.find((file) => file.path.endsWith("/.mcp.json"))!;
      current = undefined;
      expect(adapter.readSelectedCapabilityIds?.(home)).toEqual(["context-mode"]);
      expect((await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("blocked");
      const review = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true, "context-mode": true }, packageInstructions: { "context-mode": true }, adaptiveMemory: { provider: "none" } } as never, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(review.ready).toBe(true);
      expect(review.groups.automaticInstalls.map((action) => action.capabilityId)).toEqual(["context-mode"]);
      const deselect = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, capabilityIds: ["claude-team-files"] });
      expect(deselect.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: deselect });
      expect((await adapter.verifyDeveloperTeamInstall(deselect)).valid).toBe(true);
      expect(adapter.readSelectedCapabilityIds?.(home)).toEqual([]);
      current = replacement;
      const repaired = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, capabilityIds: ["claude-team-files", "context-mode"] });
      expect(repaired.blocked).toBe(false);
      expect(repaired.files.find((file) => file.path.endsWith("/.mcp.json"))!.path).not.toBe(original.path);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: repaired });
      expect((await adapter.verifyDeveloperTeamInstall(repaired)).valid).toBe(true);
      expect(await readFile(original.path, "utf8")).toBe(original.content);
      expect(repaired.files.find((file) => file.path.endsWith("/.mcp.json"))?.content).toContain(replacement);
      expect(adapter.readSelectedCapabilityIds?.(home)).toEqual(["context-mode"]);
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("Claude review treats packageInstructions as authoritative over stale selectedCapabilities", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-authoritative-package-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => name === "context-mode" ? process.execPath : undefined });
      const deckConfig = getDefaultDeckConfig();
      const selected = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, capabilityIds: ["claude-team-files", "context-mode"] });
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: selected });
      const withoutPackage = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, capabilityIds: ["claude-team-files"] });
      const desiredRoot = dirname(dirname(withoutPackage.files[0]!.path));
      const review = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true, "context-mode": true }, packageInstructions: { "context-mode": false }, adaptiveMemory: { provider: "none" } } as never, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(review.ready).toBe(true);
      expect(review.groups.teamApplications[0]?.description).toContain(desiredRoot);
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("legacy v1 receipt remains readable and a stale owned plugin is superseded without rewriting it", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-v1-upgrade-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck") });
      const input = { projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig() };
      const initial = adapter.buildDeveloperTeamInstallPlan(input);
      const newRoot = dirname(dirname(initial.files[0]!.path));
      const oldRoot = join(home, "data", "deck", "claude", "developer-team-v1");
      for (const file of initial.files) {
        const target = join(oldRoot, relative(newRoot, file.path));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, file.content, { mode: 0o600 });
      }
      await writeFile(join(home, "data", "deck", "claude", "model-assignments.json"), claudeModelMetadata({}, []), { mode: 0o600 });
      const reused = adapter.buildDeveloperTeamInstallPlan(input);
      expect(reused.blocked).toBe(false);
      expect(reused.files[0]?.path).toBe(join(oldRoot, ".claude-plugin", "plugin.json"));
      const previous = join(oldRoot, "agents", "deck-lead.md");
      await writeFile(previous, (await readFile(previous, "utf8")) + "\nlegacy canonical content\n");
      const upgraded = adapter.buildDeveloperTeamInstallPlan(input);
      expect(upgraded.blocked).toBe(false);
      expect(upgraded.files[0]?.path).toMatch(/developer-team-v2-[a-f0-9]{16}\/\.claude-plugin\/plugin\.json$/);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: upgraded });
      expect((await adapter.verifyDeveloperTeamInstall(upgraded)).valid).toBe(true);
      expect(await readFile(previous, "utf8")).toContain("legacy canonical content");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("read-only roles expose only selected MCP lookups and Skill, never editing tools", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-readonly-"));
    try {
      const commands = new Map(["context7-mcp", "codebase-memory-mcp", "context-mode"].map((name) => [name, process.execPath]));
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => commands.get(name) });
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files", "context7", "codebase-memory", "context-mode"] });
      expect(plan.blocked).toBe(false);
      const investigator = plan.files.find((file) => file.path.endsWith("/agents/deck-investigate.md"))?.content ?? "";
      const reviewer = plan.files.find((file) => file.path.endsWith("/agents/deck-quality.md"))?.content ?? "";
      for (const role of [investigator, reviewer]) {
        const frontmatter = role.split("---")[1] ?? "";
        expect(frontmatter).toContain("tools: Read, Grep, Glob, Skill");
        expect(frontmatter).toContain("mcp__plugin_deck-developer-team_context7__query-docs");
        expect(frontmatter).toContain("mcp__plugin_deck-developer-team_codebase-memory__search_graph");
        expect(frontmatter).toContain("mcp__plugin_deck-developer-team_context-mode__ctx_search");
        expect(frontmatter).not.toMatch(/mcp__(?!plugin_deck-developer-team_)/);
        expect(frontmatter).not.toMatch(/mcp__[^\n]*?(?:replace|rename|delete|insert|execute|manage_adr)/);
      }
      const bare = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files"] });
      expect(bare.files.find((file) => file.path.endsWith("/agents/deck-quality.md"))?.content).not.toContain("mcp__");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("runner detection distinguishes verified Claude CLI version from documented model aliases", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-version-"));
    try {
      const ready = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), detectClaudeVersion: () => ({ available: true, version: "2.1.284" }) });
      expect(await ready.detectRuntimes({ projectRoot: home, environmentId: "claude-development" })).toMatchObject([{ isAvailable: true, version: "2.1.284" }]);
      const absent = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), detectClaudeVersion: () => ({ available: false }), modelDiscovery: async () => { throw new Error("missing runtime"); } });
      expect(await absent.detectRuntimes({ projectRoot: home, environmentId: "claude-development" })).toMatchObject([{ isAvailable: false }]);
      expect((await absent.getModelInventory!({ projectRoot: home })).state).toBe("blocked");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("runtime-reported effort is selectable only for compatible models and persists native exact model/effort frontmatter", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-runtime-effort-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => [{ value: "custom-runtime-id", resolvedModel: "wire-v3", displayName: "Custom", description: "fixture", supportsEffort: true, supportedEffortLevels: ["medium", "max"] }, { value: "light-model", displayName: "Light", description: "fixture", supportsEffort: false }] });
      expect(adapter.getThinkingLevels("custom-runtime-id")).toEqual([]);
      const discovery = await adapter.getModelInventory!({ projectRoot: home });
      expect(discovery.state).toBe("ready");
      expect(adapter.getThinkingLevels("custom-runtime-id")).toEqual(["medium", "max"]);
      expect(adapter.getThinkingLevels("wire-v3")).toEqual(["medium", "max"]);
      expect(adapter.getThinkingLevels("light-model")).toEqual([]);
      const input = { projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), modelAssignments: { "deck-lead": "wire-v3" }, thinkingAssignments: { "deck-lead": "max" } };
      expect((await adapter.validateModelAssignments!({ ...input, changedAgentIds: ["deck-lead"] })).valid).toBe(true);
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(plan.blocked).toBe(false);
      expect(plan.files.find((file) => file.path.endsWith("/agents/deck-lead.md"))?.content).toContain('\nmodel: "wire-v3"\neffort: max\n');
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      expect(adapter.readThinkingAssignments(home)).toEqual({ "deck-lead": "max" });
      const resumed = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => { throw new Error("offline"); } });
      expect(resumed.readModelAssignments(home)).toEqual({ "deck-lead": "wire-v3" });
      expect(resumed.readThinkingAssignments(home)).toEqual({ "deck-lead": "max" });
      expect(resumed.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig() }).blocked).toBe(false);
      expect(adapter.buildDeveloperTeamInstallPlan({ ...input, thinkingAssignments: { "deck-lead": "high" } }).blocked).toBe(true);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("Claude Serena requires current-operation authorization and revalidated Deck-owned proxy before MCP publication", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-serena-authorization-"));
    try {
      const dataRoot = join(home, "data", "deck");
      const ownedRoot = join(dataRoot, "tools", "serena");
      const executable = join(ownedRoot, "bin", "serena");
      await mkdir(join(ownedRoot, "bin"), { recursive: true, mode: 0o700 });
      await writeFile(executable, "fixture Serena executable", { mode: 0o700 });
      const deckCli = join(home, "deck-cli");
      await writeFile(deckCli, "fixture Deck proxy", { mode: 0o700 });
      const evidence: SerenaReadinessEvidence = { capabilityId: "serena", state: "ready", resolvedExecutablePath: executable, source: "installed-deck-tool", probe: "serena-help", fingerprint: "fixture-serena-fingerprint" };
      let bootstrapCalls = 0;
      let fresh = true;
      const adapter = createClaudeRunnerAdapter({
        homeDir: home, dataRoot, serenaOwnedRoot: ownedRoot,
        serenaProxyCommand: [deckCli, "internal", "serena-mcp"],
        serenaReadiness: async () => ({ state: "missing", diagnostic: { code: "serena-not-ready", message: "fixture missing" } }),
        serenaBootstrap: async (request: SerenaBootstrapRequest) => {
          bootstrapCalls++;
          expect(validateSerenaOperationAuthorization(request.authorization, request.currentOperation).valid).toBe(true);
          return { outcome: "installed", evidence };
        },
        serenaRevalidate: async () => fresh,
      });
      const reviewed = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true, serena: true }, explicitlySelectedCapabilities: { serena: true }, packageInstructions: { serena: true }, adaptiveMemory: { provider: "none" } }, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(reviewed.ready).toBe(true);
      expect(reviewed.groups.automaticInstalls[0]?.kind).toBe("install-serena");
      const action = reviewed.groups.automaticInstalls[0]!;
      const auth = { kind: "interactive-tui-explicit-selection" as const, runner: "claude" as const, operationId: "claude-test-op" };
      const currentOperation = { runner: "claude" as const, operationId: "claude-test-op", explicitlySelected: true };
      expect((await adapter.runAction(action, { projectRoot: home, runnerId: "claude", environmentId: "claude-development", serenaAuthorization: auth, currentOperation: { ...currentOperation, explicitlySelected: false } })).status).toBe("failed");
      expect(bootstrapCalls).toBe(0);
      expect((await adapter.runAction(action, { projectRoot: home, runnerId: "claude", environmentId: "claude-development", serenaAuthorization: auth, currentOperation })).status).toBe("executed");
      expect(bootstrapCalls).toBe(1);
      const config = getDefaultDeckConfig();
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "serena"], capabilityInstructions: buildCapabilityInstructionBundle(["serena"]) });
      expect(plan.blocked).toBe(false);
      const serenaTools = plan.files.find((file) => file.path.endsWith("/agents/deck-quality.md"))!.content.split("---")[1]!;
      expect(serenaTools).toContain("mcp__plugin_deck-developer-team_serena__find_symbol");
      expect(serenaTools).not.toContain("mcp__serena__");
      expect(serenaTools).not.toContain("mcp__plugin_deck-developer-team_serena__replace_symbol_body");
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      const configFile = plan.files.find((file) => file.path.endsWith("/.mcp.json"));
      expect(JSON.parse(configFile!.content).mcpServers.serena).toEqual({ command: deckCli, args: ["internal", "serena-mcp"] });
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      expect(await adapter.detectDeckInstall?.({ projectRoot: home })).toMatchObject({ installed: true, managedPaths: expect.arrayContaining([plan.files[0]!.path]) });
      const resumed = createClaudeRunnerAdapter({ homeDir: home, dataRoot, serenaOwnedRoot: ownedRoot, serenaProxyCommand: [deckCli, "internal", "serena-mcp"], serenaReadiness: async () => ({ state: "ready", evidence, revalidate: async () => ({ valid: true, evidence }) }), serenaRevalidate: async () => true });
      expect((await resumed.getCapabilityInventory({ projectRoot: home, runnerId: "claude", environmentId: "claude-development", deckConfig: config })).capabilities.find((entry) => entry.capabilityId === "serena")?.isInstalled).toBe(true);
      expect((await resumed.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig: config })).status).toBe("ready");
      fresh = false;
      expect((await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig: config })).status).toBe("blocked");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("reviewed pinned RTK acquisition installs only a Deck-owned binary and native Claude hook", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-rtk-review-"));
    const binary = Buffer.from("fixture RTK binary, never executed");
    const header = Buffer.alloc(512);
    header.write("rtk");
    header.write(`${binary.length.toString(8).padStart(11, "0")}\0`, 124);
    header[156] = 48;
    const archive = gzipSync(Buffer.concat([header, binary, Buffer.alloc((512 - binary.length % 512) % 512), Buffer.alloc(1024)]));
    const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
    const release = { asset: "rtk-fixture.tar.gz", archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };
    try {
      const dataRoot = join(home, "data", "deck");
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot, resolveCommand: () => undefined, verifyRtkCommand: () => true, rtkReleaseOverride: release, rtkArtifactEffects: { fetchArchive: async () => archive } });
      const review = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: { rtk: true }, adaptiveMemory: { provider: "none" } }, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(review.ready).toBe(true);
      expect(review.groups.automaticInstalls[0]?.kind).toBe("install-claude-rtk");
      expect((await adapter.runAction(review.groups.automaticInstalls[0]!, { projectRoot: home, runnerId: "claude", environmentId: "claude-development" })).status).toBe("executed");
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files", "rtk"] });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      const hook = plan.files.find((file) => file.path.endsWith("/hooks/hooks.json"));
      expect(hook?.content).toContain(join(dataRoot, "claude", "tools", "rtk-v0.50.0", `${process.platform}-${process.arch}`, "rtk"));
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      await expect(lstat(join(home, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("an executable ambient RTK lacking an approved version or Claude hook cannot bypass pinned acquisition", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-rtk-ambient-"));
    try {
      const fake = join(home, "rtk");
      await writeFile(fake, "#!/bin/sh\necho 'rtk 0.45.0'\n", { mode: 0o700 });
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => name === "rtk" ? fake : undefined });
      const state = { runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: { rtk: true }, adaptiveMemory: { provider: "none" } } as const;
      expect(adapter.buildReviewPlan(state, { runnerId: "claude", environmentId: "claude-development", capabilities: [] }).groups.automaticInstalls[0]?.kind).toBe("install-claude-rtk");
      await writeFile(fake, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'rtk 0.50.0'; else echo 'unknown hook'; fi\n", { mode: 0o700 });
      expect(adapter.buildReviewPlan(state, { runnerId: "claude", environmentId: "claude-development", capabilities: [] }).groups.automaticInstalls[0]?.kind).toBe("install-claude-rtk");
      await expect(lstat(join(home, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("reviewed official plugin receipt gates an independent supervised memory launch", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-memory-install-"));
    const pluginManifest = Buffer.from('{"name":"supermemory"}\n');
    const checksum = createHash("sha256").update(pluginManifest).digest("hex");
    const manifest = [[".claude-plugin/plugin.json", checksum, pluginManifest.length]] as const;
    try {
      execFileSync("git", ["init", "-q"], { cwd: home });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo.git"], { cwd: home });
      const config = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const } } as ReturnType<typeof getDefaultDeckConfig>;
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), officialPluginManifest: manifest, supermemoryArtifactEffects: { fetchFile: async () => pluginManifest }, resolveMemoryCredential: () => ({ token: "fixture-shared-memory-token", profile: "default", canonicalRepoTag: "sm_project_v1_acme_repo" }) });
      const input = { projectRoot: home, teamId: "developer-team", mode: "interactive" as const, deckConfig: config };
      expect((await adapter.buildLaunchPlan!(input)).status).toBe("blocked");
      expect((await adapter.getCapabilityInventory({ projectRoot: home, environmentId: "claude-development", runnerId: "claude", deckConfig: config })).capabilities.find((entry) => entry.capabilityId === "adaptive-memory")?.isInstalled).toBe(false);
      const reviewed = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: {}, adaptiveMemory: { provider: "supermemory", supermemory: { configured: true } }, runtime: { projectIdentity: "verified", projectRoot: home } } as never, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(reviewed.groups.automaticInstalls[0]?.kind).toBe("install-claude-supermemory");
      const installed = await adapter.runAction(reviewed.groups.automaticInstalls[0]!, { projectRoot: home, runnerId: "claude", environmentId: "claude-development" });
      expect(installed.status).toBe("executed");
      expect((await adapter.getCapabilityInventory({ projectRoot: home, environmentId: "claude-development", runnerId: "claude", deckConfig: config })).capabilities.find((entry) => entry.capabilityId === "adaptive-memory")?.isInstalled).toBe(true);
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      const ready = await adapter.buildLaunchPlan!(input);
      expect(ready.status).toBe("ready");
      if (ready.status !== "ready") return;
      expect(ready.plan.args).toEqual(["--plugin-dir", dirname(dirname(plan.files[0]!.path)), "--plugin-dir", join(home, "data", "deck", "claude", `official-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0, 12)}`), "--agent", "deck-developer-team:deck-lead"]);
      expect(ready.plan.envOverlay?.SUPERMEMORY_CC_API_KEY?.sensitive).toBe(true);
      expect(ready.plan.envOverlay?.SUPERMEMORY_REPO_TAG?.value).toBe("sm_project_v1_acme_repo");
      expect(JSON.stringify(plan.files)).not.toContain("fixture-shared-memory-token");
      const withoutNode = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), officialPluginManifest: manifest, verifyNodeRuntime: () => false, resolveMemoryCredential: () => ({ token: "fixture-shared-memory-token", profile: "default", canonicalRepoTag: "sm_project_v1_acme_repo" }) });
      expect((await withoutNode.buildLaunchPlan!(input)).status).toBe("blocked");
      expect(withoutNode.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config }).blocked).toBe(true);
      const disabled = await adapter.buildLaunchPlan!({ ...input, deckConfig: getDefaultDeckConfig() });
      expect(disabled.status).toBe("ready");
      expect((await adapter.buildLaunchPlan!({ ...input, deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: false, activeProvider: "supermemory" } } as typeof config })).status).toBe("blocked");
      if (disabled.status === "ready") {
        expect(disabled.plan.args).toEqual(["--plugin-dir", dirname(dirname(plan.files[0]!.path)), "--agent", "deck-developer-team:deck-lead"]);
        expect(disabled.plan.envOverlay?.SUPERMEMORY_CC_API_KEY).toBeUndefined();
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("unresolved shared profile or project override blocks memory review before official download", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-memory-preflight-"));
    let fetched = false;
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), supermemoryArtifactEffects: { fetchFile: async () => { fetched = true; return new Uint8Array(); } }, resolveMemoryCredential: () => { throw new Error("fixture-private-token project override"); } });
      const plan = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: {}, adaptiveMemory: { provider: "supermemory", supermemory: { configured: true } }, runtime: { projectIdentity: "verified", projectRoot: home } } as never, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(plan.ready).toBe(false);
      expect(JSON.stringify(plan)).not.toContain("fixture-private-token");
      expect(fetched).toBe(false);
      await expect(lstat(join(home, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("locally validates the composed plugin with Claude when its CLI is available, without a model call", async () => {
    const claude = Bun.which("claude");
    if (!claude) return;
    const home = await mkdtemp(join(tmpdir(), "deck-claude-plugin-validate-"));
    try {
      const rtk = join(home, "rtk");
      await writeFile(rtk, "fixture", { mode: 0o700 });
      const contextMode = join(home, "context-mode");
      await writeFile(contextMode, "fixture", { mode: 0o700 });
      const tavily = join(home, "tavily-mcp");
      await writeFile(tavily, "fixture", { mode: 0o700 });
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => name === "rtk" ? rtk : name === "context-mode" ? contextMode : name === "tavily-mcp" ? tavily : undefined, verifyRtkCommand: () => true, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR, webSearchCredential: () => "fixture-no-provider-call", modelDiscovery: async () => [{ value: "custom-native-model-id", displayName: "Custom", description: "fixture", supportsEffort: true, supportedEffortLevels: ["max"] }] });
      await adapter.getModelInventory!({ projectRoot: home });
      const config = { ...getDefaultDeckConfig(), webSearch: { enabled: true, provider: "tavily" } } as ReturnType<typeof getDefaultDeckConfig>;
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "rtk", "context-mode", "web-search"], modelAssignments: { "deck-lead": "custom-native-model-id" }, thinkingAssignments: { "deck-lead": "max" } });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      const launch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig: config });
      expect(launch.status).toBe("ready");
      if (launch.status !== "ready") return;
      const validated = spawnSync(claude, ["plugin", "validate", launch.plan.args[1]!, "--json"], { cwd: home, encoding: "utf8", timeout: 15_000, env: { HOME: home, PATH: process.env.PATH ?? "" } });
      expect(validated.status).toBe(0);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("materializes selected global MCP and RTK hook from shared tools and Tavily provider without persisting a token", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-capabilities-"));
    try {
      await mkdir(join(home, "bin"));
      for (const binary of ["context-mode", "codebase-memory-mcp", "rtk", "context7-mcp", "tavily-mcp"]) await writeFile(join(home, "bin", binary), "fixture executable", { mode: 0o700 });
      const commands = new Map([
        ["context-mode", join(home, "bin", "context-mode")],
        ["codebase-memory-mcp", join(home, "bin", "codebase-memory-mcp")],
        ["rtk", join(home, "bin", "rtk")],
        ["context7-mcp", join(home, "bin", "context7-mcp")],
        ["tavily-mcp", join(home, "bin", "tavily-mcp")],
      ]);
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: (name) => commands.get(name), verifyRtkCommand: () => true, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR, webSearchCredential: () => "fake-shared-tavily-token" });
      const deckConfig = { ...getDefaultDeckConfig(), webSearch: { enabled: true, provider: "tavily" } } as ReturnType<typeof getDefaultDeckConfig>;
      const capabilities = ["claude-team-files", "context-mode", "codebase-memory", "rtk", "context7", "web-search"];
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, capabilityIds: capabilities });
      expect(plan.blocked).toBe(false);
      const mcp = plan.files.find((file) => file.path.endsWith("/.mcp.json"));
      expect(mcp).toBeDefined();
      const servers = JSON.parse(mcp!.content).mcpServers;
      expect(Object.keys(servers).sort()).toEqual(["codebase-memory", "context-mode", "context7", "web-search"]);
      expect(servers["web-search"].command).toBe(join(home, "bin", "tavily-mcp"));
      expect(mcp!.content).not.toContain("fake-shared-tavily-token");
      const searchTools = plan.files.find((file) => file.path.endsWith("/agents/deck-quality.md"))!.content.split("---")[1]!;
      expect(searchTools).toContain("mcp__plugin_deck-developer-team_web-search__tavily_search");
      expect(searchTools).not.toContain("mcp__web-search__");
      expect(searchTools).not.toContain("mcp__plugin_deck-developer-team_web-search__tavily_crawl");
      expect(plan.files.find((file) => file.path.endsWith("/agents/deck-lead.md"))?.content).toContain("Context Mode");
      const hooks = plan.files.find((file) => file.path.endsWith("/hooks/hooks.json"));
      expect(hooks).toBeDefined();
      expect(JSON.parse(hooks!.content).hooks.PreToolUse[0].matcher).toBe("Bash");
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      const launch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig });
      expect(launch.status).toBe("ready");
      if (launch.status === "ready") {
        expect(launch.plan.envOverlay?.TAVILY_API_KEY?.sensitive).toBe(true);
        expect(launch.plan.args.join(" ")).not.toContain("fake-shared-tavily-token");
      }
      const disabled = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files"] });
      expect(disabled.files.some((file) => file.path.endsWith("/.mcp.json") || file.path.endsWith("/hooks/hooks.json"))).toBe(false);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("missing Serena proxy/bootstrap and missing shared Tavily credential block reviewed native files", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-capability-block-"));
    try {
      const tavily = join(root, "tavily-mcp");
      await writeFile(tavily, "fixture", { mode: 0o700 });
      const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, "data", "deck"), resolveCommand: (name) => name === "tavily-mcp" ? tavily : undefined, webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR, webSearchCredential: () => undefined });
      const config = getDefaultDeckConfig();
      expect(adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "serena"] }).blocked).toBe(true);
      const searchConfig = { ...config, webSearch: { enabled: true, provider: "tavily" } } as typeof config;
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: searchConfig, capabilityIds: ["claude-team-files", "web-search"] });
      expect(plan.blocked).toBe(true);
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan })).rejects.toThrow();
      await expect(lstat(join(root, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("failed reviewed shared-tool install never creates a plugin or claims executable readiness", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-tool-failure-"));
    try {
      const attempted: string[] = [];
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), resolveCommand: () => undefined, installSharedTool: async (id) => { attempted.push(id); return false; } });
      const review = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: { "context-mode": true }, adaptiveMemory: { provider: "none" } }, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(review.groups.automaticInstalls).toHaveLength(1);
      expect(review.groups.teamApplications[0]?.dependencies).toEqual([review.groups.automaticInstalls[0]?.id]);
      const action = await adapter.runAction(review.groups.automaticInstalls[0]!, { projectRoot: home, runnerId: "claude", environmentId: "claude-development" });
      expect(action.status).toBe("failed");
      expect(attempted).toEqual(["context-mode"]);
      await expect(lstat(join(home, "data"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("discovers runtime models without claiming entitlement, and persists exact per-role identifiers globally", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-model-alias-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => ["sonnet", "opus", "haiku", "custom-vendor/model-2030"].map((value) => ({ value, displayName: value, description: "runtime fixture" })) });
      const discovered = await adapter.getModelInventory!({ projectRoot: home });
      expect(discovered.state).toBe("ready");
      if (discovered.state === "blocked") return;
      expect(discovered.inventory.modelsByProvider.claude?.map((model) => model.id)).toEqual(["sonnet", "opus", "haiku", "custom-vendor/model-2030", "inherit"]);
      expect(discovered.inventory.diagnostics?.join(" ")).toContain("no inference message or provider entitlement check");
      const deckConfig = getDefaultDeckConfig();
      const first = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig });
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: first });
      const customized = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, modelAssignments: { "deck-apply-deep": "opus", "deck-investigate": "haiku" } });
      expect(customized.blocked).toBe(false);
      expect(customized.mutationPreview?.length).toBeGreaterThan(0);
      const reviewed = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: {}, adaptiveMemory: { provider: "none" }, teams: { "developer-team": { modelAssignments: { "deck-apply-deep": "opus", "deck-investigate": "haiku" } } } } as never, { runnerId: "claude", environmentId: "claude-development", capabilities: [] });
      expect(reviewed.ready).toBe(true);
      expect(reviewed.diagnostics[0]?.message).toContain("Update Deck-owned model selection");
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: customized });
      expect((await adapter.verifyDeveloperTeamInstall(customized)).valid).toBe(true);
      const metadataPath = join(home, "data", "deck", "claude", "model-assignments.json");
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      expect(metadata).toMatchObject({ schema: "deck-claude-models-v2", assignments: { "deck-apply-deep": "opus", "deck-investigate": "haiku" } });
      expect(metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(metadata.plugin).toMatch(/^developer-team-v2-[a-f0-9]{16}$/);
      expect((await lstat(metadataPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(first.files[0]!.path, "utf8")).toContain("deck-developer-team");
      expect(adapter.readModelAssignments(home)).toEqual({ "deck-apply-deep": "opus", "deck-investigate": "haiku" });
      const agent = customized.files.find((file) => file.path.endsWith("/agents/deck-apply-deep.md"));
      expect(agent?.content).toContain('\nmodel: "opus"\n');
      const launch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig });
      expect(launch.status).toBe("ready");
      expect(launch.status === "ready" && launch.plan.args[1]).toContain("developer-team-v2-");
      const repeat = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, modelAssignments: adapter.readModelAssignments(home) });
      expect(repeat.mutationPreview).toHaveLength(0);
      expect((await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: repeat })).changedCount).toBe(0);
      const switched = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, modelAssignments: { "deck-lead": "sonnet" } });
      expect(switched.mutationPreview?.some((mutation) => mutation.path.endsWith("/model-assignments.json"))).toBe(true);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: switched });
      expect((await adapter.verifyDeveloperTeamInstall(switched)).valid).toBe(true);
      expect(adapter.readModelAssignments(home)).toEqual({ "deck-lead": "sonnet" });
      expect((await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("ready");
      const restored = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, modelAssignments: {} });
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: restored });
      expect(adapter.readModelAssignments(home)).toEqual({});
      expect((await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("ready");
      const invalid = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, modelAssignments: { "deck-apply-deep": "gpt-4" } });
      expect(invalid.blocked).toBe(true);
      const exact = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig, modelAssignments: { "deck-apply-deep": "custom-vendor/model-2030" } });
      expect(exact.blocked).toBe(false);
      expect(exact.files.find((file) => file.path.endsWith("/agents/deck-apply-deep.md"))?.content).toContain('\nmodel: "custom-vendor/model-2030"\n');
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan: exact });
      const offline = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), modelDiscovery: async () => { throw new Error("offline"); } });
      expect((await offline.getModelInventory!({ projectRoot: home })).state).toBe("blocked");
      expect(offline.readModelAssignments(home)).toEqual({ "deck-apply-deep": "custom-vendor/model-2030" });
      expect(offline.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig }).blocked).toBe(false);
      expect((await offline.validateModelAssignments!({ projectRoot: home, modelAssignments: { "deck-lead": "new-id" }, thinkingAssignments: {}, changedAgentIds: ["deck-lead"] })).valid).toBe(false);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("caller mutation of planned content, path or membership cannot modify trusted expected files", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-plan-isolation-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, "data", "deck") });
      const deckConfig = getDefaultDeckConfig();
      const input = { projectRoot: root, environmentId: "claude-development", deckConfig };
      const original = { ...adapter.buildDeveloperTeamInstallPlan(input).files[0]! };
      for (const mutate of [
        (entries: { path: string; content: string }[]) => { entries[0]!.content = "foreign manifest"; },
        (entries: { path: string; content: string }[]) => { entries[1]!.path = join(root, "foreign.md"); },
        (entries: { path: string; content: string }[]) => { entries.splice(2, 1); },
        (entries: { path: string; content: string }[]) => { entries.reverse(); },
      ]) {
        const candidate = adapter.buildDeveloperTeamInstallPlan(input);
        mutate(candidate.files as { path: string; content: string }[]);
        expect((await adapter.verifyDeveloperTeamInstall(candidate)).valid).toBe(false);
        await expect(adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: candidate })).rejects.toThrow("stale or untrusted");
        await expect(lstat(join(root, "data"))).rejects.toMatchObject({ code: "ENOENT" });
      }
      const fresh = adapter.buildDeveloperTeamInstallPlan(input);
      expect(fresh.files).toHaveLength(15);
      expect(fresh.files[0]).toEqual(original);
      expect(fresh.files[1]!.path).not.toBe(join(root, "foreign.md"));
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: fresh });
      expect((await adapter.verifyDeveloperTeamInstall(fresh)).valid).toBe(true);
      for (const mutate of [
        (entries: { path: string; content: string }[]) => { entries[0]!.content = "foreign after apply"; },
        (entries: { path: string; content: string }[]) => { entries[1]!.path = join(root, "foreign.md"); },
        (entries: { path: string; content: string }[]) => { entries.pop(); },
        (entries: { path: string; content: string }[]) => { entries.reverse(); },
      ]) {
        const candidate = adapter.buildDeveloperTeamInstallPlan(input);
        mutate(candidate.files as { path: string; content: string }[]);
        expect((await adapter.verifyDeveloperTeamInstall(candidate)).valid).toBe(false);
      }
      expect(adapter.buildDeveloperTeamInstallPlan(input).files[0]).toEqual(original);
      expect((await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("ready");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects a valid plugin under a symlinked ancestor before plan/apply/launch", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-ancestor-symlink-"));
    try {
      const dataRoot = join(root, "data", "deck");
      const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot });
      const deckConfig = getDefaultDeckConfig();
      const input = { projectRoot: root, environmentId: "claude-development", deckConfig };
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan });
      await rename(dataRoot, `${dataRoot}-saved`);
      await symlink(`${dataRoot}-saved`, dataRoot);
      expect(adapter.buildDeveloperTeamInstallPlan(input).blocked).toBe(true);
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan })).rejects.toThrow();
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(false);
      expect((await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("blocked");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects foreign-writable ancestors for absent plugin and after a previously valid install", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-ancestor-mode-"));
    try {
      const data = join(root, "data");
      await mkdir(data);
      await chmod(data, 0o777);
      const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(data, "deck") });
      const deckConfig = getDefaultDeckConfig();
      const input = { projectRoot: root, environmentId: "claude-development", deckConfig };
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(plan.blocked).toBe(true);
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan })).rejects.toThrow();
      await expect(lstat(join(data, "deck"))).rejects.toMatchObject({ code: "ENOENT" });
      await chmod(data, 0o700);
      const clean = adapter.buildDeveloperTeamInstallPlan(input);
      await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: clean });
      await chmod(data, 0o777);
      expect(adapter.buildDeveloperTeamInstallPlan(input).blocked).toBe(true);
      expect((await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("blocked");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("canonicalizes a caller-approved HOME alias but still rejects symlinks inside it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deck-claude-home-alias-"));
    try {
      const actualHome = join(parent, "real-home");
      const alias = join(parent, "home-alias");
      await mkdir(actualHome, { mode: 0o700 });
      await symlink(actualHome, alias);
      const adapter = createClaudeRunnerAdapter({ homeDir: alias, dataRoot: join(alias, "data", "deck") });
      const config = getDefaultDeckConfig();
      const input = { projectRoot: actualHome, environmentId: "claude-development", deckConfig: config };
      const plan = adapter.buildDeveloperTeamInstallPlan(input);
      expect(plan.blocked).toBe(false);
      expect(plan.files[0]!.path.startsWith(actualHome)).toBe(true);
      await adapter.applyDeveloperTeamInstall({ projectRoot: actualHome, environmentId: "claude-development", plan });
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  test("never infers a global plugin root from a missing or relative HOME", () => {
    expect(() => createClaudeRunnerAdapter({ homeDir: "", dataRoot: "/tmp/deck" })).toThrow("absolute user HOME");
    expect(() => createClaudeRunnerAdapter({ homeDir: "relative/home", dataRoot: "/tmp/deck" })).toThrow("absolute user HOME");
    expect(() => createClaudeRunnerAdapter({ homeDir: "/tmp", dataRoot: "relative/deck" })).toThrow("data root must be absolute");
    expect(() => createClaudeRunnerAdapter({ homeDir: "/tmp", dataRoot: "/tmp" })).toThrow("dedicated Deck data root");
  });
  test("unknown global model metadata fails closed without replacing it or selecting a plugin", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-model-conflict-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck") });
      const deckConfig = getDefaultDeckConfig();
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig });
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      const path = join(home, "data", "deck", "claude", "model-assignments.json");
      await writeFile(path, "unowned conflict");
      expect(adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig }).blocked).toBe(true);
      expect((await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig })).status).toBe("blocked");
      expect(await readFile(path, "utf8")).toBe("unowned conflict");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("TUI adapter plans, applies and verifies canonical user-global plugin without writing to the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-adapter-"));
    const projectRoot = join(root, "project");
    const dataRoot = join(root, "data", "deck");
    try {
      await mkdir(projectRoot);
      const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot });
      expect(adapter.environmentIds).toEqual(["claude-development"]);
      const config = getDefaultDeckConfig();
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "claude-development", deckConfig: config });
      expect(plan.blocked).toBe(false);
      expect(plan.files).toHaveLength(15);
      expect(plan.mutationPreview?.length).toBe(16);
      expect(plan.files.every((file) => file.path.startsWith(join(dataRoot, "claude")))).toBe(true);
      const applied = await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "claude-development", plan });
      expect(applied.results.length).toBe(15);
      expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
      const plugin = dirname(dirname(plan.files[0]!.path));
      expect(JSON.parse(await readFile(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name).toBe("deck-developer-team");
      expect(await readFile(join(plugin, "agents", "deck-lead.md"), "utf8")).toContain(getAgentContent("deck-lead", { promptProfile: "legacy" })!.agentBody);
      const lead = await readFile(join(plugin, "agents", "deck-lead.md"), "utf8");
      expect(lead).toContain("skills:\n  - deck-developer-team:deck-lead");
      for (const role of ["deck-investigate", "deck-quality"]) {
        expect(await readFile(join(plugin, "agents", `${role}.md`), "utf8")).toContain("tools: Read, Grep, Glob");
      }
      expect((await lstat(plugin)).mode & 0o777).toBe(0o700);
      const rollback = await adapter.rollbackDeveloperTeamFiles(adapter.backupDeveloperTeamFiles(plan));
      expect(rollback.status).toBe("conflict");
      expect(await readFile(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).toContain("deck-developer-team");
      await expect(lstat(join(projectRoot, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
      const secondProject = join(root, "other-project");
      await mkdir(secondProject);
      const repeat = adapter.buildDeveloperTeamInstallPlan({ projectRoot: secondProject, environmentId: "claude-development", deckConfig: config });
      expect(repeat.mutationPreview).toHaveLength(0);
      const reused = await adapter.applyDeveloperTeamInstall({ projectRoot: secondProject, environmentId: "claude-development", plan: repeat });
      expect(reused.changedCount).toBe(0);
      expect((await adapter.getCapabilityInventory({ projectRoot: secondProject, environmentId: "claude-development", runnerId: "claude", deckConfig: config })).capabilities[0]?.isInstalled).toBe(true);
      await expect(lstat(join(secondProject, ".claude"))).rejects.toMatchObject({ code: "ENOENT" });
      await writeFile(join(plugin, "hooks.json"), "foreign plugin content");
      expect(adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "claude-development", deckConfig: config }).blocked).toBe(true);
      expect((await adapter.detectDeckInstall?.({ projectRoot }))?.installed).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  test("rejects memory and conflicting global content before mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-claude-adapter-"));
    try {
      const adapter = createClaudeRunnerAdapter({ homeDir: root, dataRoot: join(root, "data", "deck") });
      const config = getDefaultDeckConfig();
      expect(adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: { ...config, adaptiveMemory: { ...config.adaptiveMemory, enabled: true, activeProvider: "supermemory" } } }).blocked).toBe(true);
      expect(adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: {}, packageInstructions: {}, adaptiveMemory: { provider: "supermemory" } }, { runnerId: "claude", environmentId: "claude-development", capabilities: [] }).ready).toBe(false);
      const beforeExternalCreation = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config });
      expect(beforeExternalCreation.blocked).toBe(false);
      const plugin = dirname(dirname(beforeExternalCreation.files[0]!.path));
      await mkdir(join(plugin, "agents"), { recursive: true });
      await writeFile(join(plugin, "agents", "deck-lead.md"), "external");
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: beforeExternalCreation })).rejects.toThrow();
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config });
      expect(plan.blocked).toBe(true);
      expect(await readFile(join(plugin, "agents", "deck-lead.md"), "utf8")).toBe("external");
      await rm(join(root, "data"), { recursive: true });
      const outside = join(root, "outside");
      await mkdir(outside);
      await mkdir(join(root, "data"));
      await symlink(outside, join(root, "data", "deck"));
      const fresh = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config });
      expect(fresh.blocked).toBe(true); // plugin absent, but a symlinked ancestor is still a conflict
      expect((await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: config })).status).toBe("blocked");
      await expect(adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: fresh })).rejects.toThrow();
      await expect(readdir(outside)).resolves.toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
