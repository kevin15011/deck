import React from "react";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { render, renderToString } from "ink";
import {
  buildCapabilityInstructionBundle,
  createAdapterRegistry,
  createOwnerOnlyFileSecretStore,
  getDefaultDeckConfig,
  getEnabledPackageInstructionIds,
  type RunnerAdapter,
} from "@deck/core";
import { discoverLiteralSshHostAliasesFromHome, OPENCODE_SUPERMEMORY_PROFILE_SECRET, storeOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import { createDeckConfigStore } from "../deck-config-store";
import { createDefaultAdapterRegistry } from "../runner-adapters";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import type { SerenaBootstrapRequest, SerenaReadinessEvidence } from "@deck/core";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { DeckApp, openCodeProfileCredentialEffects, resolveDashboardMemoryProviderForInstall } from "./app";
import { createMemoryProviderForSelection, hydrateDashboardAdaptiveMemoryState, withAuthoritativeSupermemoryRuntimeReadiness } from "./app";
import { createDefaultRunnerDashboardState } from "./runner-dashboard/state";
import { reduceRunnerDashboard, type PlanBuilderFn } from "./runner-dashboard/reducer";
import { buildOpenCodeRunnerReviewPlan, type OpenCodeToolInstallResultExact } from "@deck/adapter-opencode";
import { getRunnerReviewPlanRunBlockPreflight, resolveSupermemoryRuntimeCredentialReadiness } from "./runner-dashboard/action-runner";
import { RunnerDashboardScreens } from "./screens/runner-dashboard-screens";
import { getPackageInstructionSummaries } from "./runner-dashboard/selectors";

setDefaultTimeout(15_000);

function createCanonicalTempRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function initCanonicalGitRemote(projectRoot: string): void {
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/deck-example.git"], { cwd: projectRoot, stdio: "ignore" });
}

function createInkHarness() {
  const chunks: Array<Buffer | null> = [];
  const stdin = new EventEmitter() as EventEmitter & { isTTY: boolean; setRawMode: () => void; setEncoding: () => void; read: () => Buffer | null; ref: () => void; unref: () => void };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding = () => {};
  stdin.read = () => chunks.shift() ?? null;
  stdin.ref = () => {};
  stdin.unref = () => {};
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = 120;
  stdout.rows = 40;
  stdout.isTTY = true;
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  return {
    stdin,
    stdout,
    input(value: string) { chunks.push(Buffer.from(value), null); stdin.emit("readable"); },
    output: () => output,
    close() { stdin.removeAllListeners(); stdout.removeAllListeners(); stdout.end(); stdout.destroy(); },
  };
}

async function waitForOutput(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, text: string) {
  const deadline = Date.now() + 5_000;
  while (!output().includes(text)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${JSON.stringify(text)}; output=${JSON.stringify(output().slice(-2_000))}`);
    await instance.waitUntilRenderFlush();
  }
}

async function waitForFreshOutput(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, boundary: number, text: string) {
  const deadline = Date.now() + 5_000;
  while (!output().slice(boundary).includes(text)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for fresh ${JSON.stringify(text)}; output=${JSON.stringify(output().slice(boundary).slice(-2_000))}`);
    await instance.waitUntilRenderFlush();
  }
}

async function waitForCondition(instance: { waitUntilRenderFlush(): Promise<unknown> }, condition: () => boolean, description: string) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await instance.waitUntilRenderFlush();
  }
}

function renderOpenCodeReviewAfterAuthoritativePlanReducer(
  supermemory: NonNullable<ReturnType<typeof createDefaultRunnerDashboardState>["adaptiveMemory"]["supermemory"]>,
  secretStore: Pick<ReturnType<typeof createOwnerOnlyFileSecretStore>, "read">,
) {
  const operation = { runner: "opencode" as const, operationId: "opencode-test-operation", explicitlySelected: false };
  const initialState = createDefaultRunnerDashboardState({
    runnerScope: "opencode",
    screen: "dashboard",
    operationId: operation.operationId,
    currentOperation: operation,
    adaptiveMemory: { provider: "supermemory", supermemory },
    runtime: { inspectionState: "ready", projectIdentity: "verified" },
  });
  const planBuilder: PlanBuilderFn = (state, inventory) => {
    const adaptiveMemory = withAuthoritativeSupermemoryRuntimeReadiness(state.adaptiveMemory, secretStore, "opencode");
    const planState = { ...state, adaptiveMemory };
    return {
      plan: buildOpenCodeRunnerReviewPlan(planState as never, inventory as never),
      state: { adaptiveMemory },
    };
  };
  const state = reduceRunnerDashboard(
    initialState,
    { type: "enter-review", inventory: {}, operation },
    planBuilder,
  );
  return {
    state,
    rendered: renderToString(<RunnerDashboardScreens state={state} canRunPlan={state.plan?.ready === true} runBlockDiagnostics={[]} />),
  };
}

function renderOpenCodeReviewAfterCredentialEvidenceAction(
  supermemory: NonNullable<ReturnType<typeof createDefaultRunnerDashboardState>["adaptiveMemory"]["supermemory"]>,
  secretStore: Pick<ReturnType<typeof createOwnerOnlyFileSecretStore>, "read">,
) {
  const operation = { runner: "opencode" as const, operationId: "opencode-evidence-operation", explicitlySelected: false };
  const plan = { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } };
  const initialState = createDefaultRunnerDashboardState({
    runnerScope: "opencode",
    screen: "review-plan",
    operationId: operation.operationId,
    currentOperation: operation,
    adaptiveMemory: { provider: "supermemory", supermemory },
    runtime: { inspectionState: "ready", projectIdentity: "verified" },
    plan,
    planGeneratedForRevision: 0,
    planRevision: 0,
  });
  const preflight = getRunnerReviewPlanRunBlockPreflight(initialState, { secretStore, profileCredentialEffects: openCodeProfileCredentialEffects });
  if (!preflight.evidence) throw new Error("Expected Supermemory credential evidence");
  const state = reduceRunnerDashboard(initialState, {
    type: "apply-supermemory-runtime-credential-evidence",
    evidence: preflight.evidence,
    identity: { runnerId: "opencode", operation, planRevision: 0, planGeneratedForRevision: 0 },
  });
  return {
    initialState,
    state,
    preflight,
    rendered: renderToString(<RunnerDashboardScreens state={state} canRunPlan={preflight.diagnostics.length === 0} runBlockDiagnostics={[]} />),
  };
}

describe("DeckApp synthetic runner production flow", () => {
  test("OpenCode Packages exposes Context7 and toggles its MCP review action independently of instructions", () => {
    const adapter = createDefaultAdapterRegistry().get("opencode");
    const resolver = { getSupportedPackageInstructionIds: () => adapter.packageInstructionIds ?? [] };
    let state = createDefaultRunnerDashboardState({ runnerScope: "opencode", runnerUi: adapter.ui, selectedCapabilities: { context7: false } });
    expect(getPackageInstructionSummaries(state, resolver)).toContainEqual(expect.objectContaining({ capabilityId: "context7", label: "Context7", selected: false }));
    expect(adapter.packageInstructionIds).not.toContain("context7");
    const instructions = { ...state.packageInstructions };
    state = reduceRunnerDashboard(state, { type: "toggle-capability", capabilityId: "context7" });
    expect(state.selectedCapabilities.context7).toBe(true);
    expect(state.packageInstructions).toEqual(instructions);
    expect(getPackageInstructionSummaries(state, resolver)).toContainEqual(expect.objectContaining({ capabilityId: "context7", selected: true }));
    const inventory = { runnerId: "opencode", environmentId: "opencode-development", capabilities: [{ capabilityId: "context7", isInstalled: false, isBlocked: false, toolId: "context7", source: "@upstash/context7-mcp" }] } as any;
    const selectedPlan = adapter.buildReviewPlan(state as any, inventory);
    expect(selectedPlan.groups.automaticInstalls).toContainEqual(expect.objectContaining({ capabilityId: "context7", kind: "write-mcp-config" }));
    state = reduceRunnerDashboard(state, { type: "toggle-capability", capabilityId: "context7" });
    expect(state.selectedCapabilities.context7).toBe(false);
    const deselectedPlan = adapter.buildReviewPlan(state as any, inventory);
    expect(deselectedPlan.groups.automaticInstalls).not.toContainEqual(expect.objectContaining({ capabilityId: "context7" }));
  });
  test("Claude TUI explicitly authorizes Serena bootstrap and verifies the native Deck proxy", async () => {
    const root = createCanonicalTempRoot("deck-claude-tui-serena-bridge-");
    const dataRoot = join(root, "data", "deck");
    const owned = join(dataRoot, "tools", "serena");
    const executable = join(owned, "bin", "serena");
    mkdirSync(join(owned, "bin"), { recursive: true, mode: 0o700 });
    writeFileSync(executable, "fixture Serena", { mode: 0o700 });
    const deckCli = join(root, "deck-cli");
    writeFileSync(deckCli, "fixture Deck", { mode: 0o700 });
    const evidence: SerenaReadinessEvidence = { capabilityId: "serena", state: "ready", resolvedExecutablePath: executable, source: "installed-deck-tool", probe: "serena-help", fingerprint: "fixture-serena" };
    const calls: SerenaBootstrapRequest[] = [];
    const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg"), projectRoot: root });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, serenaOwnedRoot: owned, serenaProxyCommand: [deckCli, "internal", "serena-mcp"], serenaReadiness: async () => ({ state: "missing", diagnostic: { code: "serena-not-ready", message: "fixture missing" } }), serenaBootstrap: async (request) => { calls.push(request); return { outcome: "installed", evidence }; }, serenaRevalidate: async () => true } });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose one or more environments.");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Package instructions");
      for (let i = 0; i < 3; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input(" "); await instance.waitUntilRenderFlush();
      const boundary = harness.output().length;
      harness.input("\u001b"); await waitForFreshOutput(instance, harness.output, boundary, "Claude Code Setup Dashboard");
      for (let i = 0; i < 4; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r"); await waitForOutput(instance, harness.output, "Run install");
      harness.input("\r");
      try { await waitForCondition(instance, () => existsSync(join(dataRoot, "claude", "model-assignments.json")), "Claude Serena plugin publication"); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; calls=${calls.length}; signals=${harness.output().split("\n").filter((line) => /Serena|serena|Blocked|failed|skipped|review|install|Claude/.test(line)).slice(-25).join(" | ")}`); }
      expect(calls).toHaveLength(1);
      expect(calls[0]?.authorization).toMatchObject({ runner: "claude", kind: "interactive-tui-explicit-selection" });
      const receipt = JSON.parse(readFileSync(join(dataRoot, "claude", "model-assignments.json"), "utf8"));
      expect(receipt.capabilities).toEqual(["serena"]);
      expect(JSON.parse(readFileSync(join(dataRoot, "claude", receipt.plugin, ".mcp.json"), "utf8")).mcpServers.serena).toEqual({ command: deckCli, args: ["internal", "serena-mcp"] });
      expect(existsSync(join(root, ".claude"))).toBe(false);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("Claude TUI reuses the protected shared profile, installs official plugin, then activates memory", async () => {
    expect(resolveDashboardMemoryProviderForInstall("claude", "supermemory", createMemoryProviderForSelection("supermemory", { token: "fixture-not-used-by-legacy-host" }))).toBeUndefined();
    const root = createCanonicalTempRoot("deck-claude-tui-official-memory-");
    initCanonicalGitRemote(root);
    const dataRoot = join(root, "data", "deck");
    const configHome = join(root, "xdg");
    const store = createOwnerOnlyFileSecretStore({ configHome });
    storeOpenCodeSupermemoryCredential({ store, token: "fixture-profile-once-only", makeDefault: true, eligibleAliases: [] });
    const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: configHome, projectRoot: root });
    configStore.write(getDefaultDeckConfig());
    const plugin = Buffer.from('{"name":"supermemory"}\n');
    const entries = [[".claude-plugin/plugin.json", createHash("sha256").update(plugin).digest("hex"), plugin.length]] as const;
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, officialPluginManifest: entries, supermemoryArtifactEffects: { fetchFile: async () => plugin }, resolveMemoryCredential: () => ({ token: "fixture-profile-once-only", profile: "default", canonicalRepoTag: "sm_project_v1_acme_deck_example" }) } });
    const adapter = registry.get("claude");
    const inspection = await adapter.inspectProject?.(root);
    expect(inspection?.state).toBe("ready");
    const observedReview: string[] = [];
    const originalReview = adapter.buildReviewPlan.bind(adapter);
    adapter.buildReviewPlan = (state, inventory) => { observedReview.push(`identity=${(state as { runtime?: { projectIdentity?: string } }).runtime?.projectIdentity} configured=${state.adaptiveMemory.supermemory?.configured}`); return originalReview(state, inventory); };
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} secretStore={store} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose one or more environments.");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Adaptive Memory");
      harness.input("j"); await instance.waitUntilRenderFlush();
      const beforeSelection = harness.output().length;
      harness.input("\r");
      try { await waitForFreshOutput(instance, harness.output, beforeSelection, "Provider selected: supermemory"); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; memory screens=${harness.output().split("\n").filter((line) => /Supermemory|Adaptive Memory|profile|API key|Claude|Blocked/.test(line)).slice(-25).join(" | ")}`); }
      expect(harness.output()).not.toContain("Enter an API key");
      for (let i = 0; i < 4; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      try { await waitForOutput(instance, harness.output, "Run install"); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; reviews=${observedReview.join(";")}; signals=${harness.output().split("\n").filter((line) => /canonical|identity|profile|plugin|Blocked|Supermemory|readiness/i.test(line)).slice(-15).join(" | ")}`); }
      expect(harness.output()).toContain("co-loaded");
      expect(harness.output().split("\n").filter((line) => line.includes("actions planned:")).at(-1)).toContain("3 actions planned: 1 automatic");
      harness.input("\r");
      await waitForCondition(instance, () => configStore.readRequired().adaptiveMemory.enabled === true, "official memory activation after verification");
      expect(existsSync(join(dataRoot, "claude", "official-supermemory-915aba1b8056", ".claude-plugin", "plugin.json"))).toBe(true);
      expect(existsSync(join(root, ".claude"))).toBe(false);
      expect(JSON.stringify(configStore.readRequired())).not.toContain("fixture-profile-once-only");
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("Claude TUI reviews missing Codebase Memory, Context Mode, pinned RTK and Context7 before native materialization", async () => {
    const root = createCanonicalTempRoot("deck-claude-tui-tool-install-");
    const dataRoot = join(root, "data", "deck");
    const bin = join(root, "bin");
    mkdirSync(bin);
    const available = new Map<string, string>();
    const installations: string[] = [];
    const rtkBinary = Buffer.from("fixture RTK binary; never executed by this test");
    const rtkHeader = Buffer.alloc(512);
    rtkHeader.write("rtk");
    rtkHeader.write(`${rtkBinary.length.toString(8).padStart(11, "0")}\0`, 124);
    rtkHeader[156] = 48;
    const rtkArchive = gzipSync(Buffer.concat([rtkHeader, rtkBinary, Buffer.alloc((512 - rtkBinary.length % 512) % 512), Buffer.alloc(1024)]));
    const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const rtkRelease = { asset: "rtk-fixture.tar.gz", archiveBytes: rtkArchive.length, archiveSha256: checksum(rtkArchive), binaryBytes: rtkBinary.length, binarySha256: checksum(rtkBinary) };
    let rtkDownloads = 0;
    const codebaseBinary = Buffer.from("fixture Codebase Memory native binary, never executed");
    const tarMember = (name: string, content: Buffer) => {
      const header = Buffer.alloc(512);
      header.write(name);
      header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
      header[156] = 48;
      return Buffer.concat([header, content, Buffer.alloc((512 - content.length % 512) % 512)]);
    };
    const codebaseArchive = gzipSync(Buffer.concat([tarMember("codebase-memory-mcp", codebaseBinary), tarMember("LICENSE", Buffer.from("MIT")), tarMember("install.sh", Buffer.from("not run")), tarMember("THIRD_PARTY_NOTICES.md", Buffer.from("fixture")), Buffer.alloc(1024)]));
    const codebaseRelease = { asset: "codebase-fixture.tar.gz", archiveBytes: codebaseArchive.length, archiveSha256: checksum(codebaseArchive), binaryBytes: codebaseBinary.length, binarySha256: checksum(codebaseBinary) };
    let codebaseDownloads = 0;
    const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg"), projectRoot: root });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, rtkReleaseOverride: rtkRelease, rtkArtifactEffects: { fetchArchive: async () => { rtkDownloads++; return rtkArchive; } }, verifyRtkCommand: () => true, codebaseReleaseOverride: codebaseRelease, codebaseArtifactEffects: { fetchArchive: async () => { codebaseDownloads++; return codebaseArchive; } }, verifyCodebaseNative: () => true, resolveCommand: (name) => available.get(name), installSharedTool: async (id) => {
      installations.push(id);
      if (id !== "context-mode" && id !== "context7") return false;
      const command = id === "context7" ? "context7-mcp" : "context-mode";
      const path = join(bin, command);
      writeFileSync(path, "fixture", { mode: 0o700 });
      available.set(command, path);
      return true;
    } } });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose one or more environments.");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Package instructions");
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      for (let i = 0; i < 2; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input(" "); await instance.waitUntilRenderFlush();
      expect(harness.output().split("\n").filter((line) => line.includes("Context7")).at(-1)).toContain("[x] Context7");
      const beforeReturn = harness.output().length;
      harness.input("\u001b"); await waitForFreshOutput(instance, harness.output, beforeReturn, "Claude Code Setup Dashboard");
      for (let i = 0; i < 4; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r"); await waitForOutput(instance, harness.output, "Run install");
      expect(harness.output().split("\n").filter((line) => line.includes("actions planned:")).at(-1)).toContain("6 actions planned: 4 automatic");
      harness.input("\r");
      await waitForCondition(instance, () => existsSync(join(dataRoot, "claude", "model-assignments.json")), "Claude verified tool materialization");
      expect(installations).toEqual(["context-mode", "context7"]);
      expect(codebaseDownloads).toBe(1);
      expect(rtkDownloads).toBe(1);
      const receipt = JSON.parse(readFileSync(join(dataRoot, "claude", "model-assignments.json"), "utf8"));
      expect(receipt.capabilities).toEqual(["codebase-memory", "context-mode", "context7", "rtk"]);
      expect(JSON.parse(readFileSync(join(dataRoot, "claude", receipt.plugin, ".mcp.json"), "utf8")).mcpServers["context-mode"].command).toBe(join(bin, "context-mode"));
      expect(JSON.parse(readFileSync(join(dataRoot, "claude", receipt.plugin, ".mcp.json"), "utf8")).mcpServers["codebase-memory"].command).toBe(join(dataRoot, "claude", "tools", "codebase-native-v0.11.0", `${process.platform}-${process.arch}`, "codebase-memory-mcp"));
      expect(JSON.parse(readFileSync(join(dataRoot, "claude", receipt.plugin, ".mcp.json"), "utf8")).mcpServers.context7.command).toBe(join(bin, "context7-mcp"));
      expect(readFileSync(join(dataRoot, "claude", receipt.plugin, "hooks", "rtk-hook.cjs"), "utf8")).toContain(join(dataRoot, "claude", "tools", "rtk-v0.50.0", `${process.platform}-${process.arch}`, "rtk"));
      await waitForOutput(instance, harness.output, "plugin files setup complete");
      expect(configStore.readRequired().packageInstructions.claude?.["context-mode"]).toBe(true);
      expect(existsSync(join(root, ".claude"))).toBe(false);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("reopened Claude dashboard hydrates Context7 from the verified global plugin receipt", async () => {
    const root = createCanonicalTempRoot("deck-claude-tui-context7-reopen-");
    const dataRoot = join(root, "data", "deck");
    const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg"), projectRoot: root });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, resolveCommand: (name) => name === "context7-mcp" ? process.execPath : undefined } });
    const adapter = registry.get("claude");
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: configStore.readRequired(), capabilityIds: ["claude-team-files", "context7"] });
    expect(plan.blocked).toBe(false);
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose one or more environments.");
      for (let i = 0; i < 2; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Package instructions");
      expect(harness.output().split("\n").filter((line) => line.includes("Context7")).at(-1)).toContain("[x] Context7");
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("reopened Claude package selections can be unchecked, reviewed, and removed from the published plugin", async () => {
    const root = createCanonicalTempRoot("deck-claude-tui-package-removal-");
    const dataRoot = join(root, "data", "deck");
    const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg"), projectRoot: root });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, resolveCommand: (name) => ["context-mode", "context7-mcp"].includes(name) ? process.execPath : undefined } });
    const adapter = registry.get("claude");
    const initial = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: configStore.readRequired(), capabilityIds: ["claude-team-files", "context-mode", "context7"] });
    expect(initial.blocked).toBe(false);
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: initial });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose one or more environments.");
      for (let i = 0; i < 2; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Package instructions");
      expect(harness.output().split("\n").filter((line) => line.includes("Context Mode")).at(-1)).toContain("[x] Context Mode");
      expect(harness.output().split("\n").filter((line) => line.includes("Context7")).at(-1)).toContain("[x] Context7");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      expect(harness.output().split("\n").filter((line) => line.includes("Context Mode")).at(-1)).toContain("[ ] Context Mode");
      for (let i = 0; i < 3; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input(" "); await instance.waitUntilRenderFlush();
      expect(harness.output().split("\n").filter((line) => line.includes("Context Mode")).at(-1)).toContain("[ ] Context Mode");
      expect(harness.output().split("\n").filter((line) => line.includes("Context7")).at(-1)).toContain("[ ] Context7");
      const beforeReturn = harness.output().length;
      harness.input("\u001b"); await waitForFreshOutput(instance, harness.output, beforeReturn, "Claude Code Setup Dashboard");
      for (let i = 0; i < 4; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r"); await waitForOutput(instance, harness.output, "Run install");
      harness.input("\r");
      const metadata = join(dataRoot, "claude", "model-assignments.json");
      await waitForCondition(instance, () => {
        const receipt = JSON.parse(readFileSync(metadata, "utf8"));
        return (receipt.capabilities ?? []).length === 0 && !existsSync(join(dataRoot, "claude", receipt.plugin, ".mcp.json"));
      }, "Claude deselected package publication");
      expect(adapter.readSelectedCapabilityIds?.(root)).toEqual([]);
      expect(configStore.readRequired().packageInstructions.claude?.["context-mode"]).not.toBe(true);
      expect(existsSync(initial.files.find((file) => file.path.endsWith("/.mcp.json"))!.path)).toBe(true);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("Claude TUI reviews selected Context Mode, RTK hook and shared Tavily without project MCP or token file", async () => {
    const root = createCanonicalTempRoot("deck-claude-tui-web-search-");
    const dataRoot = join(root, "data", "deck");
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const command of ["context-mode", "rtk"]) writeFileSync(join(bin, command), "fixture executable", { mode: 0o700 });
    const configStore = createDeckConfigStore({ homeDir: join(root, "home"), xdgConfigHome: join(root, "xdg"), projectRoot: root });
    configStore.write({ ...getDefaultDeckConfig(), webSearch: { enabled: true, provider: "tavily" } });
    expect(configStore.readRequired().webSearch.enabled).toBe(true);
    const commands = new Map(["context-mode", "rtk"].map((name) => [name, join(bin, name)]));
    const installations: string[] = [];
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, resolveCommand: (name) => commands.get(name), verifyRtkCommand: () => true, webSearchCredential: () => "fixture-shared-token", installSharedTool: async (id) => {
      installations.push(id);
      if (id !== "web-search") return false;
      const path = join(bin, "tavily-mcp");
      writeFileSync(path, "fixture executable", { mode: 0o700 });
      commands.set("tavily-mcp", path);
      return true;
    } } });
    const adapter = registry.get("claude");
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose one or more environments.");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r"); await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Package instructions");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      const beforeReturn = harness.output().length;
      harness.input("\u001b"); await waitForFreshOutput(instance, harness.output, beforeReturn, "Claude Code Setup Dashboard");
      for (let i = 0; i < 4; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      try { await waitForOutput(instance, harness.output, "Run install"); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; signals=${harness.output().split("\n").filter((line) => /Claude|Blocked|Review|Web Search|Context Mode|capabilit|missing|provider|failed/i.test(line)).slice(-24).join(" | ")}`); }
      harness.input("\r");
      await waitForCondition(instance, () => adapter.readModelAssignments(root) !== undefined && existsSync(join(dataRoot, "claude", "model-assignments.json")), "global capability receipt");
      const receipt = JSON.parse(readFileSync(join(dataRoot, "claude", "model-assignments.json"), "utf8"));
      expect(receipt.capabilities).toEqual(["context-mode", "rtk", "web-search"]);
      const mcp = readFileSync(join(dataRoot, "claude", receipt.plugin, ".mcp.json"), "utf8");
      expect(JSON.parse(mcp).mcpServers["context-mode"].command).toBe(join(bin, "context-mode"));
      expect(JSON.parse(mcp).mcpServers["web-search"].command).toBe(join(bin, "tavily-mcp"));
      expect(installations).toEqual(["web-search"]);
      expect(mcp).not.toContain("fixture-shared-token");
      const hooks = JSON.parse(readFileSync(join(dataRoot, "claude", receipt.plugin, "hooks", "hooks.json"), "utf8"));
      expect(hooks.hooks.PreToolUse[0].matcher).toBe("Bash");
      expect(hooks.hooks.PreToolUse[0].hooks[0].command).toContain("rtk-hook.cjs");
      expect(readFileSync(join(dataRoot, "claude", receipt.plugin, "hooks", "rtk-hook.cjs"), "utf8")).toContain(join(root, "bin", "rtk"));
      await waitForOutput(instance, harness.output, "plugin files setup complete");
      expect(configStore.readRequired().webSearch.enabled).toBe(true);
      expect(configStore.readRequired().packageInstructions.claude?.["context-mode"]).toBe(true);
      expect(configStore.readRequired().packageInstructions.claude?.rtk).toBe(true);
      expect(existsSync(join(root, ".mcp.json"))).toBe(false);
      expect(existsSync(join(root, ".claude"))).toBe(false);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("TUI shows Claude global installation as unavailable and does not select it", async () => {
    const projectRoot = createCanonicalTempRoot("deck-claude-tui-unavailable-");
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write(getDefaultDeckConfig());
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={createAdapterRegistry()} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      expect(harness.output()).toContain("Claude Code — adapter unavailable");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      expect(harness.output()).not.toContain("[x] Claude Code");
      harness.input("\r"); await instance.waitUntilRenderFlush();
      expect(harness.output()).not.toContain("Choose Lead personality");
      expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    } finally {
      instance.unmount(); await instance.waitUntilExit(); harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
  test("registered Claude TUI review runs the global plugin installer with isolated Deck data", async () => {
    const projectRoot = createCanonicalTempRoot("deck-claude-tui-plugin-");
    const dataRoot = join(projectRoot, "data", "deck");
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: projectRoot, dataRoot } });
    const adapter = registry.get("claude");
    const installSignals: string[] = [];
    const build = adapter.buildDeveloperTeamInstallPlan.bind(adapter);
    adapter.buildDeveloperTeamInstallPlan = (input) => { const plan = build(input); installSignals.push(`plan blocked=${plan.blocked} memory=${input.deckConfig.adaptiveMemory.enabled}/${input.deckConfig.adaptiveMemory.activeProvider}/${Boolean(input.memoryProvider)} capabilities=${input.capabilityIds?.join(",")} models=${Object.keys(input.modelAssignments ?? {}).join(",")} thinking=${Object.keys(input.thinkingAssignments ?? {}).join(",")} diagnostics=${plan.diagnostics?.join(";")}`); return plan; };
    const apply = adapter.applyDeveloperTeamInstall.bind(adapter);
    adapter.applyDeveloperTeamInstall = async (input) => { try { return await apply(input); } catch (error) { installSignals.push(`apply error=${error instanceof Error ? error.message : String(error)}`); throw error; } };
    const inventory = await adapter.getCapabilityInventory({ runnerId: "claude", environmentId: "claude-development", projectRoot, deckConfig: configStore.readRequired() });
    expect(inventory.capabilities.find((entry) => entry.capabilityId === "adaptive-memory")).toMatchObject({ supportStatus: "runner-specific", isInstalled: false });
    expect(inventory.capabilities.find((entry) => entry.capabilityId === "protected-execution")?.supportStatus).toBe("unsupported");
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      expect(harness.output()).toContain("Claude Code");
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input("j"); await instance.waitUntilRenderFlush();
      harness.input(" "); await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Claude Code Setup Dashboard");
      for (let i = 0; i < 4; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      try { await waitForOutput(instance, harness.output, "Run install"); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; signals=${harness.output().split("\n").filter((line) => /Claude|Review|Blocked|install|Team|Unsupported|Capability|Choose/i.test(line)).slice(-35).join(" | ")}`); }
      expect(harness.output()).toContain("Create 15 owner-only files in");
      harness.input("\r");
       try { await waitForCondition(instance, () => existsSync(join(dataRoot, "claude", "model-assignments.json")), "global Claude plugin publication"); }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; signals=${installSignals.join(" | ")}; TUI signals: ${harness.output().split("\n").filter((line) => /Claude|Blocked|failed|Run install|Review|Developer Team|skipped|manual/i.test(line)).slice(-14).join(" | ")}`); }
      await waitForOutput(instance, harness.output, "plugin files setup complete");
       const installed = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "claude-development", deckConfig: configStore.readRequired() });
       expect((await adapter.verifyDeveloperTeamInstall(installed)).valid).toBe(true);
       const selectedPlugin = JSON.parse(readFileSync(join(dataRoot, "claude", "model-assignments.json"), "utf8")).plugin as string;
       expect(existsSync(join(dataRoot, "claude", selectedPlugin, ".mcp.json"))).toBe(false);
       expect(existsSync(join(dataRoot, "claude", selectedPlugin, "hooks", "hooks.json"))).toBe(false);
      expect(installSignals.some((signal) => signal.startsWith("plan blocked=false"))).toBe(true);
      expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(projectRoot, { recursive: true, force: true }); }
  });
  test("Claude model configuration exposes runtime-reported models without borrowing Pi's OpenAI providers", async () => {
    const projectRoot = createCanonicalTempRoot("deck-claude-models-");
    const piDir = join(projectRoot, "pi-agent");
    mkdirSync(piDir);
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4" }));
    const previousPiDir = process.env.PI_CODING_AGENT_DIR;
    const previousPath = process.env.PATH;
    process.env.PI_CODING_AGENT_DIR = piDir;
    process.env.PATH = "";
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: projectRoot, dataRoot: join(projectRoot, "data", "deck"), modelDiscovery: async () => [{ value: "vendor/model-2030", displayName: "Runtime Custom", description: "fixture" }] } });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      for (let i = 0; i < 3; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select runner for model config");
      for (let i = 0; i < 2; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select team for model config");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select an agent to configure");
      harness.input("\r");
       await waitForOutput(instance, harness.output, "Select a Claude Code provider");
       expect(harness.output()).toContain("Claude runtime-reported models");
       expect(harness.output()).not.toContain("gpt-4");
       harness.input("\r"); await waitForOutput(instance, harness.output, "Select a model for Claude runtime-reported models");
       harness.input("\r"); await waitForOutput(instance, harness.output, "Availability unverified");
       for (let i = 0; i < 7; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
       harness.input("\r");
       await waitForCondition(instance, () => registry.get("claude").readModelAssignments(projectRoot)["deck-lead"] === "vendor/model-2030", "Home exact runtime model save");
    } finally {
      instance.unmount(); await instance.waitUntilExit(); harness.close();
      if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPiDir;
      if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
  test("Home TUI saves an arbitrary runtime Claude identifier and exact generated frontmatter", async () => {
    const projectRoot = createCanonicalTempRoot("deck-claude-model-save-");
    const dataRoot = join(projectRoot, "data", "deck");
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: projectRoot, dataRoot, modelDiscovery: async () => [{ value: "runtime/model-2030", displayName: "Runtime Custom", description: "fixture", supportsEffort: true, supportedEffortLevels: ["medium", "max"] }] } });
    const adapter = registry.get("claude");
    const defaultPlan = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "claude-development", deckConfig: configStore.readRequired() });
    await adapter.applyDeveloperTeamInstall({ projectRoot, environmentId: "claude-development", plan: defaultPlan });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      for (let i = 0; i < 3; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select runner for model config");
      for (let i = 0; i < 2; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select team for model config");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select an agent to configure");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select a Claude Code provider");
      harness.input("\r");
       await waitForOutput(instance, harness.output, "Select a model for Claude runtime-reported models");
       expect(harness.output()).toContain("Runtime Custom");
       expect(harness.output()).not.toContain("gpt-4");
       harness.input("\r");
       await waitForOutput(instance, harness.output, "Select reasoning for");
       expect(harness.output()).toContain("thinking medium");
       expect(harness.output()).toContain("thinking max");
       harness.input("j"); await instance.waitUntilRenderFlush();
       harness.input("\r");
      await waitForOutput(instance, harness.output, "Select an agent to configure");
      expect(harness.output()).toContain("Availability unverified");
      for (let i = 0; i < 7; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
       await waitForCondition(instance, () => adapter.readModelAssignments(projectRoot)["deck-lead"] === "runtime/model-2030", "Claude global model assignment");
       const pluginPath = join(dataRoot, "claude", JSON.parse(readFileSync(join(dataRoot, "claude", "model-assignments.json"), "utf8")).plugin as string);
      expect(existsSync(pluginPath)).toBe(true); // previous immutable version remains intact
       expect(adapter.readModelAssignments(projectRoot)).toEqual({ "deck-lead": "runtime/model-2030" });
       expect(adapter.readThinkingAssignments(projectRoot)).toEqual({ "deck-lead": "max" });
      const updated = adapter.buildDeveloperTeamInstallPlan({ projectRoot, environmentId: "claude-development", deckConfig: configStore.readRequired() });
      expect(updated.mutationPreview).toHaveLength(0);
      expect((await adapter.verifyDeveloperTeamInstall(updated)).valid).toBe(true);
       expect(updated.files.find((file) => file.path.endsWith("agents/deck-lead.md"))?.content).toContain('\nmodel: "runtime/model-2030"\neffort: max\n');
      expect(existsSync(join(projectRoot, ".claude"))).toBe(false);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(projectRoot, { recursive: true, force: true }); }
  });
  test("Claude dashboard Configure models shows runtime metadata instead of Pi providers", async () => {
    const projectRoot = createCanonicalTempRoot("deck-claude-dashboard-models-");
    const piDir = join(projectRoot, "pi-agent");
    mkdirSync(piDir);
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt-4" }));
    const previousPiDir = process.env.PI_CODING_AGENT_DIR;
    const previousPath = process.env.PATH;
    process.env.PI_CODING_AGENT_DIR = piDir;
    process.env.PATH = "";
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write(getDefaultDeckConfig());
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: projectRoot, dataRoot: join(projectRoot, "data", "deck"), modelDiscovery: async () => [{ value: "vendor/model-2030", displayName: "Runtime Custom", description: "fixture" }] } });
    const harness = createInkHarness();
    const dashboardState = createDefaultRunnerDashboardState({
      runnerScope: "claude", runnerDisplayName: "Claude Code", runnerUi: registry.get("claude").ui,
      screen: "developer-team-detail", cursor: 0,
      teams: { "developer-team": { teamId: "developer-team", label: "Developer Team", selected: true } },
    });
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} initialScreen="pi-runner-dashboard" initialDashboardState={dashboardState} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Configure models per agent");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select an agent to configure");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Select a Claude Code provider");
       expect(harness.output()).toContain("Claude runtime-reported models");
      expect(harness.output()).not.toContain("gpt-4");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Select a model for Claude runtime-reported models");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Availability unverified");
      for (let i = 0; i < 7; i++) { harness.input("j"); await instance.waitUntilRenderFlush(); }
      harness.input("\r");
      await waitForCondition(instance, () => registry.get("claude").readModelAssignments(projectRoot)["deck-lead"] === "vendor/model-2030", "dashboard exact runtime model save");
    } finally {
      instance.unmount(); await instance.waitUntilExit(); harness.close();
      if (previousPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousPiDir;
      if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
  test("Claude metadata discovery shows pending/error/retry without a hardcoded fallback", async () => {
    const root = createCanonicalTempRoot("deck-claude-model-retry-");
    const configStore = createDeckConfigStore({ homeDir: root, xdgConfigHome: join(root, "xdg"), projectRoot: root }); configStore.write(getDefaultDeckConfig());
    let rejectFirst: ((error: Error) => void) | undefined;
    let calls = 0;
    const registry = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot: join(root, "data", "deck"), modelDiscovery: async () => { calls++; if (calls === 1) return await new Promise<never>((_resolve, reject) => { rejectFirst = reject; }); return [{ value: "retry-model-id", displayName: "Retry Model", description: "fixture" }]; } } });
    const dashboardState = createDefaultRunnerDashboardState({ runnerScope: "claude", runnerDisplayName: "Claude Code", runnerUi: registry.get("claude").ui, screen: "developer-team-detail", cursor: 0 });
    const harness = createInkHarness();
    const instance = render(<DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => root} runReleaseCheck={async () => ({ kind: "none" })} initialScreen="pi-runner-dashboard" initialDashboardState={dashboardState} />, { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false });
    try {
      await waitForOutput(instance, harness.output, "Configure models per agent"); harness.input("\r");
      await waitForOutput(instance, harness.output, "Reading models from installed Claude");
      rejectFirst!(new Error("fixture-not-disclosed"));
      await waitForOutput(instance, harness.output, "Claude model discovery is unavailable");
      expect(harness.output()).toContain("No hardcoded fallback"); expect(harness.output()).not.toContain("fixture-not-disclosed");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Select an agent to configure");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Select a Claude Code provider");
      harness.input("\r"); await waitForOutput(instance, harness.output, "Retry Model"); expect(calls).toBe(2);
    } finally { instance.unmount(); await instance.waitUntilExit(); harness.close(); rmSync(root, { recursive: true, force: true }); }
  });
  test("restart hydration disables Adaptive Memory when config is disabled", () => {
    const state = hydrateDashboardAdaptiveMemoryState(
      { version: 1, adaptiveMemory: { enabled: false, activeProvider: "none" } } as never,
      { read: () => "sk-sm-test-present-but-disabled" },
    );

    expect(state).toMatchObject({ provider: "none", supermemory: { runtimeCredentialStored: false, ephemeralTokenAvailable: false } });
  });

  test("restart hydration fails closed when config enables Supermemory but secret is absent", () => {
    const state = hydrateDashboardAdaptiveMemoryState(
      { version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } } as never,
      { read: () => undefined },
    );

    expect(state).toMatchObject({ provider: "supermemory", supermemory: { configured: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false } });
    expect(state.supermemory?.diagnostics.join(" ")).toContain("Deck runtime API credential is not stored");
  });

  test("restart hydration uses stored Supermemory runtime credential for ready OpenCode review without token re-entry", () => {
    const token = "sk-sm-test-RESTART-SHOULD-NOT-LEAK";
    const adaptiveMemory = hydrateDashboardAdaptiveMemoryState(
      { version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } } as never,
      { read: () => token },
    );
    const dashboardState = createDefaultRunnerDashboardState({
      runnerScope: "opencode",
      adaptiveMemory,
      teams: { "developer-team": { teamId: "developer-team", label: "Developer Team", selected: true } },
    });
    const plan = buildOpenCodeRunnerReviewPlan(dashboardState as never, {} as never);

    expect(adaptiveMemory).toMatchObject({ provider: "supermemory", supermemory: { configured: true, runtimeCredentialStored: true, ephemeralTokenAvailable: false } });
    expect(JSON.stringify(adaptiveMemory)).not.toContain(token);
    expect(plan.ready).toBe(true);
    expect(JSON.stringify(plan)).toContain("official Supermemory plugin credential is validated and stored");
    expect(JSON.stringify(plan)).not.toContain("must be validated and stored");
  });

  test("restart hydration redacts secret-store read failures and keeps dashboard generally usable", () => {
    const state = hydrateDashboardAdaptiveMemoryState(
      { version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } } as never,
      { read: () => { throw new Error("permission denied sk-sm-test-SHOULD-NOT-LEAK"); } },
    );

    expect(state).toMatchObject({ provider: "supermemory", supermemory: { configured: false, runtimeCredentialStored: false } });
    expect(JSON.stringify(state)).toContain("[redacted]");
    expect(JSON.stringify(state)).not.toContain("sk-sm-test-SHOULD-NOT-LEAK");
  });

  test("authoritative secret readiness reaches Review through plan reducer state for present, missing, and read-error", () => {
    const projectRoot = createCanonicalTempRoot("deck-authoritative-supermemory-secret-");
    const presentStore = createOwnerOnlyFileSecretStore({ configHome: join(projectRoot, "present-xdg") });
    storeOpenCodeSupermemoryCredential({ store: presentStore, token: "sk-sm-test-AUTHORITATIVE-SHOULD-NOT-LEAK", makeDefault: true, eligibleAliases: [] });
    const missingStore = createOwnerOnlyFileSecretStore({ configHome: join(projectRoot, "missing-xdg") });
    const errorStore = { read: () => { throw new Error("permission denied sk-sm-test-SHOULD-NOT-LEAK"); } };

    try {
      const present = renderOpenCodeReviewAfterAuthoritativePlanReducer(
        { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] },
        presentStore,
      );
      expect(resolveSupermemoryRuntimeCredentialReadiness({ setup: present.state.adaptiveMemory.supermemory, secretStore: presentStore, runnerId: "opencode", profileCredentialEffects: openCodeProfileCredentialEffects })).toMatchObject({ ready: true, reason: "secret-ready" });
      expect(present.state.adaptiveMemory.supermemory).toMatchObject({ configured: true, runtimeCredentialStored: true, runtimeCredentialVerification: "verified-present", ephemeralTokenAvailable: false });
      expect(present.state.plan?.ready).toBe(true);
      expect(present.rendered).toContain("reason=deck-managed-ready");
      expect(present.rendered).not.toContain("reason=managed-runtime-auth-missing");

      const missing = renderOpenCodeReviewAfterAuthoritativePlanReducer(
        { configured: true, hasToken: true, runtimeCredentialStored: true, ephemeralTokenAvailable: true, diagnostics: [] },
        missingStore,
      );
      expect(missing.state.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: false, runtimeCredentialVerification: "verified-missing", ephemeralTokenAvailable: false });
      expect(missing.state.plan?.ready).toBe(false);
      expect(JSON.stringify(missing.state.plan)).toContain("official Supermemory plugin profile credential must be validated and stored");
      expect(missing.rendered).toContain("reason=managed-runtime-auth-missing");
      expect(missing.rendered).not.toContain("reason=deck-managed-ready");

      const error = renderOpenCodeReviewAfterAuthoritativePlanReducer(
        { configured: true, hasToken: true, runtimeCredentialStored: true, ephemeralTokenAvailable: true, diagnostics: [] },
        errorStore,
      );
      expect(error.state.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: false, runtimeCredentialVerification: "verified-error", ephemeralTokenAvailable: false });
      expect(error.rendered).toContain("reason=managed-runtime-auth-deferred");
      expect(error.rendered).not.toContain("reason=deck-managed-ready");
      expect(JSON.stringify({ present, missing, error })).not.toContain("sk-sm-test-AUTHORITATIVE-SHOULD-NOT-LEAK");
      expect(JSON.stringify({ present, missing, error })).not.toContain("sk-sm-test-SHOULD-NOT-LEAK");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("credential preflight evidence flows through reducer action payload to Review", () => {
    const projectRoot = createCanonicalTempRoot("deck-credential-evidence-action-");
    const presentStore = createOwnerOnlyFileSecretStore({ configHome: join(projectRoot, "present-xdg") });
    storeOpenCodeSupermemoryCredential({ store: presentStore, token: "sk-sm-test-EVIDENCE-SHOULD-NOT-LEAK", makeDefault: true, eligibleAliases: [] });
    const missingStore = createOwnerOnlyFileSecretStore({ configHome: join(projectRoot, "missing-xdg") });
    const errorStore = { read: () => { throw new Error("permission denied sk-sm-test-SHOULD-NOT-LEAK"); } };

    try {
      const present = renderOpenCodeReviewAfterCredentialEvidenceAction(
        { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] },
        presentStore,
      );
      expect(present.preflight.diagnostics).toEqual([]);
      expect(present.state).not.toBe(present.initialState);
      expect(present.initialState.adaptiveMemory.supermemory).not.toHaveProperty("runtimeCredentialVerification");
      expect(present.state.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: true, runtimeCredentialVerification: "verified-present" });
      expect(present.rendered).toContain("reason=deck-managed-ready");

      const missing = renderOpenCodeReviewAfterCredentialEvidenceAction(
        { configured: true, hasToken: true, runtimeCredentialStored: true, ephemeralTokenAvailable: true, diagnostics: [] },
        missingStore,
      );
      expect(missing.state).not.toBe(missing.initialState);
      expect(missing.initialState.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: true, ephemeralTokenAvailable: true });
      expect(missing.initialState.adaptiveMemory.supermemory).not.toHaveProperty("runtimeCredentialVerification");
      expect(missing.state.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: false, runtimeCredentialVerification: "verified-missing", ephemeralTokenAvailable: false });
      expect(missing.rendered).toContain("reason=managed-runtime-auth-missing");
      expect(missing.rendered).not.toContain("reason=deck-managed-ready");

      const error = renderOpenCodeReviewAfterCredentialEvidenceAction(
        { configured: true, hasToken: true, runtimeCredentialStored: true, ephemeralTokenAvailable: true, diagnostics: [] },
        errorStore,
      );
      expect(error.state).not.toBe(error.initialState);
      expect(error.initialState.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: true, ephemeralTokenAvailable: true });
      expect(error.initialState.adaptiveMemory.supermemory).not.toHaveProperty("runtimeCredentialVerification");
      expect(error.state.adaptiveMemory.supermemory).toMatchObject({ runtimeCredentialStored: false, runtimeCredentialVerification: "verified-error", ephemeralTokenAvailable: false });
      expect(error.rendered).toContain("reason=managed-runtime-auth-deferred");
      expect(error.rendered).not.toContain("reason=deck-managed-ready");
      expect(JSON.stringify({ present, missing, error })).not.toContain("sk-sm-test-EVIDENCE-SHOULD-NOT-LEAK");
      expect(JSON.stringify({ present, missing, error })).not.toContain("sk-sm-test-SHOULD-NOT-LEAK");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("DECK_DEBUG Review to Run transition is not blocked by ready Supermemory debug diagnostic", async () => {
    const previousDebug = process.env.DECK_DEBUG;
    process.env.DECK_DEBUG = "1";
    const projectRoot = createCanonicalTempRoot("deck-debug-ready-run-");
    const xdgConfigHome = join(projectRoot, "xdg");
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: xdgConfigHome });
    storeOpenCodeSupermemoryCredential({ store: secretStore, token: "sk-sm-test-DEBUG-READY-SHOULD-NOT-LEAK", makeDefault: true, eligibleAliases: [] });
    let applyCount = 0;
    const adapter = {
      runnerId: "opencode",
      displayName: "OpenCode",
      environmentIds: ["opencode-development"],
      packageInstructionIds: [],
      ui: { environmentLabels: { "opencode-development": "OpenCode Development" }, dashboard: { defaultSelectedTeamIds: ["developer-team"] } },
      async detectRuntimes() { return [{ runtimeId: "opencode", displayName: "OpenCode", isAvailable: true, command: "opencode" }]; },
      async inspectProject(root: string) { return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return {}; },
      async getCapabilityInventory() { return { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] }; },
      buildReviewPlan() { return { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [{ id: "team.developer-team.apply", kind: "apply-team-bundle", title: "Apply Developer Team bundle", status: "ready" }], validations: [] } }; },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return [{ id: "developer-team", displayName: "Developer Team", description: "Install team" }]; },
      buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
      backupDeveloperTeamFiles() { return {}; },
      async rollbackDeveloperTeamFiles() { return { status: "rolled-back", diagnostics: [] }; },
      async applyDeveloperTeamInstall() { applyCount += 1; return { results: [] }; },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register("opencode", adapter);
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome, projectRoot });
    configStore.write({ version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } });
    const dashboardPlan = adapter.buildReviewPlan({} as never, {} as never) as any;
    const operation = { runner: "opencode" as const, operationId: "opencode-debug-ready-operation", explicitlySelected: false };
    const dashboardState = createDefaultRunnerDashboardState({
      runnerScope: "opencode",
      operationId: operation.operationId,
      currentOperation: operation,
      runnerDisplayName: "OpenCode",
      runnerUi: (adapter as any).ui,
      screen: "review-plan",
      cursor: 0,
      plan: dashboardPlan,
      planRevision: 0,
      planGeneratedForRevision: 0,
      adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: false, runtimeCredentialStored: true, ephemeralTokenAvailable: false, diagnostics: [] } },
    });
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={configStore} secretStore={secretStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} initialScreen="pi-runner-dashboard" initialDashboardState={dashboardState} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Run install");
      expect(harness.output()).not.toContain("Blocked:");
      harness.input("\r");
      await waitForCondition(instance, () => applyCount === 1, "Developer Team apply invoked once");
      expect(applyCount).toBe(1);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      if (previousDebug === undefined) delete process.env.DECK_DEBUG;
      else process.env.DECK_DEBUG = previousDebug;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  for (const entry of [
    { name: "Start installation memory setup", dashboard: false, environments: ["opencode-development"] },
    { name: "Configure packages memory setup", dashboard: false, environments: ["opencode-development", "pi-development"] },
    { name: "runner dashboard memory setup", dashboard: true, environments: ["opencode-development"] },
  ] as const) {
    test(`${entry.name} stores Supermemory runtime key on token submit before later install actions`, async () => {
      const projectRoot = createCanonicalTempRoot("deck-token-submit-supermemory-");
      initCanonicalGitRemote(projectRoot);
      const xdgConfigHome = join(projectRoot, "xdg");
      const previousXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = xdgConfigHome;
      const token = `sk-sm-test-${entry.name.replace(/\W+/g, "-")}-SHOULD-NOT-LEAK`;
      const calls: string[] = [];
      const registry = createAdapterRegistry();
      registry.register("opencode", {
        runnerId: "opencode",
        displayName: "OpenCode",
        environmentIds: ["opencode-development"],
        packageInstructionIds: [],
        ui: { environmentLabels: { "opencode-development": "OpenCode Development" }, dashboard: { defaultSelectedTeamIds: [] } },
        async detectRuntimes() { return []; },
        async inspectEnvironment() { return {}; },
        async reviewTools() { return {}; },
        async getCapabilityInventory() { return { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] }; },
        buildReviewPlan() {
          return {
            ready: true,
            diagnostics: [],
            groups: {
              automaticInstalls: [{ id: "adaptive-memory.supermemory.install-official-plugin", kind: "install-opencode-plugin", title: "Install memory", toolId: "opencode-supermemory", source: "opencode-supermemory@2.0.15", status: "ready" }],
              manualSteps: [],
              configWrites: [
                { id: "adaptive-memory.supermemory.retire-legacy-opencode-mcp", kind: "write-mcp-config", title: "Retire legacy memory", status: "ready", dependencies: ["adaptive-memory.supermemory.install-official-plugin"] },
                { id: "adaptive-memory.supermemory.deck-config", kind: "write-deck-config", title: "Enable memory", status: "ready", dependencies: ["adaptive-memory.supermemory.install-official-plugin", "adaptive-memory.supermemory.retire-legacy-opencode-mcp"] },
              ],
              teamApplications: [],
              validations: [],
            },
          };
        },
        writeMcpConfig() { return { ok: true, path: join(projectRoot, "opencode.json"), diagnostics: ["Raw Supermemory MCP is disabled; no OpenCode MCP entry was present to retire."] }; },
        getCapability() { return undefined; },
        getCapabilityIds() { return []; },
        getTeams() { return []; },
        buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
        backupDeveloperTeamFiles() { return {}; },
        async rollbackDeveloperTeamFiles() { return { status: "rolled-back", diagnostics: [] }; },
        async applyDeveloperTeamInstall() { return { results: [] }; },
        verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
      } as unknown as RunnerAdapter);
      const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome, projectRoot });
      configStore.write({ version: 1, adaptiveMemory: { enabled: false, activeProvider: "none" } });
      const harness = createInkHarness();
      const instance = render(
        <DeckApp
          adapterRegistry={registry}
          configStore={configStore}
          resolveProjectRoot={() => projectRoot}
          runReleaseCheck={async () => ({ kind: "none" })}
          validateSupermemoryReadOnlyApi={async ({ apiKey, projectRoot: validatedRoot }) => {
            calls.push("api");
            expect(apiKey).toBe(token);
            expect(validatedRoot).toBe(projectRoot);
            return { ok: true };
          }}
          writeSupermemoryPiMcpConfig={() => ({
            ok: true,
            action: "unchanged",
            path: join(projectRoot, "pi-mcp.json"),
            serverName: "supermemory",
            diagnostics: [],
          })}
          installOpenCodeTools={async (_command, tools, onResult) => tools.map((tool) => {
            const result: OpenCodeToolInstallResultExact = { toolId: tool.id, tool: tool.name, outcome: "executed", success: true, installerInvoked: true, message: `Installed ${tool.id}` };
            onResult(result);
            return result;
          })}
          initialScreen="supermemory-token"
          initialSelectedEnvironments={[...entry.environments]}
          initialSupermemorySetup={{ token, profile: "default" }}
          initialDashboardSupermemorySetupActive={entry.dashboard}
          initialDashboardState={createDefaultRunnerDashboardState({
            runnerScope: "opencode",
            operationId: "opencode-supermemory-profile-setup",
            currentOperation: { runner: "opencode", operationId: "opencode-supermemory-profile-setup", explicitlySelected: false },
            runtime: { inspectionState: "ready", projectIdentity: "verified", runnerCommand: "opencode" },
          })}
          initialDashboardInventory={{ runnerId: "opencode", environmentId: "opencode-development", capabilities: [] }}
          initialDashboardEnvironmentId="opencode-development"
        />,
        { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
      );

      try {
        await waitForOutput(instance, harness.output, "Supermemory");
        harness.input("\r");
        await waitForCondition(instance, () => existsSync(join(xdgConfigHome, "deck", "secrets", `${OPENCODE_SUPERMEMORY_PROFILE_SECRET}.secret`)), `${entry.name} secret write`);
        await instance.waitUntilRenderFlush();

        expect(calls).toEqual([]);
        expect(readFileSync(join(xdgConfigHome, "deck", "secrets", `${OPENCODE_SUPERMEMORY_PROFILE_SECRET}.secret`), "utf8")).toContain(token);
        await waitForOutput(instance, harness.output, "Continue Finish profile setup");
        const aliasCount = discoverLiteralSshHostAliasesFromHome(process.env.HOME ?? "").aliases.length;
        for (let index = 0; index < aliasCount + 1; index++) {
          harness.input("j");
          await instance.waitUntilRenderFlush();
        }
        harness.input("\r");
        await instance.waitUntilRenderFlush();
        expect(configStore.readRequired().adaptiveMemory).toMatchObject({ enabled: false, activeProvider: "none" });
        if (entry.dashboard) {
          await waitForOutput(instance, harness.output, "OpenCode Runner Setup Dashboard");
          for (let index = 0; index < 4; index++) {
            harness.input("j");
            await instance.waitUntilRenderFlush();
          }
          harness.input("\r");
          await instance.waitUntilRenderFlush();
          expect(harness.output()).toContain("Run install");
          const installBoundary = harness.output().length;
          harness.input("\r");
          await waitForCondition(instance, () => /setup (?:complete|stopped before completion)/.test(harness.output().slice(installBoundary)), "mounted install completion");
          expect(harness.output().slice(installBoundary)).toContain("setup complete");
          expect(configStore.readRequired().adaptiveMemory).toMatchObject({ enabled: true, activeProvider: "supermemory" });
        }
        expect(harness.output()).not.toContain(token);
      } finally {
        instance.unmount();
        await instance.waitUntilExit();
        harness.close();
        if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = previousXdg;
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }

  for (const route of [
    { runtime: "pi", environment: "pi-development", dashboard: true, target: "Pi Runner Setup Dashboard" },
    { runtime: "codex", environment: "codex-development", dashboard: false, target: "Developer Team will be installed to:" },
  ] as const) {
    for (const behavior of ["save", "escape"] as const) {
      test(`${route.runtime} Supermemory token ${behavior} preserves its ${route.dashboard ? "dashboard" : "review"} route`, async () => {
        const projectRoot = createCanonicalTempRoot(`deck-${route.runtime}-supermemory-${behavior}-`);
        initCanonicalGitRemote(projectRoot);
        const xdgConfigHome = join(projectRoot, "xdg");
        const previousXdg = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = xdgConfigHome;
        const registry = createAdapterRegistry();
        registry.register(route.runtime, {
          runnerId: route.runtime,
          displayName: route.runtime === "pi" ? "Pi" : "Codex",
          environmentIds: [route.environment],
          packageInstructionIds: [],
          ui: { environmentLabels: { [route.environment]: route.environment }, dashboard: { defaultSelectedTeamIds: [] } },
          async detectRuntimes() { return []; },
          async inspectEnvironment() { return {}; },
          async reviewTools() { return {}; },
          async getCapabilityInventory() { return { runnerId: route.runtime, environmentId: route.environment, capabilities: [] }; },
          buildReviewPlan() { return { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } }; },
          getCapability() { return undefined; },
          getCapabilityIds() { return []; },
          getSelectableTools() { return []; },
          getTeams() { return []; },
          buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
          backupDeveloperTeamFiles() { return {}; },
          async rollbackDeveloperTeamFiles() { return { status: "rolled-back", diagnostics: [] }; },
          async applyDeveloperTeamInstall() { return { results: [] }; },
          verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
        } as unknown as RunnerAdapter);
        const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome, projectRoot });
        configStore.write({ version: 1, adaptiveMemory: { enabled: false, activeProvider: "none" } });
        const token = `sm_${route.runtime}_${behavior}_SHOULD_NOT_LEAK`;
        const harness = createInkHarness();
        const instance = render(
          <DeckApp
            adapterRegistry={registry}
            configStore={configStore}
            resolveProjectRoot={() => projectRoot}
            runReleaseCheck={async () => ({ kind: "none" })}
            validateSupermemoryReadOnlyApi={async () => ({ ok: true })}
            writeSupermemoryPiMcpConfig={() => ({ ok: true, action: "unchanged", path: join(projectRoot, "pi-mcp.json"), serverName: "supermemory", diagnostics: [] })}
            initialScreen="supermemory-token"
            initialSelectedEnvironments={[route.environment]}
            initialSupermemorySetup={route.runtime === "codex" ? { token, profile: "default", profileKind: "fallback-default" } : { token }}
            initialDashboardSupermemorySetupActive={route.dashboard}
            initialDashboardState={createDefaultRunnerDashboardState({ runnerScope: route.runtime })}
          />,
          { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
        );

        try {
          await waitForOutput(instance, harness.output, "Supermemory API key");
          harness.input(behavior === "save" ? "\r" : "\u001b");
          await waitForOutput(instance, harness.output, behavior === "save" ? route.target : route.dashboard ? route.target : "Adaptive memory provider");
          expect(configStore.readRequired().adaptiveMemory).toMatchObject(behavior === "save"
            ? { enabled: true, activeProvider: "supermemory" }
            : { enabled: false, activeProvider: "none" });
          expect(harness.output()).not.toContain(token);
          expect(harness.output()).not.toContain("Supermemory profiles (required)");
        } finally {
          instance.unmount();
          await instance.waitUntilExit();
          harness.close();
          if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
          else process.env.XDG_CONFIG_HOME = previousXdg;
          rmSync(projectRoot, { recursive: true, force: true });
        }
      });
    }
  }

  test("configures fallback default, literal default alias, and three OpenCode profiles while preserving replacements", async () => {
    const projectRoot = createCanonicalTempRoot("deck-opencode-profile-menu-");
    initCanonicalGitRemote(projectRoot);
    const home = join(projectRoot, "home");
    const ssh = join(home, ".ssh");
    mkdirSync(ssh, { recursive: true, mode: 0o700 });
    writeFileSync(join(ssh, "config"), "Host default\nHost alpha\nHost beta\nHost gamma\n", { mode: 0o600 });
    const xdgConfigHome = join(projectRoot, "xdg");
    const previousHome = process.env.HOME;
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;

    const registry = createAdapterRegistry();
    registry.register("opencode", {
      runnerId: "opencode",
      displayName: "OpenCode",
      environmentIds: ["opencode-development"],
      packageInstructionIds: [],
      ui: { environmentLabels: { "opencode-development": "OpenCode Development" }, dashboard: { defaultSelectedTeamIds: [] } },
      async detectRuntimes() { return []; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return {}; },
      async getCapabilityInventory() { return { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] }; },
      buildReviewPlan() { return { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } }; },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return []; },
      buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
      backupDeveloperTeamFiles() { return {}; },
      async rollbackDeveloperTeamFiles() { return { status: "rolled-back", diagnostics: [] }; },
      async applyDeveloperTeamInstall() { return { results: [] }; },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter);
    const configStore = createDeckConfigStore({ homeDir: home, xdgConfigHome, projectRoot });
    configStore.write({ version: 1, adaptiveMemory: { enabled: false, activeProvider: "none" } });
    const secretPath = join(xdgConfigHome, "deck", "secrets", `${OPENCODE_SUPERMEMORY_PROFILE_SECRET}.secret`);
    const harness = createInkHarness();
    const instance = render(
      <DeckApp
        adapterRegistry={registry}
        configStore={configStore}
        resolveProjectRoot={() => projectRoot}
        runReleaseCheck={async () => ({ kind: "none" })}
        initialScreen="supermemory-profile"
        initialSelectedEnvironments={["opencode-development"]}
        initialSupermemorySetup={{ token: "" }}
        initialDashboardState={createDefaultRunnerDashboardState({ runnerScope: "opencode" })}
      />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    const tokens = {
      default: "sm_default_SHOULD_NOT_LEAK",
      alpha: "sm_alpha_SHOULD_NOT_LEAK",
      beta: "sm_beta_SHOULD_NOT_LEAK",
      aliasDefault: "sm_alias_default_SHOULD_NOT_LEAK",
      gamma: "sm_gamma_SHOULD_NOT_LEAK",
      betaReplacement: "sm_beta_replacement_SHOULD_NOT_LEAK",
    };
    async function storeSelectedProfile(token: string) {
      const tokenBoundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, tokenBoundary, "Supermemory API key (OpenCode plugin)");
      harness.input(token);
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForCondition(instance, () => existsSync(secretPath) && readFileSync(secretPath, "utf8").includes(token), "selected profile credential write");
      await instance.waitUntilRenderFlush();
    }

    try {
      await waitForOutput(instance, harness.output, "default (fallback) Not configured");
      expect(harness.output()).toContain("default (SSH alias) Not configured");
      expect(harness.output()).toContain("alpha Not configured");
      expect(harness.output()).toContain("beta Not configured");
      expect(harness.output()).toContain("gamma Not configured");

      for (let index = 0; index < 5; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Configure at least one Supermemory profile before continuing.");
      for (let index = 0; index < 5; index++) {
        harness.input("k");
        await instance.waitUntilRenderFlush();
      }

      const escapeBoundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, escapeBoundary, "Supermemory API key (OpenCode plugin)");
      harness.input("sm_discarded_SHOULD_NOT_LEAK");
      await instance.waitUntilRenderFlush();
      const profileBoundary = harness.output().length;
      harness.input("\u001b");
      await waitForFreshOutput(instance, harness.output, profileBoundary, "Supermemory profiles");
      expect(existsSync(secretPath)).toBe(false);

      await storeSelectedProfile(tokens.default);
      harness.input("j");
      await instance.waitUntilRenderFlush();
      await storeSelectedProfile(tokens.alpha);
      harness.input("j");
      await instance.waitUntilRenderFlush();
      await storeSelectedProfile(tokens.beta);
      harness.input("j");
      await instance.waitUntilRenderFlush();
      await storeSelectedProfile(tokens.aliasDefault);
      expect(harness.output()).toContain("default (fallback) Configured");
      expect(harness.output()).toContain("default (SSH alias) Configured");
      harness.input("j");
      await instance.waitUntilRenderFlush();
      await storeSelectedProfile(tokens.gamma);

      harness.input("k");
      await instance.waitUntilRenderFlush();
      harness.input("k");
      await instance.waitUntilRenderFlush();
      await storeSelectedProfile(tokens.betaReplacement);
      harness.input("j");
      await instance.waitUntilRenderFlush();
      harness.input("j");
      await instance.waitUntilRenderFlush();
      harness.input("j");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await instance.waitUntilRenderFlush();
      expect(configStore.readRequired().adaptiveMemory).toMatchObject({ enabled: false, activeProvider: "none" });

      const stored = JSON.parse(readFileSync(secretPath, "utf8")) as { schema: string; defaultToken?: string; profiles: Record<string, string> };
      expect(stored).toEqual({
        schema: "deck-opencode-supermemory-profiles-v1",
        defaultToken: tokens.default,
        profiles: { alpha: tokens.alpha, beta: tokens.betaReplacement, default: tokens.aliasDefault, gamma: tokens.gamma },
      });
      expect(harness.output()).not.toContain("SHOULD_NOT_LEAK");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("Start installation stores the OpenCode plugin credential without calling the Deck memory API", async () => {
    const projectRoot = createCanonicalTempRoot("deck-opencode-start-install-supermemory-");
    initCanonicalGitRemote(projectRoot);
    const xdgConfigHome = join(projectRoot, "xdg");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    const order: string[] = [];
    const token = "sk-sm-test-OPENCODE-START-INSTALL-SHOULD-NOT-LEAK";
    const adapter = {
      runnerId: "opencode",
      displayName: "OpenCode",
      environmentIds: ["opencode-development"],
      packageInstructionIds: [],
      ui: { environmentLabels: { "opencode-development": "OpenCode Development" }, dashboard: { defaultSelectedTeamIds: ["developer-team"] } },
      async detectRuntimes() { return [{ runtimeId: "opencode", displayName: "OpenCode", isAvailable: true, command: "opencode" }]; },
      async inspectProject(root: string) { return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return {}; },
      async getCapabilityInventory() { return { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] }; },
      buildReviewPlan() { return { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } }; },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return [{ id: "developer-team", displayName: "Developer Team", description: "Install team" }]; },
      buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
      backupDeveloperTeamFiles() { return {}; },
      async rollbackDeveloperTeamFiles() { return { status: "rolled-back", diagnostics: [] }; },
      async applyDeveloperTeamInstall() { order.push("apply"); return { results: [] }; },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register(adapter.runnerId, adapter);
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome, projectRoot });
    configStore.write({ version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } });
    const harness = createInkHarness();
    const instance = render(
      <DeckApp
        adapterRegistry={registry}
        configStore={configStore}
        resolveProjectRoot={() => projectRoot}
        runReleaseCheck={async () => ({ kind: "none" })}
        validateSupermemoryReadOnlyApi={async ({ apiKey, projectRoot: validatedRoot }) => {
          order.push("api");
          expect(apiKey).toBe(token);
          expect(validatedRoot).toBe(projectRoot);
          return { ok: true };
        }}
        initialScreen="developer-team-installing"
        initialSelectedEnvironments={["opencode-development"]}
        initialMemoryProvider={createMemoryProviderForSelection("supermemory", { token })}
        initialSupermemorySetup={{ token, profile: "default" }}
      />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Installing Developer Team");
      await waitForCondition(instance, () => order.includes("apply"), `Developer Team apply after Supermemory validation; order=${order.join(",")}`);

      expect(order).toEqual(["apply"]);
      const secretPath = join(xdgConfigHome, "deck", "secrets", `${OPENCODE_SUPERMEMORY_PROFILE_SECRET}.secret`);
      expect(existsSync(secretPath)).toBe(true);
      expect(readFileSync(secretPath, "utf8")).toContain(token);
      expect(harness.output()).not.toContain(token);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("Start installation does not let Deck API validation own OpenCode plugin credentials", async () => {
    const projectRoot = createCanonicalTempRoot("deck-opencode-start-install-invalid-supermemory-");
    initCanonicalGitRemote(projectRoot);
    const xdgConfigHome = join(projectRoot, "xdg");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    const order: string[] = [];
    const token = "sk-sm-test-INVALID-SHOULD-NOT-LEAK";
    const adapter = {
      runnerId: "opencode",
      displayName: "OpenCode",
      environmentIds: ["opencode-development"],
      packageInstructionIds: [],
      ui: { environmentLabels: { "opencode-development": "OpenCode Development" }, dashboard: { defaultSelectedTeamIds: ["developer-team"] } },
      async detectRuntimes() { return [{ runtimeId: "opencode", displayName: "OpenCode", isAvailable: true, command: "opencode" }]; },
      async inspectProject(root: string) { return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return {}; },
      async getCapabilityInventory() { return { runnerId: "opencode", environmentId: "opencode-development", capabilities: [] }; },
      buildReviewPlan() { return { ready: true, diagnostics: [], groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] } }; },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return [{ id: "developer-team", displayName: "Developer Team", description: "Install team" }]; },
      buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
      backupDeveloperTeamFiles() { return {}; },
      async rollbackDeveloperTeamFiles() { return { status: "rolled-back", diagnostics: [] }; },
      async applyDeveloperTeamInstall() { order.push("apply"); return { results: [] }; },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register(adapter.runnerId, adapter);
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome, projectRoot });
    configStore.write({ version: 1, adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } });
    const harness = createInkHarness();
    const instance = render(
      <DeckApp
        adapterRegistry={registry}
        configStore={configStore}
        resolveProjectRoot={() => projectRoot}
        runReleaseCheck={async () => ({ kind: "none" })}
        validateSupermemoryReadOnlyApi={async () => {
          order.push("api");
          return { ok: false, diagnostics: [`invalid ${token}`] };
        }}
        initialScreen="developer-team-installing"
        initialSelectedEnvironments={["opencode-development"]}
        initialMemoryProvider={createMemoryProviderForSelection("supermemory", { token })}
        initialSupermemorySetup={{ token, profile: "default" }}
      />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForCondition(instance, () => order.includes("apply"), "OpenCode Developer Team apply");
      expect(order).toEqual(["apply"]);
      expect(configStore.readRequired().adaptiveMemory.activeProvider).toBe("supermemory");
      expect(existsSync(join(xdgConfigHome, "deck", "secrets", `${OPENCODE_SUPERMEMORY_PROFILE_SECRET}.secret`))).toBe(true);
      expect(harness.output()).not.toContain(token);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses only selected-adapter package metadata throughout the dashboard and Home Configure Packages flows", async () => {
    const projectRoot = createCanonicalTempRoot("deck-synthetic-runner-");
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    const calls: string[] = [];
    const initialConfig = getDefaultDeckConfig();
    configStore.write({
      ...initialConfig,
      packageInstructions: {
        ...initialConfig.packageInstructions,
        atlas: {
          "codebase-memory": false,
          "code-economy": true,
          "context-mode": true,
          rtk: true,
          "adaptive-memory": false,
          serena: true,
        },
      },
    });
    let capturedBundle: unknown;
    const capability = {
      capabilityId: "atlas-tool",
      label: "Atlas Tool",
      description: "Synthetic capability",
      section: "runner-capabilities",
      requirementLevel: "optional" as const,
      source: "atlas-native",
      installKind: "runner-native" as const,
      isInstalled: true,
      isBlocked: false,
      diagnostics: [],
    };
    const adapter = {
      runnerId: "atlas",
      displayName: "Atlas Runner",
      environmentIds: ["atlas-development"],
      packageInstructionIds: ["code-economy", "context-mode"],
      ui: {
        environmentLabels: { "atlas-development": "Atlas Development" },
        dashboard: { defaultSelectedTeamIds: ["developer-team"] },
        model: { providerSource: "Atlas inventory", missingChecks: [], remediation: "Retry Atlas.", defaultThinkingLevels: [] },
      },
      async detectRuntimes() { calls.push("detect"); return [{ runtimeId: "atlas", displayName: "Atlas Runner", isAvailable: true, version: "1.0.0" }]; },
      async inspectProject(root: string) { calls.push(`inspect:${root}`); return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { calls.push("inspect-environment"); return {}; },
      async reviewTools() { calls.push("review-tools"); return { ready: true }; },
      async getCapabilityInventory() { calls.push("inventory"); return { runnerId: "atlas", environmentId: "atlas-development", capabilities: [capability] }; },
      getCapability(id: string) { return id === capability.capabilityId ? capability : undefined; },
      getCapabilityIds() { return [capability.capabilityId]; },
      getTeams() { return [{ id: "developer-team", displayName: "Developer Team" }]; },
      buildDeveloperTeamInstallPlan(input: { capabilityInstructions?: unknown }) {
        capturedBundle = input.capabilityInstructions;
        return { files: [], diagnostics: [], blocked: false, mutationPreview: [] };
      },
      async applyDeveloperTeamInstall() { return { results: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register(adapter.runnerId, adapter);
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input(" ");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Atlas Runner Setup Dashboard");

      expect(calls).toEqual(["detect", `inspect:${projectRoot}`, "review-tools", "inventory"]);
      let boundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, boundary, "Context Mode");
      expect(harness.output().slice(boundary)).not.toContain("Atlas Tool");
      boundary = harness.output().length;
      harness.input("\u001b");
      await waitForFreshOutput(instance, harness.output, boundary, "Atlas Runner Setup Dashboard");

      boundary = harness.output().length;
      harness.input("\u001b");
      await waitForFreshOutput(instance, harness.output, boundary, "Choose one or more environments.");
      boundary = harness.output().length;
      harness.input("\u001b");
      await waitForFreshOutput(instance, harness.output, boundary, "Your AI environment, configured.");
      harness.input("j");
      await instance.waitUntilRenderFlush();
      boundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, boundary, "Select a runner to configure package instructions for.");
      boundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, boundary, "Configure Packages — Atlas Runner");
      const packageOutput = harness.output().slice(boundary);
      expect(packageOutput).toContain("[x] Context Mode");
      expect(packageOutput).toContain("Code Economy is always enabled as the baseline.");
      for (const label of ["Codebase Memory", "RTK", "Adaptive Memory", "Serena", "[ ] Code Economy"]) {
        expect(packageOutput).not.toContain(label);
      }

      harness.input(" ");
      await instance.waitUntilRenderFlush();
      expect(harness.output()).toContain("[ ] Context Mode");
      harness.input("j");
      await instance.waitUntilRenderFlush();
      boundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, boundary, "Package instructions applied.");

      const persisted = configStore.read();
      expect(getEnabledPackageInstructionIds(persisted, "atlas")).toEqual(["code-economy"]);
      expect(persisted.packageInstructions.atlas).toMatchObject({
        "code-economy": true,
        "context-mode": false,
        rtk: false,
        serena: false,
      });
      expect(capturedBundle).toEqual(buildCapabilityInstructionBundle(["code-economy"]));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("filters stale package configuration at the final dashboard team-install boundary", async () => {
    const projectRoot = createCanonicalTempRoot("deck-synthetic-dashboard-");
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    const initialConfig = getDefaultDeckConfig();
    configStore.write({
      ...initialConfig,
      packageInstructions: {
        ...initialConfig.packageInstructions,
        atlas: {
          "codebase-memory": false,
          "code-economy": true,
          "context-mode": false,
          rtk: true,
          "adaptive-memory": false,
          serena: true,
        },
      },
    });
    let capturedBundle: unknown;
    const adapter = {
      runnerId: "atlas",
      displayName: "Atlas Runner",
      environmentIds: ["atlas-development"],
      packageInstructionIds: ["code-economy", "context-mode"],
      ui: {
        environmentLabels: { "atlas-development": "Atlas Development" },
        dashboard: { defaultSelectedTeamIds: ["developer-team"] },
        model: { providerSource: "Atlas inventory", missingChecks: [], remediation: "Retry Atlas.", defaultThinkingLevels: [] },
      },
      async detectRuntimes() { return [{ runtimeId: "atlas", displayName: "Atlas Runner", isAvailable: true, version: "1.0.0" }]; },
      async inspectProject(root: string) { return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return { ready: true }; },
      async getCapabilityInventory() { return { runnerId: "atlas", environmentId: "atlas-development", capabilities: [] }; },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return [{ id: "developer-team", displayName: "Developer Team" }]; },
      buildReviewPlan() {
        return {
          ready: true,
          diagnostics: [],
          groups: {
            automaticInstalls: [],
            manualSteps: [],
            configWrites: [],
            teamApplications: [{ id: "atlas-team", kind: "apply-team-bundle", title: "Apply Atlas team bundle", status: "ready" }],
            validations: [],
          },
        };
      },
      buildDeveloperTeamInstallPlan(input: { capabilityInstructions?: unknown }) {
        capturedBundle = input.capabilityInstructions;
        return { files: [], diagnostics: [], blocked: false, mutationPreview: [] };
      },
      async applyDeveloperTeamInstall() { return { results: [] }; },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register(adapter.runnerId, adapter);
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input(" ");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Atlas Runner Setup Dashboard");
       for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "1 actions planned");
      harness.input("\r");
      await waitForCondition(instance, () => capturedBundle !== undefined, "the Atlas team bundle");

      expect(getEnabledPackageInstructionIds(configStore.read(), "atlas")).toEqual(["code-economy", "rtk", "serena"]);
      expect(capturedBundle).toEqual(buildCapabilityInstructionBundle(["code-economy"]));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("contains malformed dashboard inventory, shows a retryable plan error, and never calls runner effects", async () => {
    const projectRoot = createCanonicalTempRoot("deck-synthetic-invalid-inventory-");
    let planBuildCalls = 0;
    let applyCalls = 0;
    const adapter = {
      runnerId: "atlas",
      displayName: "Atlas Runner",
      environmentIds: ["atlas-development"],
      packageInstructionIds: ["code-economy"],
      ui: {
        environmentLabels: { "atlas-development": "Atlas Development" },
        dashboard: { defaultSelectedTeamIds: [] },
        model: { providerSource: "Atlas inventory", missingChecks: [], remediation: "Retry Atlas.", defaultThinkingLevels: [] },
      },
      async detectRuntimes() { return [{ runtimeId: "atlas", displayName: "Atlas Runner", isAvailable: true }]; },
      async inspectProject(root: string) { return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return {}; },
      async getCapabilityInventory() {
        return { atlasTool: { capabilityId: "atlas-tool" } };
      },
      buildReviewPlan() {
        planBuildCalls += 1;
        throw new Error("must not run for malformed dashboard inventory");
      },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return []; },
      buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
      async applyDeveloperTeamInstall() {
        applyCalls += 1;
        return { results: [] };
      },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register(adapter.runnerId, adapter);
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write({});
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      for (let index = 0; index < 6; index++) {
        harness.input("k");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input(" ");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Runner capability inventory is invalid. Return to Dashboard and retry.");

      expect(harness.output()).toContain("DASHBOARD ERROR");
      expect(planBuildCalls).toBe(0);
      expect(applyCalls).toBe(0);

       for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Review & Install");
      expect(harness.output()).toContain("Blocked");

      harness.input("\r");
      await instance.waitUntilRenderFlush();
      expect(planBuildCalls).toBe(0);
      expect(applyCalls).toBe(0);

      const dashboardBoundary = harness.output().length;
      harness.input("\u001b");
      await waitForFreshOutput(instance, harness.output, dashboardBoundary, "Atlas Runner Setup Dashboard");
       for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await instance.waitUntilRenderFlush();
      expect(planBuildCalls).toBe(0);
      expect(applyCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("contains adapter plan exceptions in the Review screen and retries without applying effects", async () => {
    const projectRoot = createCanonicalTempRoot("deck-synthetic-plan-error-");
    const inventory = {
      runnerId: "atlas",
      environmentId: "atlas-development",
      capabilities: [{
        capabilityId: "atlas-tool",
        label: "Atlas Tool",
        description: "Synthetic capability",
        section: "runner-capabilities",
        requirementLevel: "optional" as const,
        installKind: "runner-native" as const,
        isInstalled: true,
        isBlocked: false,
      }],
    };
    let planBuildCalls = 0;
    let applyCalls = 0;
    let receivedInventory: unknown;
    const adapter = {
      runnerId: "atlas",
      displayName: "Atlas Runner",
      environmentIds: ["atlas-development"],
      packageInstructionIds: ["code-economy"],
      ui: {
        environmentLabels: { "atlas-development": "Atlas Development" },
        dashboard: { defaultSelectedTeamIds: [] },
        model: { providerSource: "Atlas inventory", missingChecks: [], remediation: "Retry Atlas.", defaultThinkingLevels: [] },
      },
      async detectRuntimes() { return [{ runtimeId: "atlas", displayName: "Atlas Runner", isAvailable: true }]; },
      async inspectProject(root: string) { return { projectRoot: root, state: "ready", evidence: {}, diagnostics: [] }; },
      async inspectEnvironment() { return {}; },
      async reviewTools() { return {}; },
      async getCapabilityInventory() { return inventory; },
      buildReviewPlan(_state: unknown, candidate: unknown) {
        receivedInventory = candidate;
        planBuildCalls += 1;
        if (planBuildCalls === 1) throw new Error("synthetic plan exception token=secret-value");
        return {
          ready: true,
          diagnostics: [],
          groups: { automaticInstalls: [], manualSteps: [], configWrites: [], teamApplications: [], validations: [] },
        };
      },
      getCapability() { return undefined; },
      getCapabilityIds() { return []; },
      getTeams() { return []; },
      buildDeveloperTeamInstallPlan() { return { files: [], diagnostics: [], blocked: false, mutationPreview: [] }; },
      async applyDeveloperTeamInstall() {
        applyCalls += 1;
        return { results: [] };
      },
      verifyDeveloperTeamInstall() { return { valid: true, diagnostics: [] }; },
    } as unknown as RunnerAdapter;
    const registry = createAdapterRegistry();
    registry.register(adapter.runnerId, adapter);
    const configStore = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
    configStore.write({});
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={configStore} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Your AI environment, configured.");
      for (let index = 0; index < 6; index++) {
        harness.input("k");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose one or more environments.");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input(" ");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Choose Lead personality");
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Atlas Runner Setup Dashboard");
       for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "Could not build the review plan. Return to Dashboard and retry.");

      expect(receivedInventory).toBe(inventory);
      expect(planBuildCalls).toBe(1);
      expect(applyCalls).toBe(0);
      expect(harness.output()).toContain("Blocked");
      expect(harness.output()).not.toContain("synthetic plan exception");
      expect(harness.output()).not.toContain("secret-value");

      const dashboardBoundary = harness.output().length;
      harness.input("\u001b");
      await waitForFreshOutput(instance, harness.output, dashboardBoundary, "Atlas Runner Setup Dashboard");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
       const retryBoundary = harness.output().length;
       harness.input("\r");
      await waitForFreshOutput(instance, harness.output, retryBoundary, "Run install");
      expect(planBuildCalls).toBe(2);
      expect(applyCalls).toBe(0);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
