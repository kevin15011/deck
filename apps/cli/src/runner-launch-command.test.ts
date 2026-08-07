import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";

import { createNodeRunnerProcessEffects, executeRunnerLaunchPlan } from "./runner-launch-command";
import { runRunnerLaunch } from "./runner-launch-command";
import type { RunnerAdapter } from "@deck/core";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { buildCodexLaunchPlan, createCodexRunnerAdapter } from "@deck/adapter-codex";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("executeRunnerLaunchPlan", () => {
  test("merges an allowlisted overlay, redacts diagnostics, and propagates exit", async () => {
    const result = await executeRunnerLaunchPlan({
      command: "runner",
      args: ["exec"],
      cwd: "/project",
      stdio: "pipe",
      stdin: "closed",
      captureLimitBytes: 5,
      envOverlay: { PUBLIC: { value: "ok" }, TOKEN: { value: "secret", sensitive: true } },
    }, {
      inheritedEnv: { PATH: "/bin" },
      spawn: async (_command, _args, options) => ({ exitCode: 7, stdout: "123456", stderr: options.env.TOKEN }),
    });
    expect(result).toEqual({ exitCode: 7, signal: undefined, stdout: "12345", stderr: "[REDACTED]", truncated: true });
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
      { projectRoot: "/project", teamId: "developer-team", mode: "exec", prompt: ["safe"], stdin: "inherit", stdinPayload: { type: "utf8", content: "safe" } },
      { interactive: true, exec: true, resumeById: true, resumeLatest: true },
    );
    expect(launch.status).toBe("ready");
    if (launch.status !== "ready") return;
    const result = await executeRunnerLaunchPlan(launch.plan, {
      spawn: async (_command, args, options) => {
        expect(args).toEqual(["exec", "-"]);
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

  test("previews exact safe mutation metadata before non-interactive refusal and never applies", async () => {
    const events: string[] = [];
    const result = await runRunnerLaunch({
      adapter: adapter({ applyDeveloperTeamInstall: async () => { events.push("apply"); throw new Error("must not apply"); } }),
      launch: { projectRoot: "/p", teamId: "developer-team", mode: "interactive" },
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
      launch: { projectRoot: "/p", teamId: "developer-team", mode: "resume-latest" },
      interactive: false,
      yes: true,
      presentPreview: async () => { events.push("preview"); },
      processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    });
    expect(events).toEqual(["preview"]);
    expect(result).toMatchObject({ status: "unsupported", code: "no-resume" });
  });

  test("real Pi and OpenCode adapters expose generic interactive compatibility plans", async () => {
    const input = { projectRoot: "/tmp/deck-generic-launch", teamId: "developer-team", mode: "interactive" as const };
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
        const result = await runRunnerLaunch({
          adapter: runner,
          launch: { projectRoot: join(root, runner.runnerId), teamId: "developer-team", mode: "interactive" },
          interactive: true,
          presentPreview: async () => { events.push("preview"); },
          confirm: async () => { events.push("consent"); return true; },
          processEffects: { spawn: async () => { events.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        });
        expect(result.status).toBe("launched");
        expect(events).toEqual(["preview", "consent", "spawn"]);
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
      launch: { projectRoot: "/project", teamId: "developer-team", mode: "interactive" },
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
        { launch: { projectRoot, teamId: "developer-team", mode: "interactive" as const }, newSession: true },
        { launch: { projectRoot, teamId: "developer-team", mode: "exec" as const, prompt: [], stdin: "closed" as const }, newSession: true },
        { launch: { projectRoot, teamId: "developer-team", mode: "resume-by-id" as const, sessionId: "session-1" }, args: ["resume", "session-1"] },
        { launch: { projectRoot, teamId: "developer-team", mode: "resume-latest" as const }, args: ["resume", "--last"] },
      ];
      for (const route of routes) {
        const events: string[] = [];
        const result = await runRunnerLaunch({
          adapter,
          launch: route.launch,
          interactive: false,
          yes: true,
          presentPreview: async () => { events.push("preview"); },
          processEffects: { spawn: async (_command, args, options) => {
            events.push("spawn");
            if (route.newSession) {
              expect(args).toContain("-c");
              expect(args.join(" ")).toContain("developer_instructions=");
              expect(args).not.toContain("--agent");
              if (route.launch.mode === "exec") {
                expect(args.slice(-2)).toEqual(["exec", "-"]);
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
        if (result.status === "launched") {
          expect(result.launch.status).toBe("ready");
          if (result.launch.status === "ready") {
            expect(result.launch.plan).toMatchObject({ executionClass: "static-compatible" });
            expect(result.launch.plan.bridgeBinding).toBeUndefined();
          }
          expect(result.launch.diagnostics).toContainEqual(expect.objectContaining({ code: "materialized-but-inactive" }));
        }
      }
      expect(await Bun.file(join(projectRoot, ".codex", "hooks", "developer-team-execution.js")).exists()).toBe(false);
      expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).not.toContain("deck-codex-hook-v1");
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
      launch: { projectRoot: "/p", teamId: "developer-team", mode: "interactive" },
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
      launch: { projectRoot: "/p", teamId: "developer-team", mode: "interactive" },
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
        launch: { projectRoot, teamId: "developer-team", mode: "interactive" },
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
      launch: { projectRoot: "/p", teamId: "developer-team", mode: "interactive" },
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
