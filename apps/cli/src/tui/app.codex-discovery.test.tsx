import { readyTestTools } from "../../../../packages/adapter-codex/src/test-tools";
import React from "react";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";

import { createCodexRunnerAdapter } from "@deck/adapter-codex";
import { DeckApp, resolveDashboardMemoryProviderForInstall, shouldUseLegacySupermemoryTokenRoute } from "./app";
import { createDefaultAdapterRegistry } from "../runner-adapters";
import { createDeckConfigStore } from "../deck-config-store";

setDefaultTimeout(30_000);

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

function createInkHarness() {
  const chunks: Array<Buffer | null> = [];
  const stdin = new EventEmitter() as EventEmitter & { isTTY: boolean; setRawMode(): void; setEncoding(): void; read(): Buffer | null; ref(): void; unref(): void };
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

const RENDER_WAIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_TAIL_LENGTH = 2_048;

function tail(value: string): string {
  return value.slice(-DIAGNOSTIC_TAIL_LENGTH);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForRenderFlush(
  instance: { waitUntilRenderFlush(): Promise<unknown> },
  label: string,
  details?: () => string,
  timeoutMs = RENDER_WAIT_TIMEOUT_MS,
) {
  await withTimeout(
    instance.waitUntilRenderFlush(),
    timeoutMs,
    `Render flush timed out while waiting for ${label}${details ? `: ${details()}` : ""}`,
  );
}

async function waitFor(instance: { waitUntilRenderFlush(): Promise<unknown> }, predicate: () => boolean, label: string, details?: () => string, timeoutMs = RENDER_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (predicate()) return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${details ? `: ${details()}` : ""}`);
    await waitForRenderFlush(instance, label, details, remainingMs);
  }
}

async function waitForFresh(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, boundary: number, text: string) {
  await waitFor(
    instance,
    () => output().slice(boundary).includes(text),
    `fresh ${text}`,
    () => `boundary=${boundary}; fresh tail=${JSON.stringify(tail(output().slice(boundary)))}; complete tail=${JSON.stringify(tail(output()))}`,
  );
}

function testConfigStore(projectRoot: string) {
  const store = createDeckConfigStore({ homeDir: join(projectRoot, "home"), xdgConfigHome: join(projectRoot, "xdg"), projectRoot });
  store.write({});
  return store;
}

describe("DeckApp Codex discovery composition", () => {
  test("uses dashboard Supermemory selection for Codex while keeping Pi MCP handoff separate", () => {
    const provider = resolveDashboardMemoryProviderForInstall("codex", "supermemory", undefined);
    expect(provider?.id).toBe("supermemory");
    expect(JSON.stringify(provider)).not.toContain("token");
    expect(shouldUseLegacySupermemoryTokenRoute(["codex-development"])).toBe(false);
    expect(shouldUseLegacySupermemoryTokenRoute(["pi-development"])).toBe(true);
    expect(shouldUseLegacySupermemoryTokenRoute(["pi-development", "codex-development"])).toBe(true);
  });

  test("keeps bundled models visibly degraded and non-editable until Retry rescans a live inventory", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-codex-rehydrate-"));
    mkdirSync(join(projectRoot, ".codex", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".codex", "agents", "deck-lead.toml"), [
      'model = "gpt-5.6-sol"',
      'model_reasoning_effort = "high"',
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".codex", "agents", "deck-investigate.toml"), [
      'model = "gpt-5.6-terra"',
      'model_reasoning_effort = "high"',
      "",
    ].join("\n"));
    const inventoryRequests: Array<{ projectRoot: string; mode?: string }> = [];
    const commandRequests: Array<readonly string[]> = [];
    const bundledDiscoveryRequested = deferred<void>();
    const retryInventoryRequested = deferred<void>();
    const catalog = JSON.stringify({
      models: [{
        slug: "gpt-5.6-terra",
        display_name: "GPT-5.6 Terra",
        visibility: "list",
        priority: 1,
        supported_reasoning_levels: [
          { effort: "low", description: "Fast" },
          { effort: "ultra", description: "Deep" },
        ],
        default_reasoning_level: "ultra",
      }],
    });
    const adapter = createCodexRunnerAdapter({
      codexHome: join(projectRoot, ".codex"),
      userHome: projectRoot,
      productionModelDiscoveryDependencies: {
        now: () => 1,
        commandRunner: {
          async run(request) {
            commandRequests.push(request.args);
            if (commandRequests.length === 2) bundledDiscoveryRequested.resolve(undefined);
            return commandRequests.length === 1
              ? { exitCode: 1, signal: null, stdout: "", stderr: "authenticated catalog unavailable" }
              : { exitCode: 0, signal: null, stdout: catalog, stderr: "" };
          },
        },
      },
    }) as any;
    const discover = adapter.getModelInventory.bind(adapter);
    adapter.getModelInventory = async (request: { projectRoot: string; mode?: string }) => {
      inventoryRequests.push(request);
      if (inventoryRequests.length === 2) retryInventoryRequested.resolve(undefined);
      return discover(request);
    };
    const harness = createInkHarness();
    const instance = render(
      <DeckApp getAdapter={() => adapter as any} configStore={testConfigStore(projectRoot)} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitFor(instance, () => harness.output().includes("Your AI environment, configured."), "home menu");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await waitForRenderFlush(instance, `Codex model menu cursor redraw ${index + 1}`);
      }
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Select which runner/environment owns the model configuration."), "model runner selection");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await waitForRenderFlush(instance, `Codex runner cursor redraw ${index + 1}`);
      }
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Select which team you want to configure for codex-development."), "Codex team selection");
      harness.input("\r");
      await withTimeout(bundledDiscoveryRequested.promise, RENDER_WAIT_TIMEOUT_MS, "Timed out waiting for primary and bundled Codex discovery requests");
      await waitFor(instance, () => harness.output().includes("Codex bundled models are not active-account availability."), "bundled degradation screen");
      expect(harness.output()).toContain("codex-bundled-fallback");
      expect(harness.output()).not.toContain("Select an agent to configure");
      expect(commandRequests).toEqual([["debug", "models"], ["debug", "models", "--bundled"]]);

      const retryBoundary = harness.output().length;
      harness.input("\r");
      await withTimeout(retryInventoryRequested.promise, RENDER_WAIT_TIMEOUT_MS, "Timed out waiting for Codex retry request");
      expect(inventoryRequests[1]).toMatchObject({ projectRoot, mode: "rescan" });
      await waitFor(instance, () => harness.output().includes("Select an agent to configure"), "editable active-account models");
      expect(harness.output().slice(retryBoundary)).not.toContain("Codex bundled models are not active-account availability.");
      expect(harness.output()).toContain("openai-codex/gpt-5.6-sol");
      expect(harness.output()).toContain("Unavailable model");
      expect(harness.output()).toContain("Variant unavailable: high · openai-codex/gpt-5.6-terra");

      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Select a Codex CLI provider"), "Codex provider selection");
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Select a model for OpenAI Subscription / Codex"), "Codex model selection");
    } finally {
      instance.unmount();
      try {
        await withTimeout(instance.waitUntilExit(), RENDER_WAIT_TIMEOUT_MS, `Ink exit timed out after ${RENDER_WAIT_TIMEOUT_MS}ms`);
      } finally {
        harness.close();
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });

  test("passes the actual Codex capability inventory unchanged into Review & Install and supports Dashboard retry", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-codex-dashboard-"));
    const registry = createDefaultAdapterRegistry({
      codex: {
        preflight: {
          probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex\nexec\nresume", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
          inspectTrust: async () => "trusted",
        },
        tools: readyTestTools(),
        codexHome: join(projectRoot, ".codex"),
        userHome: projectRoot,
        codebaseIndexReadiness: () => true,
      },
    });
    const adapter = registry.get("codex");
    const getCapabilityInventory = adapter.getCapabilityInventory.bind(adapter);
    const buildReviewPlan = adapter.buildReviewPlan.bind(adapter);
    const applyDeveloperTeamInstall = adapter.applyDeveloperTeamInstall.bind(adapter);
    let producedInventory: unknown;
    let receivedInventory: unknown;
    let applyCalls = 0;
    adapter.getCapabilityInventory = async (input) => {
      const inventory = await getCapabilityInventory(input);
      producedInventory = inventory;
      return inventory;
    };
    adapter.buildReviewPlan = (state, inventory) => {
      receivedInventory = inventory;
      return buildReviewPlan(state, inventory);
    };
    adapter.applyDeveloperTeamInstall = async (input) => {
      applyCalls += 1;
      return applyDeveloperTeamInstall(input);
    };

    const harness = createInkHarness();
    const instance = render(
      <DeckApp adapterRegistry={registry} configStore={testConfigStore(projectRoot)} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitFor(instance, () => harness.output().includes("Your AI environment, configured."), "home menu");
      for (let index = 0; index < 6; index++) {
        harness.input("k");
        await waitForRenderFlush(instance, `Dashboard home cursor redraw ${index + 1}`);
      }
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Choose one or more environments."), "environment selection");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await waitForRenderFlush(instance, `Dashboard environment cursor redraw ${index + 1}`);
      }
      harness.input(" ");
      await waitForRenderFlush(instance, "Dashboard environment selection toggle");
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Choose Lead personality"), "personality selection");
      const dashboardBoundary = harness.output().length;
      harness.input("\r");
      await waitForRenderFlush(instance, "Codex dashboard initial render");
      await waitForFresh(instance, harness.output, dashboardBoundary, "Codex CLI Runner Setup Dashboard");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await waitForRenderFlush(instance, `Dashboard action cursor redraw ${index + 1}`);
      }
      const reviewBoundary = harness.output().length;
      harness.input("\r");
      await waitForFresh(instance, harness.output, reviewBoundary, "Review & Install");

      expect(receivedInventory).toBe(producedInventory);
      expect(harness.output()).not.toContain("DASHBOARD ERROR");
      expect(applyCalls).toBe(0);

      const backBoundary = harness.output().length;
      harness.input("\u001b");
      await waitForFresh(instance, harness.output, backBoundary, "Codex CLI Runner Setup Dashboard");
      for (let index = 0; index < 4; index++) {
        harness.input("j");
        await waitForRenderFlush(instance, `Dashboard retry cursor redraw ${index + 1}`);
      }
      const retryBoundary = harness.output().length;
      harness.input("\r");
      await waitForFresh(instance, harness.output, retryBoundary, "Review & Install");
      expect(applyCalls).toBe(0);
      expect(harness.output()).not.toContain("DASHBOARD ERROR");
    } finally {
      instance.unmount();
      try {
        await withTimeout(instance.waitUntilExit(), RENDER_WAIT_TIMEOUT_MS, `Ink exit timed out after ${RENDER_WAIT_TIMEOUT_MS}ms`);
      } finally {
        harness.close();
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });

  test("bounded render waits fail with diagnostics when no render progress can occur", async () => {
    await expect(waitFor(
      { waitUntilRenderFlush: () => new Promise(() => {}) },
      () => false,
      "hung Codex render",
      () => "fixture output",
      5,
    )).rejects.toThrow(/Render flush timed out while waiting for hung Codex render.*fixture output/s);
  });
});
