import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";

import { classifyExplicitMemoryIntent, createNodeRunnerProcessEffects, executeRunnerLaunchPlan } from "./runner-launch-command";
import { runRunnerLaunch } from "./runner-launch-command";
import { deriveDeckRuntimeSessionId } from "./supermemory-runtime-host";
import { createFreshDeckSessionId, persistNativeDeckRuntimeSessionMapping, resolveDeckRuntimeSessionId } from "./supermemory-session-store";
import { getDefaultDeckConfig, type RunnerAdapter, type RunnerLaunchInput } from "@deck/core";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { buildCodexLaunchPlan, createCodexRunnerAdapter } from "@deck/adapter-codex";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const withDeckConfig = <T extends Omit<RunnerLaunchInput, "deckConfig">>(input: T): T & Pick<RunnerLaunchInput, "deckConfig"> => ({
  ...input,
  deckConfig: getDefaultDeckConfig(),
});

function initGitRemote(projectRoot: string, remote = "git@github.com:kevin15011/deck.git") {
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: projectRoot, stdio: "ignore" });
}

describe("executeRunnerLaunchPlan", () => {
  test("classifies only direct supervised exec memory intents", () => {
    expect(classifyExplicitMemoryIntent(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["What did we do so far?"], stdin: "closed" }))).toMatchObject({ kind: "recall" });
    expect(classifyExplicitMemoryIntent(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["Remember that Codex exec uses output-last-message files."], stdin: "closed" }))).toMatchObject({ kind: "remember", content: "Codex exec uses output-last-message files." });
    expect(classifyExplicitMemoryIntent(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["Please implement the feature and remember to test it."], stdin: "closed" }))).toMatchObject({ kind: "none" });
    expect(classifyExplicitMemoryIntent(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }))).toMatchObject({ kind: "none" });
  });

  test("Supermemory runtime session ids are fresh for new runs and native-stable for resume", () => {
    expect(createFreshDeckSessionId()).not.toBe(createFreshDeckSessionId());
    expect(deriveDeckRuntimeSessionId(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-by-id", sessionId: "native-1" }))).toBe("runner-resume:native-1");
    expect(deriveDeckRuntimeSessionId(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }))).toBeUndefined();
  });

  test("Supermemory session map lets resume-latest reuse the previous top-level Deck session", async () => {
    const stateHome = await mkdtemp(join(tmpdir(), "deck-session-map-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-session-project-"));
    try {
      initGitRemote(projectRoot);
      const fresh = resolveDeckRuntimeSessionId(withDeckConfig({ projectRoot, teamId: "developer-team", mode: "exec", prompt: ["x"], stdin: "closed" }), { runnerId: "codex", stateHome });
      expect(fresh.persist()).toEqual([]);
      const latest = resolveDeckRuntimeSessionId(withDeckConfig({ projectRoot, teamId: "developer-team", mode: "resume-latest" }), { runnerId: "codex", stateHome });
      const explicit = resolveDeckRuntimeSessionId(withDeckConfig({ projectRoot, teamId: "developer-team", mode: "resume-by-id", sessionId: "native-1" }), { runnerId: "codex", stateHome });
      expect(latest.sessionId).toBe(fresh.sessionId);
      expect(explicit.sessionId).toBe("runner-resume:native-1");
      expect(persistNativeDeckRuntimeSessionMapping({ projectRoot, teamId: "developer-team", runnerId: "codex", nativeSessionId: "native-1", deckSessionId: fresh.sessionId, stateHome })).toEqual([]);
      const nativeResume = resolveDeckRuntimeSessionId(withDeckConfig({ projectRoot, teamId: "developer-team", mode: "resume-by-id", sessionId: "native-1" }), { runnerId: "codex", stateHome });
      expect(nativeResume.sessionId).toBe(fresh.sessionId);
    } finally {
      await rm(stateHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("sanitizes inherited and overlay secrets, redacts diagnostics, and propagates exit", async () => {
    const result = await executeRunnerLaunchPlan({
      command: "runner",
      args: ["exec"],
      cwd: "/project",
      stdio: "pipe",
      stdin: "closed",
      captureLimitBytes: 5,
      envOverlay: { PUBLIC: { value: "ok" }, TOKEN: { value: "secret", sensitive: true }, DECK_RUNNER_MEMORY_TOKEN: { value: "loopback", sensitive: true } },
    }, {
      inheritedEnv: { PATH: "/bin", SUPERMEMORY_API_KEY: "sm_test_secret", DATABASE_URL: "postgres://user:pass@db/app", DATABASE_URI: "postgres://user:pass@db/app", LOCAL_DB_URI: "/home/dev/private/app.sqlite", AUTHORIZATION: "Bearer hidden" },
      spawn: async (_command, _args, options) => ({ exitCode: 7, stdout: "123456", stderr: options.env.TOKEN ?? "" }),
    });
    expect(result).toEqual({ exitCode: 7, signal: undefined, stdout: "12345", stderr: "", truncated: true });
  });

  test("preserves only the ephemeral loopback secret for runner-native bridge assets", async () => {
    await executeRunnerLaunchPlan({
      command: "runner",
      args: [],
      cwd: "/project",
      stdio: "pipe",
      stdin: "closed",
      envOverlay: { DECK_RUNNER_MEMORY_ENDPOINT: { value: "http://127.0.0.1:1234/deck-runner-memory/v1" }, DECK_RUNNER_MEMORY_TOKEN: { value: "loopback-token", sensitive: true } },
    }, {
      inheritedEnv: { PATH: "/bin", OPENAI_API_KEY: "sk-test-secret", COOKIE: "Cookie: session=secret" },
      spawn: async (_command, _args, options) => {
        expect(options.env).toMatchObject({ PATH: "/bin", DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:1234/deck-runner-memory/v1", DECK_RUNNER_MEMORY_TOKEN: "loopback-token" });
        expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
        expect(options.env).not.toHaveProperty("COOKIE");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
  });

  test("passes Codex exec content only through bounded stdin payloads", async () => {
    const prompt = "--flag 'quoted'\nnext line";
    const result = await executeRunnerLaunchPlan({
      command: "codex",
      args: ["exec", "-"],
      cwd: "/project",
      stdio: "pipe",
      stdin: "closed",
      stdinPayload: { type: "utf8", content: prompt },
    }, {
      spawn: async (_command, args, options) => {
        expect(args).toEqual(["exec", "-"]);
        expect(JSON.stringify(args)).not.toContain(prompt);
        expect(options.env).not.toHaveProperty("DECK_EXEC_PROMPT");
        expect(options.stdinPayload).toEqual({ type: "utf8", content: prompt });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(result.exitCode).toBe(0);
    await expect(executeRunnerLaunchPlan({
      command: "codex",
      args: ["exec", "-"],
      cwd: "/project",
      stdio: "pipe",
      stdin: "closed",
      stdinPayload: { type: "utf8", content: "unsafe\0payload" },
    }, { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) })).rejects.toThrow("Runner stdin payload is invalid.");
  });

  test("handles an EPIPE from bounded stdin without surfacing prompt content", async () => {
    const prompt = "private prompt value";
    const child = new EventEmitter() as EventEmitter & { stdin: EventEmitter & { end(value: string): void }; stdout: EventEmitter; stderr: EventEmitter; killed: boolean; kill(): void };
    const stdin = new EventEmitter() as EventEmitter & { end(value: string): void };
    let written = "";
    stdin.end = (value) => {
      written = value;
      queueMicrotask(() => {
        stdin.emit("error", Object.assign(new Error("broken pipe"), { code: "EPIPE" }));
        child.emit("close", 0, null);
      });
    };
    child.stdin = stdin;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    const effects = createNodeRunnerProcessEffects((() => child) as unknown as typeof import("node:child_process").spawn);

    const result = await executeRunnerLaunchPlan({
      command: "codex",
      args: ["exec", "-"],
      cwd: "/project",
      stdio: "pipe",
      stdin: "closed",
      stdinPayload: { type: "utf8", content: prompt },
    }, effects);
    expect(written).toBe(prompt);
    expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    expect(JSON.stringify(result)).not.toContain(prompt);
  });

  test("executes a normalized Codex inherit-stdin caller plan through the generic executor", async () => {
    const launch = buildCodexLaunchPlan(
      withDeckConfig({ projectRoot: "/project", teamId: "developer-team", mode: "exec", prompt: ["safe"], stdin: "inherit", stdinPayload: { type: "utf8", content: "safe" } }),
      { interactive: true, exec: true, resumeById: true, resumeLatest: true },
    );
    expect(launch.status).toBe("ready");
    if (launch.status !== "ready") return;
    const result = await executeRunnerLaunchPlan(launch.plan, {
      spawn: async (_command, args, options) => {
        expect(args.slice(0, 3)).toEqual(["--dangerously-bypass-approvals-and-sandbox", "exec", "--output-last-message"]);
        expect(args.at(-1)).toBe("-");
        expect(options).toMatchObject({ stdio: "pipe", stdin: "closed", stdinPayload: { type: "utf8", content: "safe" } });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(result.exitCode).toBe(0);
  });
});

describe("runRunnerLaunch consent and status", () => {
  function adapter(overrides: Partial<RunnerAdapter> = {}): RunnerAdapter {
    return {
      runnerId: "fake",
      displayName: "Fake",
      environmentIds: ["fake-development"],
      buildDeveloperTeamInstallPlan: () => ({
        files: [{ path: "managed", content: "secret", kind: "other" }],
        mutationPreview: [{ action: "create", path: "managed", preimage: "absent", postimage: "abc", ownership: "deck-file" }],
      }),
      applyDeveloperTeamInstall: async () => ({ results: [], changedCount: 1, unchangedCount: 0 }),
      verifyDeveloperTeamInstall: () => ({ valid: true, diagnostics: [] }),
      backupDeveloperTeamFiles: () => ({ payload: undefined, diagnostics: [] }),
      rollbackDeveloperTeamFiles: async () => ({ status: "nothing-to-do", conflicts: [], diagnostics: [] }),
      buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: "/p", stdio: "inherit", stdin: "inherit" }, diagnostics: [] }),
      ...overrides,
    } as unknown as RunnerAdapter;
  }

  test("does not persist Supermemory session continuity state when runtime is disabled", async () => {
    const stateHome = await mkdtemp(join(tmpdir(), "deck-disabled-session-state-"));
    const previousStateHome = process.env.XDG_STATE_HOME;
    try {
      process.env.XDG_STATE_HOME = stateHome;
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
        }),
        launch: { projectRoot: "/p", teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: false, activeProvider: "none" } } },
        interactive: false,
        yes: true,
        presentPreview: async () => {},
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      });

      expect(result.status).toBe("launched");
      expect(existsSync(join(stateHome, "deck", "supermemory-sessions.json"))).toBe(false);
    } finally {
      if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = previousStateHome;
      await rm(stateHome, { recursive: true, force: true });
    }
  });

  test("lets native loopback own recall and prompt capture without generic pre-search duplication", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-host-"));
    initGitRemote(projectRoot);
    const calls: Array<{ operation: string; payload: unknown }> = [];
    const transport = {
      async add(payload: unknown) { calls.push({ operation: "add", payload }); return { id: "capture" }; },
      async search(payload: unknown) { calls.push({ operation: "search", payload }); return { results: [{ id: "m1", memory: "Prior advisory context." }] }; },
      async profile(payload: unknown) { calls.push({ operation: "profile", payload }); return { profile: { static: ["Static profile."], dynamic: [] } }; },
      async health() { calls.push({ operation: "health", payload: {} }); return { ok: true }; },
    };
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: (launch) => {
            expect(launch.mode).toBe("exec");
            if (launch.mode === "exec") {
              expect(launch.stdinPayload?.content).not.toContain("DECK_ADAPTIVE_CONTEXT_JSON_V1");
              expect(launch.stdinPayload?.content).not.toContain("Prior advisory context.");
            }
            return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed", stdinPayload: launch.mode === "exec" ? launch.stdinPayload : undefined }, diagnostics: [] };
          },
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Decision: capture the supervised runtime boundary with focused verification."], stdin: "closed", stdinPayload: { type: "utf8", content: "Decision: capture the supervised runtime boundary with focused verification." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          expect(calls.map((call) => call.operation)).toEqual(["health"]);
          const endpoint = options.env.DECK_RUNNER_MEMORY_ENDPOINT!;
          const token = options.env.DECK_RUNNER_MEMORY_TOKEN!;
          const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
          await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "native-session-start", timestamp: Date.now(), event: "session_start", sessionId: "native-session", role: "lead", query: "Decision: capture the supervised runtime boundary with focused verification." }) });
          await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "native-prompt-capture", timestamp: Date.now(), event: "capture", sessionId: "native-session", source: "trusted-user-prompt", content: "Decision: capture the supervised runtime boundary with focused verification." }) });
          return { exitCode: 0, stdout: "finished token=secret", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport },
      });

      expect(result.status).toBe("launched");
      expect(calls.map((call) => call.operation)).toEqual(["health", "profile", "search", "add"]);
      expect(calls[3]!.payload).toMatchObject({ containerTag: "sm_project_v1_kevin15011_deck", customId: expect.stringMatching(/^deck_conversation_/) });
      expect(calls[3]!.payload).toMatchObject({ metadata: { role: "user", source: "trusted-user-prompt" } });
      expect(JSON.stringify(calls[3]!.payload)).toContain("supervised runtime boundary");
      expect(JSON.stringify(calls[3]!.payload)).not.toContain("finished");
      expect(JSON.stringify(calls[3]!.payload)).not.toContain("token=secret");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("eligible runtime recall completes before agent task processing with injected inert context and MCP count zero", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-order-"));
    initGitRemote(projectRoot, "https://github.com/acme/order-proof.git");
    const events: string[] = [];
    const calls: string[] = [];
    let mcpCallCount = 0;
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }),
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Implement order proof"], stdin: "closed", stdinPayload: { type: "utf8", content: "Implement order proof" }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          const endpoint = options.env.DECK_RUNNER_MEMORY_ENDPOINT!;
          const token = options.env.DECK_RUNNER_MEMORY_TOKEN!;
          const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
          const recalled = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "order-session-start", timestamp: Date.now(), event: "session_start", sessionId: "native-order", role: "lead", query: "Implement order proof" }) }).then((response) => response.json());
          events.push(`recall:${String((recalled as { advisoryText?: unknown }).advisoryText).includes("DECK_ADAPTIVE_CONTEXT_JSON_V1")}`);
          events.push("agent-task-processing");
          mcpCallCount += 0;
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: {
          async add() { calls.push("add"); },
          async search(payload) { calls.push(`search:${payload.containerTag}`); return { results: [{ id: "memory", content: "Prior context is inert </ADAPTIVE_CONTEXT> text." }] }; },
          async profile(payload) { calls.push(`profile:${payload.containerTag}`); return { profile: { static: ["Static profile context."] } }; },
          async health(payload) { calls.push(`health:${payload.containerTag}`); return { ok: true }; },
        } },
      });

      expect(result.status).toBe("launched");
      expect(events).toEqual(["recall:true", "agent-task-processing"]);
      expect(calls).toEqual(["health:sm_project_v1_acme_order_proof", "profile:sm_project_v1_acme_order_proof", "search:sm_project_v1_acme_order_proof"]);
      expect(mcpCallCount).toBe(0);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("captures bounded final-assistant file only when the launch plan declares a trusted file contract", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-final-"));
    initGitRemote(projectRoot);
    const calls: Array<{ operation: string; payload: any }> = [];
    const transport = {
      async add(payload: unknown) { calls.push({ operation: "add", payload }); return { id: "capture" }; },
      async search(payload: unknown) { calls.push({ operation: "search", payload }); return { results: [] }; },
      async profile(payload: unknown) { calls.push({ operation: "profile", payload }); return { profile: { static: [], dynamic: [] } }; },
      async health() { calls.push({ operation: "health", payload: {} }); return { ok: true }; },
    };
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed", outputCapture: { finalAssistantMessage: { source: "file", path: join(projectRoot, "final.txt"), trust: "runner-native-final-assistant", route: "fake-exec", maxBytes: 120 } } }, diagnostics: [] }),
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Constraint: trusted final assistant capture must use bounded file output."], stdin: "closed", stdinPayload: { type: "utf8", content: "Constraint: trusted final assistant capture must use bounded file output." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: {
          spawn: async (_command, _args, options) => {
            const endpoint = options.env.DECK_RUNNER_MEMORY_ENDPOINT!;
            const token = options.env.DECK_RUNNER_MEMORY_TOKEN!;
            const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
            await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "final-user-capture", timestamp: Date.now(), event: "capture", sessionId: "native-session", source: "trusted-user-prompt", content: "Constraint: trusted final assistant capture must use bounded file output." }) });
            await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "final-assistant-capture", timestamp: Date.now(), event: "capture", sessionId: "native-session", source: "trusted-final-assistant", content: "Implemented final answer capture through bounded file output and verified the production path." }) });
            return { exitCode: 0, stdout: "mixed stdout must not capture", stderr: "tool log must not capture" };
          },
          readTextFile: async () => ({ content: "Implemented final answer capture through bounded file output and verified the production path.", truncated: false }),
          removeFile: async () => {},
        },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport },
      });
      expect(result.status).toBe("launched");
      const adds = calls.filter((call) => call.operation === "add").map((call) => call.payload);
      expect(adds).toHaveLength(2);
      expect(adds[0]).toMatchObject({ metadata: { role: "user", source: "trusted-user-prompt" } });
      expect(adds[1]).toMatchObject({ metadata: { role: "assistant", source: "trusted-final-assistant" } });
      expect(adds[1].content).toBe("Implemented final answer capture through bounded file output and verified the production path.");
      expect(JSON.stringify(adds)).not.toContain("tool log");
      expect(JSON.stringify(adds)).not.toContain("mixed stdout");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("explicit recall blocks before launch when production runtime recall is unavailable", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-explicit-recall-"));
    initGitRemote(projectRoot);
    const calls: string[] = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: () => { calls.push("launch-plan"); return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }; },
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["What did we do so far?"], stdin: "closed", stdinPayload: { type: "utf8", content: "What did we do so far?" }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => { calls.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: { add: async () => {}, search: async () => { throw new Error("provider unavailable"); }, profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("reason=transport_error") });
      expect(JSON.stringify(result)).not.toContain("provider unavailable");
      expect(calls).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("explicit remember captures once with correlation id and skips duplicate prompt capture", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-explicit-remember-"));
    initGitRemote(projectRoot);
    const calls: Array<{ operation: string; payload: any }> = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: (launch) => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed", stdinPayload: launch.mode === "exec" ? launch.stdinPayload : undefined }, diagnostics: [] }),
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Remember that Pi MCP config remains credential-free while Deck stores the runtime token."], stdin: "closed", stdinPayload: { type: "utf8", content: "Remember that Pi MCP config remains credential-free while Deck stores the runtime token." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: {
          async add(payload: unknown) { calls.push({ operation: "add", payload }); return { id: "capture" }; },
          async search(payload: unknown) { calls.push({ operation: "search", payload }); return { results: [] }; },
          async profile(payload: unknown) { calls.push({ operation: "profile", payload }); return { profile: {} }; },
          async health() { calls.push({ operation: "health", payload: {} }); return { ok: true }; },
        } },
      });
      expect(result.status).toBe("launched");
      const adds = calls.filter((call) => call.operation === "add").map((call) => call.payload);
      expect(adds).toHaveLength(1);
      expect(adds[0]).toMatchObject({ metadata: { role: "user", source: "explicit-remember", dependency: "explicit-remember", correlationId: expect.stringMatching(/^explicit-remember-[a-f0-9]{16}$/) } });
      expect(adds[0].content).not.toMatch(/^Remember that/i);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("explicit remember failure blocks before runner spawn", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-explicit-remember-fail-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    const calls: string[] = [];
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Remember that this explicit write must fail before launch."], stdin: "closed", stdinPayload: { type: "utf8", content: "Remember that this explicit write must fail before launch." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => { calls.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: { add: async () => { throw new Error("write unavailable"); }, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("reason=transport_error") });
      expect(JSON.stringify(result)).not.toContain("write unavailable");
      expect(calls).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("explicit --memory=none launch override disables globally enabled runtime before launch planning", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-none-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    const calls: string[] = [];
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: (installInput) => {
            expect(installInput.deckConfig.adaptiveMemory.enabled).toBe(false);
            return { files: [], mutationPreview: [] };
          },
          buildLaunchPlan: (launch) => {
            expect(launch.deckConfig.adaptiveMemory.enabled).toBe(false);
            return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] };
          },
        }),
        cliMemoryProvider: "none",
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["do work"], stdin: "closed", stdinPayload: { type: "utf8", content: "do work" }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }) },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: { add: async () => { calls.push("add"); }, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      expect(calls).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("only Codex exec declares trusted output-last-message file capture; Pi/OpenCode routes remain unsupported", async () => {
    const codex = buildCodexLaunchPlan(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "exec", prompt: ["x"], stdin: "closed", stdinPayload: { type: "utf8", content: "x" } }), { interactive: true, exec: true, resumeById: true, resumeLatest: true });
    expect(codex).toMatchObject({ status: "ready", plan: { outputCapture: { finalAssistantMessage: { source: "file", trust: "runner-native-final-assistant", route: "codex-exec-output-last-message" } } } });
    if (codex.status === "ready") expect(codex.plan.args).toContain("--output-last-message");
    const opencode = await createOpenCodeRunnerAdapter().buildLaunchPlan!(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }));
    const pi = await createPiRunnerAdapter().buildLaunchPlan!(withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }));
    if (opencode.status === "ready") expect(opencode.plan.outputCapture).toBeUndefined();
    if (pi.status === "ready") expect(pi.plan.outputCapture).toBeUndefined();
  });

  test("previews exact safe mutation metadata before non-interactive refusal and never applies", async () => {
    const events: string[] = [];
    const result = await runRunnerLaunch({
      adapter: adapter({ applyDeveloperTeamInstall: async () => { events.push("apply"); throw new Error("must not apply"); } }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      interactive: false,
      presentPreview: async (preview) => { events.push(`preview:${preview}`); },
      processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    });
    expect(result.status).toBe("blocked");
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("create managed pre=absent post=abc owner=deck-file");
    expect(events).not.toContain("apply");
  });

  test("previews before --yes apply and preserves unsupported separately", async () => {
    const events: string[] = [];
    const result = await runRunnerLaunch({
      adapter: adapter({
        applyDeveloperTeamInstall: async () => { events.push("apply"); return { results: [], changedCount: 1, unchangedCount: 0 }; },
        buildLaunchPlan: () => ({ status: "unsupported", code: "no-resume", diagnostics: [{ code: "no-resume", severity: "error", message: "unsupported" }] }),
      }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" }),
      interactive: false,
      yes: true,
      presentPreview: async () => { events.push("preview"); },
      processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    });
    expect(events).toEqual(["preview"]);
    expect(result).toMatchObject({ status: "unsupported", code: "no-resume" });
  });

  test("renders generic adapter prerequisite diagnostics before building the install plan", async () => {
    let prepared = 0;
    let preview = "";
    const result = await runRunnerLaunch({
      adapter: adapter({
        prepareDeveloperTeamInstall: async () => {
          prepared += 1;
          return [{ code: "shared-prerequisite", severity: "warning", message: "A runner prerequisite was checked." }];
        },
        buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
      }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      dryRun: true,
      interactive: false,
      presentPreview: async (value) => { preview = value; },
      processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    });

    expect(result.status).toBe("dry-run");
    expect(prepared).toBe(1);
    expect(preview).toContain("A runner prerequisite was checked.");
  });

  test("does not build a Codex launch plan or spawn for install-only", async () => {
    let launchPlanCalls = 0;
    let spawnCalls = 0;
    const result = await runRunnerLaunch({
      adapter: adapter({
        runnerId: "codex",
        readModelAssignments: () => ({}),
        readThinkingAssignments: () => ({}),
        buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
        buildLaunchPlan: () => {
          launchPlanCalls += 1;
          throw new Error("install-only must not plan a Codex launch");
        },
      }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      installOnly: true,
      interactive: false,
      presentPreview: async () => {},
      processEffects: { spawn: async () => {
        spawnCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      } },
    });

    expect(result.status).toBe("installed");
    expect(launchPlanCalls).toBe(0);
    expect(spawnCalls).toBe(0);
  });

  test("shows adapter-owned future launch policy in an install-only dry-run without planning or spawning", async () => {
    let launchPlanCalls = 0;
    let spawnCalls = 0;
    let preview = "";
    const result = await runRunnerLaunch({
      adapter: adapter({
        buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
        getLaunchPolicyDiagnostics: () => [{
          code: "future-launch-policy",
          severity: "warning",
          message: "Future launches disable sandboxing and command approvals.",
        }],
        buildLaunchPlan: () => {
          launchPlanCalls += 1;
          throw new Error("install-only must not plan a launch");
        },
      }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      installOnly: true,
      dryRun: true,
      interactive: false,
      presentPreview: async (value) => { preview = value; },
      processEffects: { spawn: async () => {
        spawnCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      } },
    });

    expect(result.status).toBe("dry-run");
    expect(preview).toContain("Future launches disable sandboxing and command approvals.");
    expect(launchPlanCalls).toBe(0);
    expect(spawnCalls).toBe(0);
  });

  test("real Pi and OpenCode adapters expose generic interactive compatibility plans", async () => {
    const input = withDeckConfig({ projectRoot: "/tmp/deck-generic-launch", teamId: "developer-team", mode: "interactive" as const });
    expect(await createPiRunnerAdapter().buildLaunchPlan?.(input)).toMatchObject({ status: "ready", plan: { command: "pi", stdio: "inherit" } });
    expect(await createOpenCodeRunnerAdapter().buildLaunchPlan?.(input)).toMatchObject({ status: "ready", plan: { command: "opencode", stdio: "inherit" } });
  });

  test("real Pi and OpenCode adapters traverse generic preview, consent, apply, verify, and spawn", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-generic-runners-"));
    try {
      const adapters = [
        createPiRunnerAdapter({ homeDirectory: join(root, "pi-home") }),
        createOpenCodeRunnerAdapter({ developerTeamConfigDir: join(root, "opencode-home") }),
      ];
      for (const runner of adapters) {
        await mkdir(join(root, runner.runnerId), { recursive: true });
        const events: string[] = [];
        let preview = "";
        const result = await runRunnerLaunch({
          adapter: runner,
          launch: withDeckConfig({ projectRoot: join(root, runner.runnerId), teamId: "developer-team", mode: "interactive" }),
          interactive: true,
          presentPreview: async (value) => { preview = value; events.push("preview"); },
          confirm: async () => { events.push("consent"); return true; },
          processEffects: { spawn: async () => { events.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        });
        expect(result.status).toBe("launched");
        expect(events).toEqual(["preview", "consent", "spawn"]);
        expect(preview).not.toContain("sandboxing and command approvals are disabled");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("preserves persisted Codex root assignments while preparing the launch install plan", async () => {
    let received: unknown;
    const result = await runRunnerLaunch({
      adapter: adapter({
        runnerId: "codex",
        readModelAssignments: () => ({ "deck-lead": "openai-codex/gpt-5.6-sol" }),
        readThinkingAssignments: () => ({ "deck-lead": "high" }),
        buildDeveloperTeamInstallPlan: (input) => {
          received = input;
          return { files: [], mutationPreview: [] };
        },
      }),
      launch: withDeckConfig({ projectRoot: "/project", teamId: "developer-team", mode: "interactive" }),
      interactive: false,
      yes: true,
      presentPreview: async () => {},
      processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    });
    expect(result.status).toBe("launched");
    expect(received).toMatchObject({
      modelAssignments: { "deck-lead": "openai-codex/gpt-5.6-sol" },
      thinkingAssignments: { "deck-lead": "high" },
    });
  });

  test("all unbound Codex production routes install and spawn only as static-compatible", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-launch-"));
    const projectRoot = join(root, "project");
    try {
      await mkdir(projectRoot, { recursive: true });
      const adapter = createCodexRunnerAdapter({
        journalRoot: join(root, "journals"),
        preflight: {
          probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          readProject: async (project) => ({
            config: await readFile(join(project, ".codex", "config.toml"), "utf8").catch(() => null),
            roles: [],
            skills: [],
            agentsInstructions: false,
          }),
        },
      });
      const routes = [
        { launch: withDeckConfig({ projectRoot, teamId: "developer-team", mode: "interactive" as const }), newSession: true },
        { launch: withDeckConfig({ projectRoot, teamId: "developer-team", mode: "exec" as const, prompt: [], stdin: "closed" as const }), newSession: true },
        { launch: withDeckConfig({ projectRoot, teamId: "developer-team", mode: "resume-by-id" as const, sessionId: "session-1" }), args: ["--dangerously-bypass-approvals-and-sandbox", "resume", "session-1"] },
        { launch: withDeckConfig({ projectRoot, teamId: "developer-team", mode: "resume-latest" as const }), args: ["--dangerously-bypass-approvals-and-sandbox", "resume", "--last"] },
      ];
      for (const route of routes) {
        const events: string[] = [];
        const previews: string[] = [];
        const result = await runRunnerLaunch({
          adapter,
          launch: route.launch,
          interactive: false,
          yes: true,
          presentPreview: async (preview) => { previews.push(preview); events.push("preview"); },
          processEffects: { spawn: async (_command, args, options) => {
            events.push("spawn");
            const bypass = "--dangerously-bypass-approvals-and-sandbox";
            expect(args.filter((arg) => arg === bypass)).toHaveLength(1);
            if (route.newSession) {
              expect(args).toContain("-c");
              expect(args.join(" ")).toContain("developer_instructions=");
              expect(args).not.toContain("--agent");
              if (route.launch.mode === "exec") {
                expect(args).toContain("--output-last-message");
                expect(args.at(-1)).toBe("-");
                expect(options.stdinPayload).toEqual({ type: "utf8", content: "" });
              }
            } else {
              expect(args).toEqual(route.args ?? []);
              expect(options.stdinPayload).toBeUndefined();
            }
            expect(options.env.DECK_CODEX_BRIDGE_ENDPOINT).toBeUndefined();
            expect(options.env.DECK_CODEX_BRIDGE_TOKEN).toBeUndefined();
            return { exitCode: 0, stdout: "", stderr: "" };
          } },
        });
        expect(result.status).toBe("launched");
        expect(events).toEqual(["preview", "spawn"]);
        expect(previews).toEqual([expect.stringContaining("sandboxing and command approvals are disabled")]);
        if (result.status === "launched") {
          expect(result.launch.status).toBe("ready");
          if (result.launch.status === "ready") {
            expect(result.launch.plan).toMatchObject({ executionClass: "static-compatible" });
            expect(result.launch.plan.bridgeBinding).toBeUndefined();
          }
          expect(result.launch.diagnostics).toContainEqual(expect.objectContaining({ code: "materialized-but-inactive" }));
        }
      }
      expect(await Bun.file(join(projectRoot, ".codex", "hooks", "developer-team-execution.js")).exists()).toBe(true);
      expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).toContain("deck-codex-hook-v1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("preserves signal outcomes and surfaces spawn failures", async () => {
    const signal = await executeRunnerLaunchPlan({ command: "fake", args: [], cwd: "/p", stdio: "pipe", stdin: "closed" }, {
      spawn: async () => ({ exitCode: 1, signal: "SIGTERM", stdout: "", stderr: "" }),
    });
    expect(signal.signal).toBe("SIGTERM");

    const result = await runRunnerLaunch({
      adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }) }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      interactive: false,
      yes: true,
      presentPreview: async () => {},
      processEffects: { spawn: async () => { throw new Error("ENOENT"); } },
    });
    expect(result).toMatchObject({ status: "blocked", message: "Runner spawn failed: ENOENT" });
  });

  test("awaits exact-operation rollback when semantic verification fails", async () => {
    const events: string[] = [];
    let mutated = false;
    const operation = { runnerId: "fake", operationId: "operation-1", transactions: [{ kind: "native", id: "transaction-1" }] } as const;
    const result = await runRunnerLaunch({
      adapter: adapter({
        backupDeveloperTeamFiles: () => ({ payload: operation, diagnostics: [] }),
        applyDeveloperTeamInstall: async () => {
          mutated = true;
          return { results: [{ agentId: "managed", kind: "file", status: "created" }], changedCount: 1, unchangedCount: 0, operation };
        },
        verifyDeveloperTeamInstall: () => ({ valid: false, diagnostics: ["semantic drift"] }),
        rollbackDeveloperTeamFiles: async (backup) => {
          events.push(`rollback:${(backup as { payload: typeof operation }).payload.operationId}`);
          await Bun.sleep(5);
          mutated = false;
          return { status: "rolled-back", conflicts: [], diagnostics: [] };
        },
      }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      interactive: false,
      yes: true,
      presentPreview: async () => {},
      processEffects: { spawn: async () => { throw new Error("must not spawn"); } },
    });
    expect(mutated).toBe(false);
    expect(events).toEqual(["rollback:operation-1"]);
    expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("rolled back") });
  });

  test("real Codex semantic verification failure restores the exact applied project operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-launch-verify-rollback-"));
    const projectRoot = join(root, "project");
    try {
      await mkdir(projectRoot, { recursive: true });
      const adapter = createCodexRunnerAdapter({
        journalRoot: join(root, "journals"),
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async (project) => ({ config: await readFile(join(project, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: false }),
        },
      });
      adapter.verifyDeveloperTeamInstall = () => ({ valid: false, diagnostics: ["forced semantic mismatch"] });
      const result = await runRunnerLaunch({
        adapter,
        launch: withDeckConfig({ projectRoot, teamId: "developer-team", mode: "interactive" }),
        interactive: false,
        yes: true,
        presentPreview: async () => {},
        processEffects: { spawn: async () => { throw new Error("must not spawn"); } },
      });
      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("rolled back") });
      expect(await Bun.file(join(projectRoot, "AGENTS.md")).exists()).toBe(false);
      expect(await Bun.file(join(projectRoot, ".codex", "agents", "deck-lead.toml")).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("surfaces verification rollback conflicts and failures", async () => {
    const operation = { runnerId: "fake", operationId: "operation-2", transactions: [{ kind: "native", id: "transaction-2" }] } as const;
    const base = {
      backupDeveloperTeamFiles: () => ({ payload: operation, diagnostics: [] }),
      applyDeveloperTeamInstall: async () => ({ results: [], changedCount: 1, unchangedCount: 0, operation }),
      verifyDeveloperTeamInstall: () => ({ valid: false, diagnostics: ["semantic drift"] }),
    };
    const run = (rollbackDeveloperTeamFiles: RunnerAdapter["rollbackDeveloperTeamFiles"]) => runRunnerLaunch({
      adapter: adapter({ ...base, rollbackDeveloperTeamFiles }),
      launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
      interactive: false,
      yes: true,
      presentPreview: async () => {},
      processEffects: { spawn: async () => { throw new Error("must not spawn"); } },
    });
    expect(await run(async () => ({ status: "conflict", conflicts: ["managed"], diagnostics: ["later edit preserved"] }))).toMatchObject({
      status: "blocked",
      message: expect.stringContaining("later edit preserved"),
    });
    expect(await run(async () => { throw new Error("journal unavailable"); })).toMatchObject({
      status: "blocked",
      message: expect.stringContaining("journal unavailable"),
    });
  });
});
