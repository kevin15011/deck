import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { CURRENT_CODEX_MODELS_FIXTURE } from "./__fixtures__/codex/models";
import {
  CodexModelInventoryCache,
  createNodeCodexModelCommandRunner,
  discoverCodexModels,
  parseCodexModels,
} from "./codex-model-discovery";

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kills: string[];
  kill(signal?: string): boolean;
};

function createFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = [];
  child.kill = (signal = "SIGTERM") => {
    child.kills.push(signal);
    return true;
  };
  return child;
}

function createControlledTimers() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>) {
      timers.delete(timer as unknown as number);
    },
    advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
  };
}

describe("Codex model discovery", () => {
  test("uses the literal Codex command through a bounded injected runner", async () => {
    const requests: unknown[] = [];
    await discoverCodexModels({
      projectRoot: "/fixture/project",
      now: () => 1,
      commandRunner: {
        async run(request) {
          requests.push(request);
          return { exitCode: 0, signal: null, stdout: CURRENT_CODEX_MODELS_FIXTURE, stderr: "" };
        },
      },
    });

    expect(requests).toEqual([{
      file: "codex",
      args: ["debug", "models"],
      cwd: "/fixture/project",
      timeoutMs: 15_000,
      maxStdoutBytes: 4 * 1024 * 1024,
      maxStderrBytes: 256 * 1024,
    }]);
  });

  test("uses current CLI model slugs, hides retired entries, and preserves per-model efforts and metadata", () => {
    const result = parseCodexModels(CURRENT_CODEX_MODELS_FIXTURE);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected the current Codex fixture to parse");

    const models = result.inventory.modelsByProvider["openai-codex"] ?? [];
    expect(models.map((model) => model.id)).toEqual([
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.6-terra",
    ]);
    expect(models.find((model) => model.id === "openai-codex/gpt-5.4")).toBeUndefined();
    expect(models[1]?.upgrade).toEqual({
      model: "gpt-5.6-terra",
      upgradeCopy: "Prefer GPT-5.6 Terra for harder work.",
      migrationMarkdown: "GPT-5.6 Luna remains available.\n\nUse GPT-5.6 Terra for deeper reasoning.",
    });
    expect(models[1]).toMatchObject({
      displayName: "GPT-5.6 Terra",
      description: "Balanced agentic coding model.",
      priority: 2,
      variants: ["low", "max", "ultra"],
      defaultVariant: "ultra",
      upgrade: {
        model: "gpt-5.6-terra",
        upgradeCopy: "Prefer GPT-5.6 Terra for harder work.",
        migrationMarkdown: "GPT-5.6 Luna remains available.\n\nUse GPT-5.6 Terra for deeper reasoning.",
      },
      inputModalities: ["text", "image"],
      experimentalSupportedTools: ["shell", "apply_patch"],
      supportsParallelToolCalls: true,
    });
  });

  test("uses bundled output only after the authenticated catalog fails, and never labels it as live", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await discoverCodexModels({
      projectRoot: "/fixture/project",
      cache: new CodexModelInventoryCache({ now: () => 1 }),
      commandRunner: {
        async run(request) {
          calls.push(request.args);
          return request.args.includes("--bundled")
            ? { exitCode: 0, signal: null, stdout: CURRENT_CODEX_MODELS_FIXTURE, stderr: "" }
            : { exitCode: 1, signal: null, stdout: "", stderr: "catalog unavailable" };
        },
      },
    });

    expect(calls).toEqual([["debug", "models"], ["debug", "models", "--bundled"]]);
    expect(result).toMatchObject({
      state: "stale",
      source: "bundled",
      inventory: { diagnostics: expect.arrayContaining([expect.stringContaining("bundled")]) },
    });
  });

  test("reports an explicit Deck fallback when both Codex catalog commands fail", async () => {
    const result = await discoverCodexModels({
      projectRoot: "/fixture/project",
      now: () => 42,
      commandRunner: {
        async run() {
          return { exitCode: 1, signal: null, stdout: "", stderr: "unavailable" };
        },
      },
    });

    expect(result).toMatchObject({
      state: "stale",
      source: "deck-fallback",
      discoveredAt: 42,
      error: { code: "command-failed" },
      inventory: {
        diagnostics: expect.arrayContaining([expect.stringContaining("Deck fallback")]),
      },
    });
    if (result.state !== "stale") throw new Error("expected degraded Codex inventory");
    expect(result.inventory).toMatchObject({ providers: [], modelsByProvider: {} });
  });

  test("keeps command output and catalog payloads out of user-facing diagnostics", async () => {
    const secret = "codex-secret-fixture";
    const result = await discoverCodexModels({
      projectRoot: "/fixture/project",
      commandRunner: {
        async run() {
          return { exitCode: 1, signal: null, stdout: `{\"token\":\"${secret}\"}`, stderr: secret };
        },
      },
    });

    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("caches successful authenticated discovery but honors an explicit rescan", async () => {
    let calls = 0;
    const cache = new CodexModelInventoryCache({ now: () => 1 });
    const commandRunner = {
      async run() {
        calls++;
        return { exitCode: 0, signal: null, stdout: CURRENT_CODEX_MODELS_FIXTURE, stderr: "" };
      },
    };

    await discoverCodexModels({ projectRoot: "/fixture/project", cache, commandRunner });
    await discoverCodexModels({ projectRoot: "/fixture/project", cache, commandRunner });
    await discoverCodexModels({ projectRoot: "/fixture/project", mode: "rescan", cache, commandRunner });

    expect(calls).toBe(2);
  });

  test("rejects malformed or truncated JSON and all bounded catalog fields", () => {
    const visible = (overrides: Record<string, unknown> = {}) => ({
      slug: "gpt-fixture",
      display_name: "Fixture",
      visibility: "list",
      priority: 1,
      supported_reasoning_levels: [{ effort: "low", description: "Low" }],
      ...overrides,
    });
    const tooManyModels = Array.from({ length: 10_001 }, (_, index) => visible({ slug: `gpt-${index}` }));
    const tooManyVariants = Array.from({ length: 65 }, (_, index) => ({ effort: `effort-${index}`, description: "x" }));
    const invalidCatalogs = [
      "{\"models\":[",
      JSON.stringify({ models: tooManyModels }),
      JSON.stringify({ models: [visible({ slug: "x".repeat(513) })] }),
      JSON.stringify({ models: [visible({ supported_reasoning_levels: tooManyVariants })] }),
    ];

    for (const catalog of invalidCatalogs) expect(parseCodexModels(catalog).ok).toBe(false);
  });
});

describe("Codex model command runner", () => {
  const request = {
    file: "codex",
    args: ["debug", "models"],
    cwd: "/fixture/project",
    timeoutMs: 15_000,
    maxStdoutBytes: 8,
    maxStderrBytes: 8,
  } as const;

  test("uses no shell, ignores stdin, and passes only injected environment data", async () => {
    const child = createFakeChild();
    const timers = createControlledTimers();
    const environment = { PATH: "/fixture/bin", CODEX_HOME: "/fixture/home" };
    const calls: unknown[] = [];
    const runner = createNodeCodexModelCommandRunner({
      spawn(file, args, options) {
        calls.push({ file, args, options });
        return child;
      },
      env: environment,
      ...timers,
    });
    const result = runner.run(request);
    child.stdout.emit("data", "{}");
    child.emit("close", 0, null);

    await expect(result).resolves.toMatchObject({ exitCode: 0, stdout: "{}", stderr: "" });
    expect(calls).toEqual([{
      file: "codex",
      args: ["debug", "models"],
      options: {
        cwd: "/fixture/project",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: environment,
      },
    }]);
  });

  test("settles once when spawn error and close race", async () => {
    const child = createFakeChild();
    const runner = createNodeCodexModelCommandRunner({ spawn: () => child, ...createControlledTimers() });
    const result = runner.run(request);
    child.emit("error", new Error("fixture spawn error"));
    child.emit("close", 0, null);

    await expect(result).resolves.toEqual({ exitCode: null, signal: null, stdout: "", stderr: "", terminationReason: undefined });
  });

  test("inherits the process environment only when no controlled environment is injected", async () => {
    const child = createFakeChild();
    const calls: Array<{ options: { env: NodeJS.ProcessEnv } }> = [];
    const runner = createNodeCodexModelCommandRunner({
      spawn(_file, _args, options) {
        calls.push({ options });
        return child;
      },
      ...createControlledTimers(),
    });
    const result = runner.run(request);
    child.emit("close", 0, null);

    await expect(result).resolves.toMatchObject({ exitCode: 0 });
    expect(calls[0]?.options.env).toBe(process.env);
  });

  test("terminates timed-out commands then escalates to SIGKILL unless reaped", async () => {
    const child = createFakeChild();
    const timers = createControlledTimers();
    const runner = createNodeCodexModelCommandRunner({ spawn: () => child, ...timers });
    const result = runner.run(request);
    timers.advance(15_000);

    await expect(result).resolves.toMatchObject({ signal: "SIGTERM", terminationReason: "timeout" });
    expect(child.kills).toEqual(["SIGTERM"]);
    timers.advance(250);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("enforces independent stdout and stderr byte limits", async () => {
    for (const stream of ["stdout", "stderr"] as const) {
      const child = createFakeChild();
      const timers = createControlledTimers();
      const runner = createNodeCodexModelCommandRunner({ spawn: () => child, ...timers });
      const result = runner.run({ ...request, maxStdoutBytes: 3, maxStderrBytes: 3 });
      child[stream].emit("data", "four");

      await expect(result).resolves.toMatchObject({ signal: "SIGTERM", terminationReason: "output-limit" });
      timers.advance(250);
      expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    }
  });
});
