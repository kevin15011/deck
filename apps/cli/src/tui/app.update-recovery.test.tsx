import React from "react";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { createAdapterRegistry, getDefaultDeckConfig } from "@deck/core";
import type { ReleaseJson } from "../upgrade-command/release-descriptor";
import { DeckApp } from "./app";

setDefaultTimeout(10_000);

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
  return {
    stdin,
    stdout,
    close() { stdin.removeAllListeners(); stdout.removeAllListeners(); stdout.end(); stdout.destroy(); },
  };
}

async function waitForCondition(instance: { waitUntilRenderFlush(): Promise<unknown> }, condition: () => boolean, description: string) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await instance.waitUntilRenderFlush();
  }
}

const binaryOnlyDescriptor: ReleaseJson = {
  schemaVersion: 1,
  version: "9.9.9",
  tag_name: "v9.9.9",
  channel: "stable",
  published_at: new Date().toISOString(),
  items: [
    {
      id: "binary-linux-x64-v9.9.9",
      kind: "binary",
      required: true,
      platform: "linux-x64",
      asset_name: "deck_v9.9.9_linux-x64.tar.gz",
      url: "https://example.test/deck_v9.9.9_linux-x64.tar.gz",
      sha256: "1".repeat(64),
      notes: "",
    },
  ],
};

describe("DeckApp update recovery", () => {
  test("binary-only upgrade staging and orchestration do not eagerly parse optional Deck config", async () => {
    let configReads = 0;
    let staged = 0;
    let orchestrated = 0;
    let readGlobalDeckConfig: (() => unknown) | undefined;
    const harness = createInkHarness();
    const instance = render(
      <DeckApp {...({
        adapterRegistry: createAdapterRegistry(),
        configStore: {
          readRequired() {
            configReads += 1;
            throw new Error("Unknown Deck config field under adaptiveMemory.");
          },
          write() {},
        },
        resolveProjectRoot: () => null,
        runReleaseCheck: async () => ({ kind: "none" }),
        initialScreen: "upgrade-progress",
        initialUpgradeDescriptor: binaryOnlyDescriptor,
        stageReleaseAssets: async () => {
          staged += 1;
          return { staged: 1, skipped: 0, files: [] };
        },
        runUpgradeOrchestrator: async (input: { deps?: { readGlobalDeckConfig?: () => unknown } }) => {
          orchestrated += 1;
          readGlobalDeckConfig = input.deps?.readGlobalDeckConfig;
          return {
            status: "completed",
            binary: { status: "completed", itemId: "binary-linux-x64-v9.9.9" },
            content: { status: "skipped" },
            migration: { status: "skipped", itemIds: [] },
            advisory: { items: [] },
            channelEol: { items: [] },
            finalState: {},
            finalManifest: {},
          };
        },
      } as any)} />,
      { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
    );

    try {
      await waitForCondition(instance, () => orchestrated === 1, "upgrade orchestrator invoked");
      expect(staged).toBe(1);
      // DeckApp has an existing best-effort personality read during initial
      // render. The recovery contract is that upgrade staging/orchestration
      // does not add a blocking eager read before binary replacement.
      expect(configReads).toBe(1);
      expect(readGlobalDeckConfig).toBeDefined();
      expect(() => readGlobalDeckConfig?.()).toThrow("Unknown Deck config field under adaptiveMemory.");
      expect(configReads).toBe(2);
    } finally {
      instance.unmount();
      await instance.waitUntilExit();
      harness.close();
    }
  });
});


test("DeckApp unmount cancels the active release check through its injected seam", async () => {
  let signal: AbortSignal | undefined;
  let cancelled = false;
  const harness = createInkHarness();
  const instance = render(
    <DeckApp
      adapterRegistry={createAdapterRegistry()}
      configStore={{ readRequired: () => getDefaultDeckConfig(), write() {} } as any}
      resolveProjectRoot={() => null}
      runReleaseCheck={async (_deadline, deps) => {
        signal = deps?.signal;
        return await new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            cancelled = true;
            resolve({ kind: "none" });
          }, { once: true });
        });
      }}
    />,
    { stdin: harness.stdin as any, stdout: harness.stdout as any, interactive: true, debug: true, patchConsole: false },
  );
  try {
    await waitForCondition(instance, () => signal !== undefined, "release check started");
    expect(signal?.aborted).toBe(false);
  } finally {
    instance.unmount();
    await instance.waitUntilExit();
    harness.close();
  }
  expect(signal?.aborted).toBe(true);
  expect(cancelled).toBe(true);
});
