import React from "react";
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { render } from "ink";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

function createInkHarness() {
  const chunks: Array<Buffer | null> = [];
  const stdin = new EventEmitter() as EventEmitter & { isTTY: boolean; setRawMode: (enabled: boolean) => void; setEncoding: () => void; read: () => Buffer | null; ref: () => void; unref: () => void };
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
  return { stdin, stdout, input: (value: string) => { chunks.push(Buffer.from(value), null); stdin.emit("readable"); }, output: () => output, clear: () => { output = ""; } };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const ready = {
  state: "ready" as const,
  source: "live" as const,
  discoveredAt: 1,
  fingerprint: "fixture",
  inventory: {
    providers: [{ id: "openai", displayName: "OpenAI", source: "runner-resolved" as const }],
    modelsByProvider: { openai: [{ id: "openai/gpt", providerId: "openai", modelId: "gpt", displayName: "GPT", variants: [], metadataSource: "runner" as const, source: "runner-resolved" as const }] },
  },
};

async function mountDiscovery(discover: (request: any) => Promise<any>, resolveProjectRoot: () => string) {
  const { DeckApp } = await import("./app");
  const adapter = {
    getSelectableTools: () => [],
    getTeams: () => [{ id: "developer-team", name: "Developer Team" }],
    readModelAssignments: () => ({}),
    readThinkingAssignments: () => ({}),
    getThinkingLevels: () => [],
    getModelInventory: discover,
  };
  const harness = createInkHarness();
  const instance = render(
    <DeckApp
      getAdapter={() => adapter as any}
      resolveProjectRoot={resolveProjectRoot as any}
      runReleaseCheck={async () => ({ kind: "none" })}
    />,
    {
      stdin: harness.stdin as any,
      stdout: harness.stdout as any,
      interactive: true,
      debug: true,
      patchConsole: false,
    },
  );
  await flush();
  const press = async (input: string) => {
    harness.input(input);
    await flush();
    await instance.waitUntilRenderFlush();
  };
  for (let index = 0; index < 3; index++) await press("j");
  await press("\r");
  await press("j");
  await press("\r");
  await press("\r");
  return { harness, instance, press };
}

describe("DeckApp OpenCode discovery composition", () => {
  test("keeps the latest displayed result when an older project request completes late", async () => {
    const requests: Array<Deferred<any>> = [];
    const seenRequests: any[] = [];
    let projectRoot = "/fixture/project-a";
    const mounted = await mountDiscovery(
      async (request) => {
        seenRequests.push(request);
        const pending = deferred<any>();
        requests.push(pending);
        return pending.promise;
      },
      () => projectRoot,
    );
    try {
      expect(requests).toHaveLength(1);
      expect(mounted.harness.output()).toContain("Reading models from OpenCode");
      projectRoot = "/fixture/project-b";
      await mounted.press("r");
      expect(seenRequests.map((request) => request.projectRoot)).toEqual(["/fixture/project-a", "/fixture/project-b"]);
      requests[1]?.resolve({ state: "blocked", source: "none", inventory: null, error: { code: "timeout", message: "request B", retryable: true } });
      await flush();
      expect(mounted.harness.output()).toContain("request B");
      requests[0]?.resolve({ state: "blocked", source: "none", inventory: null, error: { code: "timeout", message: "request A", retryable: true } });
      await flush();
      expect(mounted.harness.output()).toContain("request B");
      expect(mounted.harness.output()).not.toContain("request A");
    } finally {
      mounted.instance.unmount();
    }
  });

  test("renders loading → ready through actual DeckApp navigation", async () => {
    const pending = deferred<any>();
    const mounted = await mountDiscovery(async () => pending.promise, () => "/fixture/project");
    try {
      expect(mounted.harness.output()).toContain("Reading models from OpenCode");
      pending.resolve(ready);
      await flush();
      expect(mounted.harness.output()).toContain("Select an agent to configure");
    } finally {
      mounted.instance.unmount();
    }
  });

  test("renders empty, runs Retry, and renders stale through DeckApp", async () => {
    const requests: Array<{ request: any; deferred: Deferred<any> }> = [];
    const mounted = await mountDiscovery(async (request) => {
      const current = deferred<any>();
      requests.push({ request, deferred: current });
      return current.promise;
    }, () => "/fixture/project");
    try {
      requests[0]?.deferred.resolve({ ...ready, inventory: { providers: [], modelsByProvider: {} } });
      await flush();
      expect(mounted.harness.output()).toContain("OpenCode reported no available models.");
      expect(mounted.harness.output()).toContain("Retry discovery");
      await mounted.press("\r");
      expect(requests[1]?.request.mode).toBe("rescan");
      requests[1]?.deferred.resolve({ state: "stale", source: "last-known-good", discoveredAt: 1, fingerprint: "fixture", inventory: ready.inventory, error: { code: "timeout", message: "offline", retryable: true } });
      await flush();
      expect(mounted.harness.output()).toContain("Last known OpenCode models");
      expect(mounted.harness.output()).toContain("Select an agent to configure");
    } finally {
      mounted.instance.unmount();
    }
  });

  test("selects the discovery Back menu action from an empty state", async () => {
    const pending = deferred<any>();
    const mounted = await mountDiscovery(async () => pending.promise, () => "/fixture/project");
    try {
      pending.resolve({ ...ready, inventory: { providers: [], modelsByProvider: {} } });
      await flush();
      expect(mounted.harness.output()).toContain("OpenCode reported no available models.");
      await mounted.press("j");
      await mounted.press("\r");
      expect(mounted.harness.output()).toContain("Select an agent to configure");
    } finally {
      mounted.instance.unmount();
    }
  });

  test("renders a blocked discovery result at the mounted component boundary", async () => {
    const pending = deferred<any>();
    const mounted = await mountDiscovery(async () => pending.promise, () => "/fixture/project");
    try {
      pending.resolve({ state: "blocked", source: "none", inventory: null, error: { code: "timeout", message: "fixture timeout", retryable: true } });
      await flush();
      expect(mounted.harness.output()).toContain("OpenCode model discovery is unavailable.");
      expect(mounted.harness.output()).toContain("fixture timeout");
    } finally {
      mounted.instance.unmount();
    }
  });
});
