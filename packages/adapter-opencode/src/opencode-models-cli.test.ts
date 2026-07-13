import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import {
  createHermeticOpenCodeDiscoveryDependencies,
  loadOpenCodeModelsVerboseFixture,
} from "./__tests__/opencode-models-cli-test-helpers";
import {
  OPENCODE_DISCOVERY_TIMEOUT_MS,
  createNodeOpenCodeCommandRunner,
  discoverOpenCodeModels,
  parseOpenCodeModelsVerbose,
} from "./opencode-models-cli";

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
    clearTimeout(id: ReturnType<typeof setTimeout>) {
      timers.delete(id as unknown as number);
    },
    advance(milliseconds: number) {
      const target = now + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
  };
}

describe("OpenCode verbose discovery test seams", () => {
  test("supplies versioned valid and invalid transcripts through hermetic dependencies", async () => {
    const validTranscript = loadOpenCodeModelsVerboseFixture("v1-valid");
    const invalidTranscript = loadOpenCodeModelsVerboseFixture("v1-invalid");
    const { dependencies, calls } = createHermeticOpenCodeDiscoveryDependencies({
      transcript: validTranscript,
      now: 123,
    });

    const result = await dependencies.commandRunner.run({
      file: "/fixtures/bin/opencode",
      args: ["models", "--verbose"],
      cwd: "/workspace",
      timeoutMs: 15_000,
      maxStdoutBytes: 1_000_000,
      maxStderrBytes: 64_000,
    });

    expect(result.stdout).toBe(validTranscript);
    expect(invalidTranscript).not.toBe(validTranscript);
    expect(dependencies.now()).toBe(123);
    expect(calls.command).toEqual([
      {
        file: "/fixtures/bin/opencode",
        args: ["models", "--verbose"],
        cwd: "/workspace",
        timeoutMs: 15_000,
        maxStdoutBytes: 1_000_000,
        maxStderrBytes: 64_000,
      },
    ]);
  });

  test("rejects live runner, shell, network, real-home, and uncontrolled-clock access", async () => {
    const { dependencies } = createHermeticOpenCodeDiscoveryDependencies({
      transcript: loadOpenCodeModelsVerboseFixture("v1-valid"),
      now: 456,
    });

    await expect(
      dependencies.commandRunner.run({
        file: "opencode",
        args: ["models", "--verbose"],
        cwd: "/workspace",
        timeoutMs: 15_000,
        maxStdoutBytes: 1_000_000,
        maxStderrBytes: 64_000,
      }),
    ).rejects.toThrow("fixture executable");
    await expect(dependencies.fs.readFile("/home/user/.config/opencode.json")).rejects.toThrow(
      "real user path",
    );
    await expect(dependencies.resolveExecutable("sh", dependencies.env)).rejects.toThrow(
      "shell or network helper",
    );
    expect(dependencies.now()).toBe(456);
  });
});

describe("OpenCode verbose discovery", () => {
  test("uses the resolved executable and literal verbose arguments, preserving runner keys", async () => {
    const { dependencies, calls } = createHermeticOpenCodeDiscoveryDependencies({
      transcript: loadOpenCodeModelsVerboseFixture("v1-valid"),
      now: 1,
    });

    const result = await discoverOpenCodeModels({ projectRoot: "/workspace", dependencies });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.inventory.modelsByProvider.opencode?.[0]?.id).toBe("opencode/openai/gpt-5.3-codex");
      expect(result.inventory.modelsByProvider.opencode?.[0]?.modelId).toBe("openai/gpt-5.3-codex");
      expect(result.inventory.modelsByProvider.opencode?.[0]?.variants).toEqual(["minimal", "maximum-plus"]);
      expect(result.inventory.modelsByProvider.plugin?.[0]?.variants).toEqual([]);
    }
    expect(calls.command).toHaveLength(1);
    expect(calls.command[0]).toMatchObject({
      file: "/fixtures/bin/opencode",
      args: ["models", "--verbose"],
      cwd: "/workspace",
      timeoutMs: OPENCODE_DISCOVERY_TIMEOUT_MS,
    });
  });

  test("rejects malformed, duplicate, trailing, or provider-mismatched records as a whole", () => {
    for (const output of [
      'openai/a\n{"providerID":"openai","variants":{}}\nopenai/a\n{"providerID":"openai","variants":{}}',
      'openai/a\n{"providerID":"other","variants":{}}',
      'openai/a\n{"providerID":"openai","variants":{}}\ngarbage',
      'openai/a\n{"providerID":"openai","variants":[]}',
    ]) {
      expect(parseOpenCodeModelsVerbose(output).ok).toBe(false);
    }
    expect(parseOpenCodeModelsVerbose("").ok).toBe(true);
  });

  test("accepts built-in, custom, plugin, and alias records with nested escaped braces", () => {
    const output = [
      "opencode/openai/gpt-5.3-codex",
      '{"providerID":"opencode","variants":{"exact":{}}}',
      "custom/local/model",
      '{"providerID":"custom","variants":{"custom-key":{}}}',
      "plugin/acme/model",
      '{"providerID":"plugin","variants":{}}',
      "alias/target/model",
      JSON.stringify({
        providerID: "alias",
        name: 'Alias { "nested": "}" }',
        variants: { "escaped/key": { payload: '{"ok":true}' } },
      }),
    ].join("\n");

    const result = parseOpenCodeModelsVerbose(output);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected runner transcript to parse");
    expect(result.inventory.providers.map((provider) => provider.id)).toEqual(["alias", "custom", "opencode", "plugin"]);
    expect(result.inventory.modelsByProvider.alias?.[0]).toMatchObject({
      id: "alias/target/model",
      modelId: "target/model",
      variants: ["escaped/key"],
    });
    expect(result.inventory.modelsByProvider.plugin?.[0]?.variants).toEqual([]);
  });

  test("rejects every parser byte, key, count, and block bound", () => {
    const record = (id: string, block: string) => `${id}\n${block}`;
    const tooManyVariants = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`variant-${index}`, {}]));
    const tooManyModels = Array.from({ length: 10_001 }, (_, index) =>
      record(`provider/model-${index}`, '{"providerID":"provider","variants":{}}'),
    ).join("\n");
    const invalidOutputs = [
      record(`provider/${"m".repeat(513)}`, '{"providerID":"provider","variants":{}}'),
      record("provider/model", JSON.stringify({ providerID: "provider", variants: { ["v".repeat(129)]: {} } })),
      record("provider/model", JSON.stringify({ providerID: "provider", variants: tooManyVariants })),
      record("provider/model", `{"providerID":"provider","variants":{},"padding":"${"x".repeat(256 * 1024)}"}`),
      tooManyModels,
      "x".repeat(8 * 1024 * 1024 + 1),
    ];

    for (const output of invalidOutputs) {
      expect(parseOpenCodeModelsVerbose(output).ok).toBe(false);
    }
  });
});

describe("OpenCode process boundary", () => {
  test("settles the caller at exactly 15,000 ms while cleanup independently escalates", async () => {
    const child = createFakeChild();
    const timers = createControlledTimers();
    const runner = createNodeOpenCodeCommandRunner({
      spawn: () => child,
      ...timers,
    });
    const result = runner.run({
      file: "/fixtures/bin/opencode",
      args: ["models", "--verbose"],
      cwd: "/workspace",
      timeoutMs: 15_000,
      maxStdoutBytes: 64,
      maxStderrBytes: 64,
    });

    child.stdout.emit("data", Buffer.from([0xe2, 0x82]));
    child.stdout.emit("data", Buffer.from([0xac]));
    timers.advance(14_999);
    expect(child.kills).toEqual([]);
    timers.advance(1);
    expect(child.kills).toEqual(["SIGTERM"]);
    await expect(result).resolves.toEqual({
      exitCode: null,
      signal: "SIGTERM",
      stdout: "€",
      stderr: "",
      terminationReason: "timeout",
    });
    timers.advance(249);
    expect(child.kills).toEqual(["SIGTERM"]);
    timers.advance(1);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("kills an over-limit process once and classifies the result as output-limited", async () => {
    const child = createFakeChild();
    const timers = createControlledTimers();
    const runner = createNodeOpenCodeCommandRunner({ spawn: () => child, ...timers });
    const result = runner.run({
      file: "/fixtures/bin/opencode",
      args: ["models", "--verbose"],
      cwd: "/workspace",
      timeoutMs: 15_000,
      maxStdoutBytes: 3,
      maxStderrBytes: 3,
    });

    child.stderr.emit("data", Buffer.from("four"));
    child.stdout.emit("data", Buffer.from("ignored"));
    expect(child.kills).toEqual(["SIGTERM"]);
    timers.advance(250);

    await expect(result).resolves.toMatchObject({
      signal: "SIGTERM",
      terminationReason: "output-limit",
    });
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
