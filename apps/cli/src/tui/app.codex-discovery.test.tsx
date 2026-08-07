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

setDefaultTimeout(30_000);

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

async function waitFor(instance: { waitUntilRenderFlush(): Promise<unknown> }, predicate: () => boolean, label: string, details?: () => string) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}${details ? `: ${details()}` : ""}`);
    await instance.waitUntilRenderFlush();
  }
}

async function waitForFresh(instance: { waitUntilRenderFlush(): Promise<unknown> }, output: () => string, boundary: number, text: string) {
  await waitFor(instance, () => output().slice(boundary).includes(text), `fresh ${text}`);
}

describe("DeckApp Codex discovery composition", () => {
  test("uses the dashboard Supermemory selection for Codex installation without a token route", () => {
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
      productionModelDiscoveryDependencies: {
        now: () => 1,
        commandRunner: {
          async run(request) {
            commandRequests.push(request.args);
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
      return discover(request);
    };
    const harness = createInkHarness();
    const instance = render(
      <DeckApp getAdapter={() => adapter as any} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitFor(instance, () => harness.output().includes("Your AI environment, configured."), "home menu");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Select which runner/environment owns the model configuration."), "model runner selection");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Select which team you want to configure for codex-development."), "Codex team selection");
      harness.input("\r");
      await waitFor(instance, () => commandRequests.length === 2, "primary and bundled Codex discovery requests");
      await waitFor(instance, () => harness.output().includes("Codex bundled models are not active-account availability."), "bundled degradation screen");
      expect(harness.output()).toContain("codex-bundled-fallback");
      expect(harness.output()).not.toContain("Select an agent to configure");
      expect(commandRequests).toEqual([["debug", "models"], ["debug", "models", "--bundled"]]);

      const retryBoundary = harness.output().length;
      harness.input("\r");
      await waitFor(instance, () => inventoryRequests.length === 2, "Codex retry request");
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
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
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
        sharedBinaryUsability: async (command) => ({ command, status: "ready", resolvedPath: `/bin/${command}`, diagnostics: [] }),
        codebaseIndexReadiness: () => true,
        supermemoryOAuthStatus: async () => ({ state: "authenticated" }),
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
      <DeckApp adapterRegistry={registry} resolveProjectRoot={() => projectRoot} runReleaseCheck={async () => ({ kind: "none" })} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitFor(instance, () => harness.output().includes("Your AI environment, configured."), "home menu");
      for (let index = 0; index < 6; index++) {
        harness.input("k");
        await instance.waitUntilRenderFlush();
      }
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Choose one or more environments."), "environment selection");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      harness.input(" ");
      await instance.waitUntilRenderFlush();
      harness.input("\r");
      await waitFor(instance, () => harness.output().includes("Choose Lead personality"), "personality selection");
      const dashboardBoundary = harness.output().length;
      harness.input("\r");
      await instance.waitUntilRenderFlush();
      await waitForFresh(instance, harness.output, dashboardBoundary, "Codex CLI Runner Setup Dashboard");
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
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
      for (let index = 0; index < 3; index++) {
        harness.input("j");
        await instance.waitUntilRenderFlush();
      }
      const retryBoundary = harness.output().length;
      harness.input("\r");
      await waitForFresh(instance, harness.output, retryBoundary, "Review & Install");
      expect(applyCalls).toBe(0);
      expect(harness.output()).not.toContain("DASHBOARD ERROR");
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
