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
}

const RENDER_WAIT_TIMEOUT_MS = 5_000;
const DIAGNOSTIC_TAIL_LENGTH = 2_048;

type OutputPredicate = (freshOutput: string, completeOutput: string) => boolean;
type OutputExpectation = Readonly<{
  description: string;
  boundary: number;
  predicate: OutputPredicate;
  timeoutMs?: number;
}>;

type OutputHarness = Readonly<{ output: () => string }>;
type RenderWaiter = Readonly<{ waitUntilRenderFlush: () => Promise<unknown> }>;

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

async function waitForFreshOutput(
  harness: OutputHarness,
  instance: RenderWaiter,
  expectation: OutputExpectation,
): Promise<void> {
  const timeoutMs = expectation.timeoutMs ?? RENDER_WAIT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const completeOutput = harness.output();
    const freshOutput = completeOutput.slice(expectation.boundary);
    if (expectation.predicate(freshOutput, completeOutput)) return;

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${expectation.description}; boundary=${expectation.boundary}; ` +
        `fresh tail=${JSON.stringify(tail(freshOutput))}; complete tail=${JSON.stringify(tail(completeOutput))}`,
      );
    }
    await withTimeout(
      instance.waitUntilRenderFlush(),
      remainingMs,
      `Render flush timed out while waiting for ${expectation.description}; boundary=${expectation.boundary}; ` +
      `fresh tail=${JSON.stringify(tail(freshOutput))}; complete tail=${JSON.stringify(tail(completeOutput))}`,
    );
  }
}

function containsFresh(description: string, text: string, boundary: number): OutputExpectation {
  return {
    description,
    boundary,
    predicate: (freshOutput) => freshOutput.includes(text),
  };
}

function createDiscoveryCleanup(
  instance: Readonly<{ unmount: () => void; waitUntilExit: () => Promise<unknown> }>,
  resources: Readonly<{ close: () => void }>,
): () => Promise<void> {
  return async () => {
    let failure: unknown;
    instance.unmount();
    try {
      await withTimeout(
        instance.waitUntilExit(),
        RENDER_WAIT_TIMEOUT_MS,
        `Ink exit timed out after ${RENDER_WAIT_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      failure = error;
    } finally {
      resources.close();
    }
    if (failure) throw failure;
  };
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
    runnerId: "opencode",
    displayName: "OpenCode",
    environmentIds: ["opencode-development"],
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
  await waitForFreshOutput(
    harness,
    instance,
    containsFresh("initial home menu", "Your AI environment, configured.", 0),
  );
  const press = async (input: string, description: string, expectedText: string) => {
    const boundary = harness.output().length;
    harness.input(input);
    await waitForFreshOutput(harness, instance, containsFresh(description, expectedText, boundary));
  };
  for (let index = 0; index < 3; index++) {
    await press("j", `home cursor redraw ${index + 1}`, "Your AI environment, configured.");
  }
  await press("\r", "runner selection prompt", "Select which runner/environment owns the model configuration.");
  await press("j", "OpenCode runner selection", "OpenCode");
  await press("\r", "OpenCode team selection prompt", "Select which team you want to configure for opencode-development.");
  await press("\r", "OpenCode discovery loading state", "Reading models from OpenCode");

  const cleanup = createDiscoveryCleanup(instance, {
    close: () => {
      harness.stdin.removeAllListeners();
      harness.stdout.removeAllListeners();
      harness.stdout.end();
      harness.stdout.destroy();
    },
  });
  return { harness, instance, press, cleanup };
}


async function actAndWait(
  harness: OutputHarness,
  instance: RenderWaiter,
  action: () => void,
  description: string,
  expectedText: string,
): Promise<void> {
  const boundary = harness.output().length;
  action();
  await waitForFreshOutput(harness, instance, containsFresh(description, expectedText, boundary));
}

describe("DeckApp OpenCode discovery composition", () => {
  test("keeps the latest displayed result when an older project request completes late", async () => {
    const requests: Array<Deferred<any>> = [];
    const seenRequests: any[] = [];
    const secondRequestObserved = deferred<void>();
    let projectRoot = "/fixture/project-a";
    const mounted = await mountDiscovery(
      async (request) => {
        seenRequests.push(request);
        const pending = deferred<any>();
        requests.push(pending);
        if (requests.length === 2) secondRequestObserved.resolve(undefined);
        return pending.promise;
      },
      () => projectRoot,
    );
    try {
      expect(requests).toHaveLength(1);
      projectRoot = "/fixture/project-b";
      const requestBoundary = mounted.harness.output().length;
      mounted.harness.input("r");
      await withTimeout(
        secondRequestObserved.promise,
        RENDER_WAIT_TIMEOUT_MS,
        `Timed out after ${RENDER_WAIT_TIMEOUT_MS}ms waiting for the project B discovery request`,
      );
      expect(seenRequests.map((request) => request.projectRoot)).toEqual(["/fixture/project-a", "/fixture/project-b"]);
      requests[1]?.resolve({ state: "blocked", source: "none", inventory: null, error: { code: "timeout", message: "request B", retryable: true } });
      await waitForFreshOutput(
        mounted.harness,
        mounted.instance,
        containsFresh("project B blocked result", "request B", requestBoundary),
      );
      const staleBoundary = mounted.harness.output().length;
      requests[0]?.resolve({ state: "blocked", source: "none", inventory: null, error: { code: "timeout", message: "request A", retryable: true } });
      await withTimeout(mounted.instance.waitUntilRenderFlush(), RENDER_WAIT_TIMEOUT_MS, "out-of-order request did not settle");
      const freshOutput = mounted.harness.output().slice(staleBoundary);
      expect(freshOutput).not.toContain("request A");
      expect(mounted.harness.output()).toContain("request B");
    } finally {
      await mounted.cleanup();
    }
  });

  test("renders loading → ready through actual DeckApp navigation", async () => {
    const pending = deferred<any>();
    const mounted = await mountDiscovery(async () => pending.promise, () => "/fixture/project");
    try {
      await actAndWait(
        mounted.harness,
        mounted.instance,
        () => pending.resolve(ready),
        "ready discovery result",
        "Select an agent to configure",
      );
    } finally {
      await mounted.cleanup();
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
      await actAndWait(
        mounted.harness,
        mounted.instance,
        () => requests[0]?.deferred.resolve({ ...ready, inventory: { providers: [], modelsByProvider: {} } }),
        "empty discovery result",
        "OpenCode reported no available models.",
      );
      await mounted.press("\r", "retry discovery loading state", "Reading models from OpenCode");
      expect(requests[1]?.request.mode).toBe("rescan");
      await actAndWait(
        mounted.harness,
        mounted.instance,
        () => requests[1]?.deferred.resolve({ state: "stale", source: "last-known-good", discoveredAt: 1, fingerprint: "fixture", inventory: ready.inventory, error: { code: "timeout", message: "offline", retryable: true } }),
        "stale discovery result",
        "Last known OpenCode models",
      );
      expect(mounted.harness.output()).toContain("Select an agent to configure");
    } finally {
      await mounted.cleanup();
    }
  });

  test("selects the discovery Back menu action from an empty state", async () => {
    const pending = deferred<any>();
    const mounted = await mountDiscovery(async () => pending.promise, () => "/fixture/project");
    try {
      await actAndWait(
        mounted.harness,
        mounted.instance,
        () => pending.resolve({ ...ready, inventory: { providers: [], modelsByProvider: {} } }),
        "empty discovery result",
        "OpenCode reported no available models.",
      );
      await mounted.press("j", "Back option selection", "Back");
      await mounted.press("\r", "return to agent selection", "Select an agent to configure");
    } finally {
      await mounted.cleanup();
    }
  });

  test("renders a blocked discovery result at the mounted component boundary", async () => {
    const pending = deferred<any>();
    const mounted = await mountDiscovery(async () => pending.promise, () => "/fixture/project");
    try {
      await actAndWait(
        mounted.harness,
        mounted.instance,
        () => pending.resolve({ state: "blocked", source: "none", inventory: null, error: { code: "timeout", message: "fixture timeout", retryable: true } }),
        "blocked discovery result",
        "OpenCode model discovery is unavailable.",
      );
      expect(mounted.harness.output()).toContain("fixture timeout");
    } finally {
      await mounted.cleanup();
    }
  });
});


describe("fresh output synchronization contract", () => {
  test("rejects matching output that predates the action boundary", async () => {
    let output = "stale ready frame";
    const expectation = {
      description: "fresh ready frame",
      boundary: output.length,
      predicate: (freshOutput: string) => freshOutput.includes("ready frame"),
      timeoutMs: 5,
    };

    await expect(waitForFreshOutput(
      { output: () => output },
      { waitUntilRenderFlush: async () => {} },
      expectation,
    )).rejects.toThrow(/fresh ready frame.*boundary/s);
  });

  test("async cleanup unmounts and closes streams even when settling fails", async () => {
    const calls: string[] = [];
    const cleanup = createDiscoveryCleanup(
      { unmount: () => calls.push("unmount"), waitUntilExit: async () => { throw new Error("fixture exit failure"); } },
      { close: () => calls.push("close") },
    );

    await expect(cleanup()).rejects.toThrow("fixture exit failure");
    expect(calls).toEqual(["unmount", "close"]);
  });
});
