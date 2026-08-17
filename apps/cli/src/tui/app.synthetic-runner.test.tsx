import React from "react";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { render } from "ink";
import {
  buildCapabilityInstructionBundle,
  createAdapterRegistry,
  createOwnerOnlyFileSecretStore,
  getDefaultDeckConfig,
  getEnabledPackageInstructionIds,
  type RunnerAdapter,
} from "@deck/core";
import { createDeckConfigStore } from "../deck-config-store";
import { DeckApp } from "./app";
import { createMemoryProviderForSelection, hydrateDashboardAdaptiveMemoryState, withAuthoritativeSupermemoryRuntimeReadiness } from "./app";
import { createDefaultRunnerDashboardState } from "./runner-dashboard/state";
import { buildOpenCodeRunnerReviewPlan } from "@deck/adapter-opencode";
import { getRunnerReviewPlanRunBlockDiagnostics, resolveSupermemoryRuntimeCredentialReadiness } from "./runner-dashboard/action-runner";

setDefaultTimeout(15_000);

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

describe("DeckApp synthetic runner production flow", () => {
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
    expect(JSON.stringify(plan)).toContain("Deck runtime API credential is validated and stored");
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

  test("authoritative secret readiness overrides stale OpenCode dashboard state at plan and execution preflight", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-authoritative-supermemory-secret-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: join(projectRoot, "xdg") });
    secretStore.write("supermemory-api-key", "sk-sm-test-AUTHORITATIVE-SHOULD-NOT-LEAK");
    const staleAdaptiveMemory = {
      provider: "supermemory" as const,
      supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] },
    };

    try {
      const adaptiveMemory = withAuthoritativeSupermemoryRuntimeReadiness(staleAdaptiveMemory, secretStore);
      const dashboardState = createDefaultRunnerDashboardState({ runnerScope: "opencode", adaptiveMemory });
      const plan = buildOpenCodeRunnerReviewPlan(dashboardState as never, {} as never);

      expect(resolveSupermemoryRuntimeCredentialReadiness({ setup: staleAdaptiveMemory.supermemory, secretStore })).toMatchObject({ ready: true, reason: "secret-ready" });
      expect(adaptiveMemory.supermemory).toMatchObject({ configured: true, runtimeCredentialStored: true, ephemeralTokenAvailable: false });
      expect(plan.ready).toBe(true);
      expect(JSON.stringify(plan)).toContain("Deck runtime API credential is validated and stored");
      expect(JSON.stringify(plan)).not.toContain("must be validated and stored");
      expect(getRunnerReviewPlanRunBlockDiagnostics(dashboardState, { secretStore })).toEqual([]);
      expect(JSON.stringify({ adaptiveMemory, plan })).not.toContain("sk-sm-test-AUTHORITATIVE-SHOULD-NOT-LEAK");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("authoritative secret readiness blocks stale OpenCode state when secret is absent", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-authoritative-supermemory-missing-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: join(projectRoot, "xdg") });
    const staleAdaptiveMemory = {
      provider: "supermemory" as const,
      supermemory: { configured: true, hasToken: false, runtimeCredentialStored: false, ephemeralTokenAvailable: false, diagnostics: [] },
    };

    try {
      const adaptiveMemory = withAuthoritativeSupermemoryRuntimeReadiness(staleAdaptiveMemory, secretStore);
      const dashboardState = createDefaultRunnerDashboardState({ runnerScope: "opencode", adaptiveMemory });
      const plan = buildOpenCodeRunnerReviewPlan(dashboardState as never, {} as never);

      expect(plan.ready).toBe(false);
      expect(JSON.stringify(plan)).toContain("Deck runtime API key must be validated and stored");
      expect(getRunnerReviewPlanRunBlockDiagnostics(dashboardState, { secretStore }).join(" ")).toContain("Deck runtime API credential must be validated and stored");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("DECK_DEBUG Review to Run transition is not blocked by ready Supermemory debug diagnostic", async () => {
    const previousDebug = process.env.DECK_DEBUG;
    process.env.DECK_DEBUG = "1";
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-debug-ready-run-"));
    const xdgConfigHome = join(projectRoot, "xdg");
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: xdgConfigHome });
    secretStore.write("supermemory-api-key", "sk-sm-test-DEBUG-READY-SHOULD-NOT-LEAK");
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
    const dashboardState = createDefaultRunnerDashboardState({
      runnerScope: "opencode",
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
      const projectRoot = mkdtempSync(join(tmpdir(), "deck-token-submit-supermemory-"));
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
          initialScreen="supermemory-token"
          initialSelectedEnvironments={[...entry.environments]}
          initialSupermemorySetup={{ token }}
          initialDashboardSupermemorySetupActive={entry.dashboard}
          initialDashboardState={createDefaultRunnerDashboardState({ runnerScope: "opencode" })}
        />,
        { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
      );

      try {
        await waitForOutput(instance, harness.output, "Supermemory");
        harness.input("\r");
        await waitForCondition(instance, () => existsSync(join(xdgConfigHome, "deck", "secrets", "supermemory-api-key.secret")), `${entry.name} secret write`);

        expect(calls).toEqual(["api"]);
        expect(readFileSync(join(xdgConfigHome, "deck", "secrets", "supermemory-api-key.secret"), "utf8")).toBe(token);
        expect(configStore.readRequired().adaptiveMemory.activeProvider).toBe("supermemory");
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

  test("Start installation validates and stores OpenCode Supermemory runtime key before applying Developer Team", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-start-install-supermemory-"));
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
        initialSupermemorySetup={{ token }}
      />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForOutput(instance, harness.output, "Installing Developer Team");
      await waitForCondition(instance, () => order.includes("apply"), `Developer Team apply after Supermemory validation; order=${order.join(",")}`);

      expect(order).toEqual(["api", "apply"]);
      const secretPath = join(xdgConfigHome, "deck", "secrets", "supermemory-api-key.secret");
      expect(existsSync(secretPath)).toBe(true);
      expect(readFileSync(secretPath, "utf8")).toBe(token);
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

  test("Start installation stops OpenCode Developer Team apply when Supermemory runtime key is invalid", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-start-install-invalid-supermemory-"));
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
        initialSupermemorySetup={{ token }}
      />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForCondition(instance, () => order.includes("api") && harness.output().includes("read-only API validation failed"), "invalid Supermemory validation failure");
      expect(order).toEqual(["api"]);
      expect(configStore.readRequired().adaptiveMemory.activeProvider).toBe("none");
      expect(existsSync(join(xdgConfigHome, "deck", "secrets", "supermemory-api-key.secret"))).toBe(false);
      expect(harness.output()).not.toContain(token);
      expect(harness.output()).toContain("[REDACTED]");
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
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-synthetic-runner-"));
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
          "context-mode": false,
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
      expect(packageOutput).toContain("[ ] Context Mode");
      for (const label of ["Codebase Memory", "RTK", "Adaptive Memory", "Serena", "[ ] Code Economy"]) {
        expect(packageOutput).not.toContain(label);
      }

      harness.input(" ");
      await instance.waitUntilRenderFlush();
      expect(harness.output()).toContain("[x] Context Mode");
      harness.input("j");
      await instance.waitUntilRenderFlush();
      boundary = harness.output().length;
      harness.input("\r");
      await waitForFreshOutput(instance, harness.output, boundary, "Package instructions applied.");

      const persisted = configStore.read();
      expect(getEnabledPackageInstructionIds(persisted, "atlas")).toEqual(["code-economy", "context-mode"]);
      expect(persisted.packageInstructions.atlas).toMatchObject({
        "code-economy": true,
        "context-mode": true,
        rtk: false,
        serena: false,
      });
      expect(capturedBundle).toEqual(buildCapabilityInstructionBundle(["code-economy", "context-mode"]));
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("filters stale package configuration at the final dashboard team-install boundary", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-synthetic-dashboard-"));
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
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-synthetic-invalid-inventory-"));
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
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-synthetic-plan-error-"));
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
