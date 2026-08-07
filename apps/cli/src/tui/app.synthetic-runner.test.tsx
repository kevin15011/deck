import React from "react";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";
import {
  buildCapabilityInstructionBundle,
  createAdapterRegistry,
  getDefaultDeckConfig,
  getEnabledPackageInstructionIds,
  readDeckConfig,
  type RunnerAdapter,
  writeDeckConfig,
} from "@deck/core";
import { DeckApp } from "./app";

setDefaultTimeout(15_000);

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
  test("uses only selected-adapter package metadata throughout the dashboard and Home Configure Packages flows", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-synthetic-runner-"));
    const calls: string[] = [];
    const initialConfig = getDefaultDeckConfig();
    writeDeckConfig(projectRoot, {
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
      <DeckApp adapterRegistry={registry} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
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

      const persisted = readDeckConfig(projectRoot);
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
    const initialConfig = getDefaultDeckConfig();
    writeDeckConfig(projectRoot, {
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
      <DeckApp adapterRegistry={registry} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
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
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitForOutput(instance, harness.output, "1 actions planned");
      harness.input("\r");
      await waitForCondition(instance, () => capturedBundle !== undefined, "the Atlas team bundle");

      expect(getEnabledPackageInstructionIds(readDeckConfig(projectRoot), "atlas")).toEqual(["code-economy", "rtk", "serena"]);
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
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
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

      for (let index = 0; index < 3; index++) {
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
      for (let index = 0; index < 3; index++) {
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
    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
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
      for (let index = 0; index < 3; index++) {
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
      for (let index = 0; index < 3; index++) {
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
