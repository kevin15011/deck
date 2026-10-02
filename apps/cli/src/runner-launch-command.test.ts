import { layout, testTools } from "../../../packages/adapter-codex/src/test-tools";
import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { classifyExplicitMemoryIntent, createNodeRunnerProcessEffects, executeRunnerLaunchPlan } from "./runner-launch-command";
import { runRunnerLaunch } from "./runner-launch-command";
import { deriveDeckRuntimeSessionId } from "./supermemory-runtime-host";
import { createFreshDeckSessionId, persistNativeDeckRuntimeSessionMapping, resolveDeckRuntimeSessionId } from "./supermemory-session-store";
import { createOwnerOnlyFileSecretStore, getDefaultDeckConfig, type RunnerAdapter, type RunnerLaunchInput } from "@deck/core";
import { storeOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { buildCodexLaunchPlan, createCodexRunnerAdapter } from "@deck/adapter-codex";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const withDeckConfig = <T extends Omit<RunnerLaunchInput, "deckConfig">>(input: T): T & Pick<RunnerLaunchInput, "deckConfig"> => ({
  ...input,
  deckConfig: getDefaultDeckConfig(),
});

const TOKEN_SENTINEL = "sk-test-runner-secret-value-123456";
const TEST_SUPERMEMORY_LOADER_LOCATOR = "file:///test/deck/opencode/supermemory/2.0.15/opencode-supermemory-loader.mjs";
const readyOpenCodeSupermemoryLaunchEffects = {
  inspectOwned: () => ({
    ready: true as const,
    code: "ready" as const,
    diagnostic: "verified",
    paths: {
      installRoot: "/test/deck/opencode/supermemory/2.0.15",
      packageDirectory: "/test/deck/opencode/supermemory/2.0.15/node_modules/opencode-supermemory",
      loaderPath: "/test/deck/opencode/supermemory/2.0.15/opencode-supermemory-loader.mjs",
      loaderLocator: TEST_SUPERMEMORY_LOADER_LOCATOR,
    },
  }),
  inspectRegistrations: () => ({ ok: true as const, conflicts: [] }),
};

async function loadInstalledOpenCodePlugin(pluginPath: string, memoryLoopback: { endpoint?: string; token?: string }) {
  const url = `${pathToFileURL(pluginPath).href}?cache=${Date.now()}-${Math.random()}`;
  const module = await import(url) as Record<string, unknown>;
  const factory = module.createOpenCodeDeveloperTeamExecutionPluginV1 ?? module.default;
  if (typeof factory !== "function") throw new Error("installed OpenCode developer-team plugin factory is unavailable");
  const pluginFactory = await (factory as (options: { memoryLoopback: typeof memoryLoopback }) => Promise<unknown> | unknown)({ memoryLoopback });
  const plugin = typeof pluginFactory === "function" ? await (pluginFactory as () => Promise<unknown> | unknown)() : pluginFactory;
  return plugin as Record<string, (...args: any[]) => Promise<void>>;
}

function managedReadinessMessages(result: Awaited<ReturnType<typeof runRunnerLaunch>>): string[] {
  const diagnostics = result.status === "launched" ? result.launch.diagnostics : "diagnostics" in result ? result.diagnostics ?? [] : [];
  return diagnostics.filter((diagnostic) => typeof diagnostic !== "string" && diagnostic.code === "managed-session-readiness").map((diagnostic) => typeof diagnostic === "string" ? diagnostic : diagnostic.message);
}

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
      envOverlay: { DECK_RUNNER_MEMORY_ENDPOINT: { value: "http://127.0.0.1:1234/deck-runner-memory/v1" }, DECK_RUNNER_MEMORY_TOKEN: { value: "loopback-token", sensitive: true }, DECK_RUNNER_MEMORY_SCOPE: { value: "fresh-plan-scope" }, DECK_CODEX_BRIDGE_MODE: { value: "fresh-plan-mode" } },
    }, {
      inheritedEnv: {
        PATH: "/bin",
        OPENAI_API_KEY: "sk-test-secret",
        COOKIE: "Cookie: session=secret",
        DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:9999/stale-parent-memory",
        DECK_RUNNER_MEMORY_TOKEN: "stale-parent-memory-token",
        DECK_RUNNER_MEMORY_SCOPE: "stale-parent-memory-scope",
        DECK_CODEX_BRIDGE_ENDPOINT: "http://127.0.0.1:9999/stale-parent-codex",
        DECK_CODEX_BRIDGE_TOKEN: "stale-parent-codex-token",
        DECK_CODEX_BRIDGE_MODE: "stale-parent-codex-mode",
      },
      spawn: async (_command, _args, options) => {
        expect(options.env).toMatchObject({ PATH: "/bin", DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:1234/deck-runner-memory/v1", DECK_RUNNER_MEMORY_TOKEN: "loopback-token", DECK_RUNNER_MEMORY_SCOPE: "fresh-plan-scope", DECK_CODEX_BRIDGE_MODE: "fresh-plan-mode" });
        expect(options.env.DECK_CODEX_BRIDGE_ENDPOINT).toBeUndefined();
        expect(options.env.DECK_CODEX_BRIDGE_TOKEN).toBeUndefined();
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
        expect(args.slice(0, 5)).toEqual(["--dangerously-bypass-approvals-and-sandbox", "-c", 'features.multi_agent_v2.multi_agent_mode_hint_text=""', "exec", "--output-last-message"]);
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

  test("does not install, preview or start legacy memory host for an unverified Claude developer adapter", async () => {
    const stateHome = await mkdtemp(join(tmpdir(), "deck-claude-guard-state-"));
    const forbiddenTransport = {
      add: async () => { throw new Error("must not contact memory provider"); },
      search: async () => { throw new Error("must not contact memory provider"); },
      profile: async () => { throw new Error("must not contact memory provider"); },
    };
    try {
      for (const installOnly of [false, true]) {
        for (const memoryEnabled of [false, true]) {
        let calls = 0;
        const config = getDefaultDeckConfig();
        const result = await runRunnerLaunch({
          adapter: adapter({
            runnerId: "claude",
            buildDeveloperTeamInstallPlan: () => { calls++; throw new Error("must not plan installation"); },
            inspectProject: async () => { calls++; throw new Error("must not inspect"); },
          }),
          launch: { projectRoot: "/project", teamId: "developer-team", mode: "interactive", deckConfig: {
            ...config,
            adaptiveMemory: { ...config.adaptiveMemory, enabled: memoryEnabled },
          } },
          installOnly,
          interactive: false,
          supermemoryRuntime: { transport: forbiddenTransport, stateHome },
          presentPreview: async () => { calls++; },
          processEffects: { spawn: async () => { calls++; throw new Error("must not spawn"); } },
        });
        expect(result).toMatchObject({ status: "unsupported", code: "claude-developer-unverified" });
        expect(calls).toBe(0);
        }
      }
    } finally { await rm(stateHome, { recursive: true, force: true }); }
  });

  test("prints one full mutation preview and uses a concise confirmation question", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-preview-once-"));
    initGitRemote(projectRoot);
    const output: string[] = [];
    try {
      const result = await runRunnerLaunch({
        adapter: adapter(),
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() },
        interactive: true,
        verbose: true,
        presentPreview: async (preview) => { output.push(preview); },
        confirm: async (question) => { output.push(question); return true; },
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      });

      expect(result.status).toBe("launched");
      expect(output.join("\n").match(/create managed pre=absent post=abc owner=deck-file/g)?.length).toBe(1);
      expect(output.at(-1)).toBe("Apply these changes and launch Fake? [y/N]");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

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

  test("OpenCode uses the exact SSH-alias profile without claiming an unverified canonical GitHub tag or starting the Deck memory runtime", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-opencode-profile-launch-"));
    const configHome = await mkdtemp(join(tmpdir(), "deck-opencode-profile-secrets-"));
    const sshHome = await mkdtemp(join(tmpdir(), "deck-opencode-profile-home-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome });
    initGitRemote(projectRoot, "git@work:org/repo.git");
    storeOpenCodeSupermemoryCredential({ store: secretStore, alias: "work", token: "sm_work", eligibleAliases: ["work"] });
    storeOpenCodeSupermemoryCredential({ store: secretStore, token: "sm_default", makeDefault: true, eligibleAliases: ["work"] });
    let childEnv: Record<string, string> | undefined;
    const previousHome = process.env.HOME;
    try {
      mkdirSync(join(sshHome, ".ssh"), { mode: 0o700 });
      writeFileSync(join(sshHome, ".ssh", "config"), "Host=work\n", { mode: 0o600 });
      process.env.HOME = sshHome;
      const result = await runRunnerLaunch({
        adapter: adapter({ runnerId: "opencode", displayName: "OpenCode", buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } } },
        interactive: false,
        yes: true,
        presentPreview: async () => {},
        supermemoryRuntime: { secretStore },
        opencodeSupermemoryLaunchEffects: readyOpenCodeSupermemoryLaunchEffects,
        processEffects: {
          inheritedEnv: { OPENCODE_DECK_INVOCATION_AUTHORIZATION: "invocation-required", SUPERMEMORY_REPO_TAG: "sm_inherited_wrong" },
          spawn: async (_command, _args, options) => {
            childEnv = options.env;
            return { exitCode: 0, stdout: "", stderr: "" };
          },
        },
      });

      expect(result.status).toBe("launched");
      expect(childEnv?.SUPERMEMORY_API_KEY).toBe("sm_work");
      expect(childEnv?.SUPERMEMORY_API_URL).toBe("https://api.supermemory.ai");
      expect(childEnv?.SUPERMEMORY_REPO_TAG).toBeUndefined();
      expect(childEnv?.OPENCODE_DECK_INVOCATION_AUTHORIZATION).toBeUndefined();
      expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_ENDPOINT");
      expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_TOKEN");
      expect(JSON.stringify(result)).toContain("co-loaded global or project plugins can access the selected process credential");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
      await rm(sshHome, { recursive: true, force: true });
    }
  });

  test("OpenCode uses only the explicit default when SSH discovery is uncertain", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-opencode-profile-uncertain-"));
    const configHome = await mkdtemp(join(tmpdir(), "deck-opencode-profile-secrets-"));
    const sshHome = await mkdtemp(join(tmpdir(), "deck-opencode-profile-home-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome });
    initGitRemote(projectRoot, "git@work:org/repo.git");
    storeOpenCodeSupermemoryCredential({ store: secretStore, alias: "work", token: "sm_work", eligibleAliases: ["work"] });
    storeOpenCodeSupermemoryCredential({ store: secretStore, token: "sm_default", makeDefault: true, eligibleAliases: ["work"] });
    let childToken: string | undefined;
    const previousHome = process.env.HOME;
    try {
      mkdirSync(join(sshHome, ".ssh", "config.d"), { recursive: true, mode: 0o700 });
      writeFileSync(join(sshHome, ".ssh", "config"), "Include config.*/work\nHost work\n", { mode: 0o600 });
      process.env.HOME = sshHome;
      const result = await runRunnerLaunch({
        adapter: adapter({ runnerId: "opencode", displayName: "OpenCode", buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } } },
        interactive: false,
        yes: true,
        presentPreview: async () => {},
        supermemoryRuntime: { secretStore },
        opencodeSupermemoryLaunchEffects: readyOpenCodeSupermemoryLaunchEffects,
        processEffects: { spawn: async (_command, _args, options) => {
          childToken = options.env.SUPERMEMORY_API_KEY;
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
      });

      expect(result.status).toBe("launched");
      expect(childToken).toBe("sm_default");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
      await rm(sshHome, { recursive: true, force: true });
    }
  });

  test("OpenCode canonical repository tags are clone-path independent and owner-sensitive across GitHub remote forms", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-opencode-canonical-tags-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: join(root, "config") });
    storeOpenCodeSupermemoryCredential({ store: secretStore, token: "sm_default", makeDefault: true, eligibleAliases: [] });
    const cases = [
      { path: "https-clone-a", remote: "https://github.com/acme/widgets.git", expected: "sm_project_v1_acme_widgets" },
      { path: "https-clone-b", remote: "https://github.com/acme/widgets.git", expected: "sm_project_v1_acme_widgets" },
      { path: "scp-clone", remote: "git@github.com:acme/widgets.git", expected: "sm_project_v1_acme_widgets" },
      { path: "ssh-clone", remote: "ssh://git@github.com/acme/widgets.git", expected: "sm_project_v1_acme_widgets" },
      { path: "other-owner", remote: "https://github.com/other/widgets.git", expected: "sm_project_v1_other_widgets" },
    ] as const;
    try {
      for (const entry of cases) {
        const projectRoot = join(root, entry.path);
        await mkdir(projectRoot, { recursive: true });
        initGitRemote(projectRoot, entry.remote);
        let childEnv: Record<string, string> = {};
        const result = await runRunnerLaunch({
          adapter: adapter({ runnerId: "opencode", displayName: "OpenCode", buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }) }),
          launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } } },
          interactive: false,
          yes: true,
          presentPreview: async () => {},
          supermemoryRuntime: { secretStore },
          opencodeSupermemoryLaunchEffects: readyOpenCodeSupermemoryLaunchEffects,
          processEffects: {
            inheritedEnv: { SUPERMEMORY_REPO_TAG: "sm_inherited_wrong", OPENCODE_DECK_INVOCATION_AUTHORIZATION: "invocation-required" },
            spawn: async (_command, _args, options) => { childEnv = options.env; return { exitCode: 0, stdout: "", stderr: "" }; },
          },
        });
        expect(result.status).toBe("launched");
        expect(childEnv.SUPERMEMORY_REPO_TAG).toBe(entry.expected);
        expect(childEnv.OPENCODE_DECK_INVOCATION_AUTHORIZATION).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("OpenCode omits inherited canonical tags for non-Git and no-origin projects and lets the official plugin use its native fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-opencode-native-tag-fallback-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: join(root, "config") });
    storeOpenCodeSupermemoryCredential({ store: secretStore, token: "sm_default", makeDefault: true, eligibleAliases: [] });
    try {
      for (const kind of ["non-git", "no-origin"] as const) {
        const projectRoot = join(root, kind);
        await mkdir(projectRoot, { recursive: true });
        if (kind === "no-origin") execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
        let childEnv: Record<string, string> = {};
        const result = await runRunnerLaunch({
          adapter: adapter({ runnerId: "opencode", displayName: "OpenCode", buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }) }),
          launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } } },
          interactive: false,
          yes: true,
          presentPreview: async () => {},
          supermemoryRuntime: { secretStore },
          opencodeSupermemoryLaunchEffects: readyOpenCodeSupermemoryLaunchEffects,
          processEffects: {
            inheritedEnv: { SUPERMEMORY_REPO_TAG: "sm_inherited_wrong", OPENCODE_DECK_INVOCATION_AUTHORIZATION: "invocation-required" },
            spawn: async (_command, _args, options) => { childEnv = options.env; return { exitCode: 0, stdout: "", stderr: "" }; },
          },
        });
        expect(result.status).toBe("launched");
        expect(childEnv.SUPERMEMORY_API_KEY).toBe("sm_default");
        expect(childEnv.SUPERMEMORY_REPO_TAG).toBeUndefined();
        expect(childEnv.OPENCODE_DECK_INVOCATION_AUTHORIZATION).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("OpenCode blocks before spawn when no alias token and no explicit default exist", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-opencode-profile-block-"));
    const configHome = await mkdtemp(join(tmpdir(), "deck-opencode-profile-empty-"));
    const secretStore = createOwnerOnlyFileSecretStore({ configHome });
    initGitRemote(projectRoot, "https://github.com/org/repo.git");
    let spawned = false;
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ runnerId: "opencode", displayName: "OpenCode", buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } } },
        interactive: false,
        yes: true,
        presentPreview: async () => {},
        supermemoryRuntime: { secretStore },
        opencodeSupermemoryLaunchEffects: readyOpenCodeSupermemoryLaunchEffects,
        processEffects: { spawn: async () => {
          spawned = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
      });

      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("no explicit default credential") });
      expect(spawned).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
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

  test("dry-run and install-only create no Supermemory host, bridge, session persistence, or child process", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-no-effect-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    const events: string[] = [];
    const launchInput = { projectRoot, teamId: "developer-team", mode: "exec" as const, prompt: ["do not start memory"], stdin: "closed" as const, stdinPayload: { type: "utf8" as const, content: "do not start memory" }, deckConfig: cfg };
    const fakeAdapter = adapter({
      buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
      buildLaunchPlan: () => { events.push("launch-plan"); return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }; },
      applyDeveloperTeamInstall: async () => { events.push("apply"); return { results: [], changedCount: 0, unchangedCount: 0 }; },
    });
    const supermemoryRuntime = { stateHome: join(projectRoot, ".state"), transport: {
      async add() { events.push("add"); },
      async search() { events.push("search"); return { results: [] }; },
      async profile() { events.push("profile"); return { profile: {} }; },
      async health() { events.push("health"); return { ok: true }; },
    } };
    try {
      const dryRun = await runRunnerLaunch({
        adapter: fakeAdapter,
        launch: launchInput,
        dryRun: true,
        interactive: false,
        presentPreview: async () => { events.push("preview:dry-run"); },
        processEffects: { spawn: async () => { events.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        supermemoryRuntime,
      });
      const installOnly = await runRunnerLaunch({
        adapter: fakeAdapter,
        launch: launchInput,
        installOnly: true,
        yes: true,
        interactive: false,
        presentPreview: async () => { events.push("preview:install-only"); },
        processEffects: { spawn: async () => { events.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        supermemoryRuntime,
      });

      expect(dryRun.status).toBe("dry-run");
      expect(installOnly.status).toBe("installed");
      expect(events).toEqual(["launch-plan", "preview:dry-run", "preview:install-only", "apply"]);
      expect(existsSync(join(projectRoot, ".state", "deck", "supermemory-sessions.json"))).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("managed lifecycle observability records metadata-only start, identity, recall, capture, and cleanup", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-observe-"));
    initGitRemote(projectRoot);
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }),
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Decision: managed lifecycle observability records metadata only."], stdin: "closed", stdinPayload: { type: "utf8", content: "Decision: managed lifecycle observability records metadata only." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          const endpoint = options.env.DECK_RUNNER_MEMORY_ENDPOINT!;
          const token = options.env.DECK_RUNNER_MEMORY_TOKEN!;
          const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
          await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "observe-session", timestamp: Date.now(), event: "session_start", sessionId: "native-session", role: "lead", query: "Decision: managed lifecycle observability records metadata only." }) });
          await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "observe-capture", timestamp: Date.now(), event: "capture", sessionId: "native-session", source: "trusted-user-prompt", content: "Decision: managed lifecycle observability records metadata only." }) });
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://test", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: {
          async add() {},
          async search() { return { results: [{ content: "metadata-only context" }] }; },
          async profile() { return { profile: { static: ["metadata-only profile"] } }; },
          async health() { return { ok: true }; },
        } },
      });
      expect(result.status).toBe("launched");
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_lifecycle", reason: "identity-resolved", status: "succeeded" }));
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_lifecycle", reason: "runtime-started", status: "succeeded" }));
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_recall", status: "attempted" }));
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_recall", status: "succeeded" }));
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "capture", status: "succeeded" }));
      expect(metrics.filter((metric) => metric.operation === "runtime_lifecycle" && metric.reason === "normal")).toHaveLength(1);
      const serialized = JSON.stringify(metrics);
      expect(serialized).not.toContain("sm_project_v1_");
      expect(serialized).not.toContain("native-session");
      expect(serialized).not.toContain("managed lifecycle observability");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("managed bridge cleanup is exactly once for signal outcomes and spawn failures", async () => {
    for (const mode of ["signal", "spawn-failure"] as const) {
      const projectRoot = await mkdtemp(join(tmpdir(), `deck-runtime-cleanup-${mode}-`));
      initGitRemote(projectRoot);
      const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
      const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
      try {
        const result = await runRunnerLaunch({
          adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
          launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Important limitation: cleanup once."], stdin: "closed", stdinPayload: { type: "utf8", content: "Important limitation: cleanup once." }, deckConfig: cfg },
          yes: true,
          interactive: false,
          presentPreview: async () => {},
          processEffects: { spawn: async () => {
            if (mode === "spawn-failure") throw new Error("ENOENT");
            return { exitCode: 1, signal: "SIGTERM", stdout: "", stderr: "" };
          } },
          supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://cleanup", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: { add: async () => {}, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
        });
        if (mode === "signal") expect(result).toMatchObject({ status: "launched", outcome: { signal: "SIGTERM" } });
        else expect(result).toMatchObject({ status: "blocked", message: "Runner spawn failed: ENOENT" });
        expect(metrics.filter((metric) => metric.operation === "runtime_lifecycle" && metric.reason === (mode === "signal" ? "signal" : "spawn-failed"))).toHaveLength(1);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    }
  });

  test("managed bridge cleanup failure is reported with close cause diagnostics", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-cleanup-failed-"));
    initGitRemote(projectRoot);
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Important limitation: cleanup failure evidence."], stdin: "closed", stdinPayload: { type: "utf8", content: "Important limitation: cleanup failure evidence." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          const endpoint = options.env.DECK_RUNNER_MEMORY_ENDPOINT!;
          const token = options.env.DECK_RUNNER_MEMORY_TOKEN!;
          void fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "cleanup-hangs", timestamp: Date.now(), event: "session_start", sessionId: "native-cleanup", role: "lead", query: "cleanup failure evidence" }) }).catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: join(projectRoot, "secret"), limitation: "test" }) }, observabilitySink: { path: "memory://cleanup-failed", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: { add: async () => {}, search: async () => new Promise(() => undefined), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      expect(result.status === "launched" ? result.launch.diagnostics : []).toContainEqual(expect.objectContaining({ code: "supermemory-runtime-cleanup-failed" }));
      expect(managedReadinessMessages(result)).toEqual(["Session topology: deck-managed; static=ready; managed=degraded; adaptive-memory=degraded; reason=supermemory-cleanup-degraded."]);
      expect(JSON.stringify(result)).not.toContain("deck-managed-ready");
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_lifecycle", status: "failed", reason: "normal:cleanup-failed" }));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("managed readiness reads the effective Deck secret store instead of trusting store objects", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-secret-read-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    let preview = "";
    const reads: string[] = [];
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Check readiness."], stdin: "closed", stdinPayload: { type: "utf8", content: "Check readiness." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async (value) => { preview = value; },
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: (name) => { reads.push(name); return undefined; }, write: () => ({ backend: "owner-only-file", path: "/tmp/test", limitation: "test" }) }, transport: { add: async () => {}, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      expect(reads).toEqual(["supermemory-api-key", "supermemory-api-key"]);
      expect(preview).toContain("reason=managed-runtime-auth-missing");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("managed readiness uses the canonical Deck secret store when no runtime store is injected", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-default-secret-"));
    const configHome = await mkdtemp(join(tmpdir(), "deck-runtime-default-secret-home-"));
    initGitRemote(projectRoot);
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const previousHome = process.env.HOME;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.HOME = join(configHome, "home");
    createOwnerOnlyFileSecretStore({ configHome }).write("supermemory-api-key", TOKEN_SENTINEL);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    let preview = "";
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Check canonical readiness."], stdin: "closed", stdinPayload: { type: "utf8", content: "Check canonical readiness." }, deckConfig: cfg },
        dryRun: true,
        yes: true,
        interactive: false,
        presentPreview: async (value) => { preview = value; },
        processEffects: { spawn: async () => { throw new Error("dry-run must not spawn"); } },
      });
      expect(result.status).toBe("dry-run");
      expect(preview).toContain("reason=deck-managed-ready");
      expect(preview).not.toContain(TOKEN_SENTINEL);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previousXdg;
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
      await rm(projectRoot, { recursive: true, force: true });
      await rm(configHome, { recursive: true, force: true });
    }
  });

  test("non-spawn launch exceptions preserve generic wording and cleanup cause", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-exception-"));
    initGitRemote(projectRoot);
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    let buildCalls = 0;
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: () => {
            buildCalls += 1;
            if (buildCalls > 1) throw new Error("adapter composition exploded");
            return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] };
          },
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Handle exception."], stdin: "closed", stdinPayload: { type: "utf8", content: "Handle exception." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => { throw new Error("must not spawn"); } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://exception", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: { add: async () => {}, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result).toMatchObject({ status: "blocked", message: "Runner launch failed: adapter composition exploded" });
      expect(result.status === "blocked" ? result.message : "").not.toContain("spawn failed");
      expect(metrics.filter((metric) => metric.operation === "runtime_lifecycle" && metric.reason === "exception")).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("observability sink exceptions during cleanup fail open and preserve launched result", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-observe-throw-"));
    initGitRemote(projectRoot);
    const observed: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Observe cleanup throw."], stdin: "closed", stdinPayload: { type: "utf8", content: "Observe cleanup throw." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          const endpoint = options.env.DECK_RUNNER_MEMORY_ENDPOINT!;
          const token = options.env.DECK_RUNNER_MEMORY_TOKEN!;
          await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "observe-throw-session", timestamp: Date.now(), event: "session_start", sessionId: "native-observe", role: "lead", query: "observe cleanup throw" }) });
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://throw", healthy: true, diagnostics: [], observe: (metric) => { observed.push(metric); if (metric.operation === "runtime_lifecycle" && metric.reason === "normal") throw new Error(`${TOKEN_SENTINEL} sink failed`); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: { add: async () => {}, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      const diagnostics = result.status === "launched" ? result.launch.diagnostics : [];
      expect(diagnostics).toContainEqual(expect.objectContaining({ code: "supermemory-runtime-observability-degraded" }));
      expect(JSON.stringify(diagnostics)).not.toContain(TOKEN_SENTINEL);
      expect(observed.filter((metric) => metric.operation === "runtime_lifecycle" && metric.reason === "normal")).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("healthy managed launch returns exactly one final ready readiness record", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-final-ready-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Decision: healthy final ready."], stdin: "closed", stdinPayload: { type: "utf8", content: "Decision: healthy final ready." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          await fetch(options.env.DECK_RUNNER_MEMORY_ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${options.env.DECK_RUNNER_MEMORY_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "healthy-capture", timestamp: Date.now(), event: "capture", sessionId: "native-healthy", source: "trusted-user-prompt", content: "Decision: healthy final ready." }) });
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: join(projectRoot, "secret"), limitation: "test" }) }, transport: { add: async () => ({ id: "capture" }), search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      expect(managedReadinessMessages(result)).toEqual(["Session topology: deck-managed; static=ready; managed=ready; adaptive-memory=ready; reason=deck-managed-ready."]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("health failure final readiness is not ready and disabled runtime exposes no bridge", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-health-failed-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    let childMemoryKeys: string[] = [];
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Health failure proof."], stdin: "closed", stdinPayload: { type: "utf8", content: "Health failure proof." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { inheritedEnv: {
          PATH: "/bin",
          DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:9999/stale-parent-memory",
          DECK_RUNNER_MEMORY_TOKEN: "stale-parent-memory-token",
          DECK_RUNNER_MEMORY_SCOPE: "stale-parent-memory-scope",
          DECK_CODEX_BRIDGE_ENDPOINT: "http://127.0.0.1:9999/stale-parent-codex",
          DECK_CODEX_BRIDGE_TOKEN: "stale-parent-codex-token",
          DECK_CODEX_BRIDGE_MODE: "stale-parent-codex-mode",
        }, spawn: async (_command, _args, options) => {
          childMemoryKeys = Object.keys(options.env).filter((key) => /DECK_RUNNER_MEMORY/i.test(key));
          expect(Object.keys(options.env).filter((key) => /DECK_CODEX_BRIDGE/.test(key))).toEqual([]);
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: join(projectRoot, "secret"), limitation: "test" }) }, transport: { add: async () => {}, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => { throw new Error("credential rejected"); } } },
      });
      expect(result.status).toBe("launched");
      const diagnostics = result.status === "launched" ? result.launch.diagnostics : [];
      expect(managedReadinessMessages(result)).toHaveLength(1);
      expect(diagnostics).toContainEqual(expect.objectContaining({ code: "managed-session-readiness", message: expect.stringContaining("reason=supermemory-provider-api-failed") }));
      expect(managedReadinessMessages(result).join(" ")).not.toContain("managed=ready; adaptive-memory=ready");
      expect(childMemoryKeys).toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("observability startup failure final readiness is degraded, not ready", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-observe-start-failed-"));
    initGitRemote(projectRoot);
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Observability degraded proof."], stdin: "closed", stdinPayload: { type: "utf8", content: "Observability degraded proof." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: join(projectRoot, "secret"), limitation: "test" }) }, observabilitySink: { path: "memory://observe-start", healthy: false, diagnostics: ["sink unavailable"], observe: () => {}, health: () => ({ healthy: false, diagnostics: ["sink unavailable"] }) }, transport: { add: async () => {}, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      const diagnostics = result.status === "launched" ? result.launch.diagnostics : [];
      expect(managedReadinessMessages(result)).toHaveLength(1);
      expect(diagnostics).toContainEqual(expect.objectContaining({ code: "managed-session-readiness", message: expect.stringContaining("reason=supermemory-observability-degraded") }));
      expect(managedReadinessMessages(result).join(" ")).not.toContain("managed=ready; adaptive-memory=ready");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("loopback bridge startup failure returns one degraded final readiness record", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-bridge-failed-"));
    initGitRemote(projectRoot);
    const originalServe = Bun.serve;
    (Bun as unknown as { serve: typeof Bun.serve }).serve = (() => { throw new Error("loopback bind failed"); }) as typeof Bun.serve;
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Bridge failure proof."], stdin: "closed", stdinPayload: { type: "utf8", content: "Bridge failure proof." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { inheritedEnv: {
          PATH: "/bin",
          DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:9999/stale-parent-memory",
          DECK_RUNNER_MEMORY_TOKEN: "stale-parent-memory-token",
          DECK_RUNNER_MEMORY_SCOPE: "stale-parent-memory-scope",
          DECK_CODEX_BRIDGE_ENDPOINT: "http://127.0.0.1:9999/stale-parent-codex",
          DECK_CODEX_BRIDGE_TOKEN: "stale-parent-codex-token",
          DECK_CODEX_BRIDGE_MODE: "stale-parent-codex-mode",
        }, spawn: async (_command, _args, options) => {
          expect(Object.keys(options.env).filter((key) => /DECK_RUNNER_MEMORY/.test(key))).toEqual([]);
          expect(Object.keys(options.env).filter((key) => /DECK_CODEX_BRIDGE/.test(key))).toEqual([]);
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: join(projectRoot, "secret"), limitation: "test" }) }, transport: { add: async () => ({ id: "capture" }), search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result.status).toBe("launched");
      expect(managedReadinessMessages(result)).toEqual(["Session topology: deck-managed; static=ready; managed=degraded; adaptive-memory=degraded; reason=supermemory-loopback-degraded."]);
      expect(JSON.stringify(result)).not.toContain("deck-managed-ready");
    } finally {
      (Bun as unknown as { serve: typeof Bun.serve }).serve = originalServe;
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("eligible runtime recall completes before agent task processing with injected inert context and MCP count zero", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-order-"));
    initGitRemote(projectRoot, "https://github.com/acme/order-proof.git");
    const events: string[] = [];
    const calls: string[] = [];
    const exposedRunnerKeys: string[] = [];
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
          exposedRunnerKeys.push(...Object.keys(options.env).filter((key) => /DECK_RUNNER_MEMORY|SUPERMEMORY|SM_PROJECT|X_SM_PROJECT|MCP/i.test(key)));
          const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
          const recalled = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "fake", eventId: "order-session-start", timestamp: Date.now(), event: "session_start", sessionId: "native-order", role: "lead", query: "Implement order proof" }) }).then((response) => response.json());
          events.push(`recall:${String((recalled as { advisoryText?: unknown }).advisoryText).includes("DECK_ADAPTIVE_CONTEXT_JSON_V1")}`);
          events.push("agent-task-processing");
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
      expect(exposedRunnerKeys.sort()).toEqual(["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN"]);
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
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
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
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://explicit-recall-blocked", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: { add: async () => {}, search: async () => { throw new Error("provider unavailable"); }, profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("reason=transport_error") });
      expect(JSON.stringify(result)).not.toContain("provider unavailable");
      expect(calls).toEqual(["launch-plan"]);
      expect(metrics.filter((metric) => metric.operation === "runtime_lifecycle" && metric.reason === "blocked")).toHaveLength(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("successful explicit recall injects advisory context and records metadata-only recall observability", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-explicit-recall-ok-"));
    initGitRemote(projectRoot);
    const launchPrompts: string[] = [];
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: (launch) => {
            launchPrompts.push(launch.mode === "exec" ? launch.prompt.join("\n") : "interactive");
            return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed", stdinPayload: launch.mode === "exec" ? launch.stdinPayload : undefined }, diagnostics: [] };
          },
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["What did we do so far?"], stdin: "closed", stdinPayload: { type: "utf8", content: "What did we do so far?" }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          expect(options.stdinPayload?.content).toContain("DECK_ADAPTIVE_CONTEXT_JSON_V1");
          expect(options.stdinPayload?.content).toContain("Earlier work summary.");
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://explicit-recall", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: {
          add: async () => {},
          search: async () => ({ results: [{ id: "prior", content: "Earlier work summary." }] }),
          profile: async () => ({ profile: { static: ["Profile summary."] } }),
          health: async () => ({ ok: true }),
        } },
      });
      expect(result.status).toBe("launched");
      expect(launchPrompts).toHaveLength(2);
      expect(launchPrompts[1]).toContain("DECK_ADAPTIVE_CONTEXT_JSON_V1");
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_recall", dependency: "explicit-recall", status: "succeeded" }));
      expect(JSON.stringify(metrics)).not.toContain("Earlier work summary");
      expect(JSON.stringify(metrics)).not.toContain("sm_project_v1_");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("successful empty explicit recall blocks before spawn with safe no-match diagnostic", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-runtime-explicit-recall-empty-"));
    initGitRemote(projectRoot, "https://github.com/acme/empty-explicit-launch.git");
    const calls: string[] = [];
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          buildLaunchPlan: () => { calls.push("launch-plan"); return { status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }; },
        }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["What did we decide about absent matches?"], stdin: "closed", stdinPayload: { type: "utf8", content: "What did we decide about absent matches?" }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => { calls.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), observabilitySink: { path: "memory://explicit-recall-empty", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: {
          add: async () => {},
          search: async () => ({ results: [] }),
          profile: async () => ({ profile: { static: [], dynamic: [] } }),
          health: async () => ({ ok: true }),
        } },
      });
      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("No project-scoped adaptive memory matched the explicit recall query.") });
      expect(calls).toEqual(["launch-plan"]);
      expect(metrics).toContainEqual(expect.objectContaining({ operation: "runtime_recall", dependency: "explicit-recall", status: "succeeded", resultCount: 0, approximateInjectedTokens: 0 }));
      expect(JSON.stringify(metrics)).not.toContain("What did we decide");
      expect(JSON.stringify(metrics)).not.toContain("sm_project_v1_");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("explicit remember captures once without persisting correlation id and skips duplicate prompt capture", async () => {
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
      expect(adds[0]).toMatchObject({ metadata: { role: "user", source: "explicit-remember", dependency: "explicit-remember" } });
      expect(adds[0].metadata).not.toHaveProperty("correlationId");
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
    const metrics: Array<import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric> = [];
    try {
      const result = await runRunnerLaunch({
        adapter: adapter({ buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }), buildLaunchPlan: () => ({ status: "ready", plan: { command: "fake", args: [], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] }) }),
        launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["Remember that this explicit write must fail before launch."], stdin: "closed", stdinPayload: { type: "utf8", content: "Remember that this explicit write must fail before launch." }, deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async () => { calls.push("spawn"); return { exitCode: 0, stdout: "", stderr: "" }; } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), secretStore: { read: () => TOKEN_SENTINEL, write: () => ({ backend: "owner-only-file", path: join(projectRoot, "secret"), limitation: "test" }) }, observabilitySink: { path: "memory://explicit-remember-blocked", healthy: true, diagnostics: [], observe: (metric) => { metrics.push(metric); }, health: () => ({ healthy: true, diagnostics: [] }) }, transport: { add: async () => { throw new Error("write unavailable"); }, search: async () => ({ results: [] }), profile: async () => ({ profile: {} }), health: async () => ({ ok: true }) } },
      });
      expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining("reason=transport_error") });
      expect(JSON.stringify(result)).not.toContain("write unavailable");
      expect(calls).toEqual([]);
      expect(managedReadinessMessages(result)).toEqual(["Session topology: deck-managed; static=ready; managed=degraded; adaptive-memory=degraded; reason=supermemory-capture-degraded."]);
      expect(metrics.filter((metric) => metric.operation === "runtime_lifecycle" && metric.reason === "blocked")).toHaveLength(1);
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
      verbose: true,
      presentPreview: async (preview) => { events.push(`preview:${preview}`); },
      processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    });
    expect(result.status).toBe("blocked");
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("create managed pre=absent post=abc owner=deck-file");
    expect(events).not.toContain("apply");
  });

  test("a normal launch prints a short product-level summary while details stay behind --verbose and --dry-run", async () => {
    const noisy = adapter({
      buildDeveloperTeamInstallPlan: () => ({
        files: [],
        mutationPreview: [
          { action: "create", path: "/home/u/.codex/agents/deck-lead.toml", preimage: "absent", postimage: "abc", ownership: "deck-file:x" },
          { action: "create", path: "/home/u/.agents/skills/deck-lead/SKILL.md", preimage: "absent", postimage: "def", ownership: "deck-file:y" },
          { action: "update", path: "/home/u/.codex/config.toml", preimage: "p", postimage: "q", ownership: "toml-key:z" },
        ],
        diagnostics: ["race caveat", "skipped duplicate", "real problem"],
        diagnosticEntries: [
          { code: "node-path-cas-residual-risk", severity: "warning", message: "race caveat" },
          { code: "mcp-foreign-duplicate", severity: "info", message: "skipped duplicate" },
          { code: "web-search-credential-missing", severity: "warning", message: "real problem" },
        ],
      }),
      buildLaunchPlan: () => ({
        status: "ready",
        plan: { command: "fake", args: [], cwd: "/p", stdio: "inherit", stdin: "inherit", executionClass: "static-compatible" },
        diagnostics: [
          { code: "codex-dangerous-bypass", severity: "warning", message: "Heads up: sandboxing and command approvals are disabled" },
          { code: "codex-static-compatible", severity: "warning", message: "not bridge-enforced" },
        ],
      }),
    });
    const run = async (extra: { verbose?: boolean; dryRun?: boolean }) => {
      const shown: string[] = [];
      await runRunnerLaunch({
        adapter: noisy,
        launch: withDeckConfig({ projectRoot: "/p", teamId: "developer-team", mode: "interactive" }),
        interactive: false,
        yes: true,
        supermemoryRuntime: { transport: {} as never, stateHome: "/nonexistent/deck-state-unused" },
        presentPreview: async (preview) => { shown.push(preview); },
        processEffects: { spawn: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
        verbose: extra.verbose,
        dryRun: extra.dryRun,
      });
      return shown.join("\n");
    };
    const normal = await run({});
    expect(normal).toContain("Updating Fake team files: 1 agent, 1 skill, configuration (MCP servers, hooks).");
    expect(normal).toContain("! real problem");
    expect(normal).toContain("! Heads up: sandboxing and command approvals are disabled");
    for (const hidden of ["race caveat", "skipped duplicate", "not bridge-enforced", "pre=absent", "owner=", "[codex-"]) expect(normal).not.toContain(hidden);
    expect(normal.split("\n").length).toBeLessThanOrEqual(5);
    for (const detailed of [await run({ verbose: true }), await run({ dryRun: true })]) {
      expect(detailed).toContain("race caveat");
      expect(detailed).toContain("skipped duplicate");
      expect(detailed).toContain("owner=deck-file:x");
    }
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

  for (const origin of [undefined, "unverifiable-local-origin"]) {
    test(`Codex launches without memory when repository identity is unavailable (${origin ?? "no origin"})`, async () => {
      const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-no-identity-"));
      const config = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
      const previews: string[] = [];
      let spawns = 0;
      try {
        if (origin) initGitRemote(projectRoot, origin);
        const result = await runRunnerLaunch({
          adapter: adapter({
            runnerId: "codex",
            readModelAssignments: () => ({}),
            readThinkingAssignments: () => ({}),
            buildDeveloperTeamInstallPlan: (input) => {
              expect(input.materializationScope).toBe("content-only");
              expect(input.deckConfig?.adaptiveMemory.enabled).toBe(true);
              return { files: [], mutationPreview: [] };
            },
            buildLaunchPlan: (input) => {
              expect(input.deckConfig?.adaptiveMemory.enabled).toBe(false);
              return { status: "ready", plan: { command: "codex", args: ["exec", "-"], cwd: projectRoot, stdio: "pipe", stdin: "closed" }, diagnostics: [] };
            },
          }),
          launch: { projectRoot, teamId: "developer-team", mode: "exec", prompt: ["implement feature"], stdin: "closed", deckConfig: config },
          yes: true,
          interactive: false,
          presentPreview: async (preview) => { previews.push(preview); },
          codexSupermemoryCredential: () => { throw new Error("must not resolve credentials without identity"); },
          supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: {
            add: async () => { throw new Error("no provider add allowed"); },
            search: async () => { throw new Error("no provider search allowed"); },
            profile: async () => { throw new Error("no provider profile allowed"); },
            health: async () => { throw new Error("no provider health allowed"); },
          } },
          processEffects: { inheritedEnv: { SUPERMEMORY_API_KEY: TOKEN_SENTINEL, SUPERMEMORY_REPO_TAG: "foreign", DECK_RUNNER_MEMORY_TOKEN: TOKEN_SENTINEL }, spawn: async (_command, args, options) => {
            spawns += 1;
            expect(args.join(" ")).toContain("features.hooks=false");
            expect(Object.keys(options.env).filter((key) => /SUPERMEMORY|DECK_RUNNER_MEMORY/.test(key))).toEqual([]);
            return { exitCode: 0, stdout: "", stderr: "" };
          } },
        });
        expect(result.status).toBe("launched");
        expect(spawns).toBe(1);
        expect(previews.join("\n")).toContain("Supermemory is disabled for this launch");
        expect(config.adaptiveMemory.enabled).toBe(true);
      } finally { await rm(projectRoot, { recursive: true, force: true }); }
    });
  }

  test("Codex with verified identity retains memory credential failures instead of falling back", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "deck-codex-verified-identity-"));
    try {
      initGitRemote(projectRoot, "https://github.com/acme/verified.git");
      let spawned = false;
      const result = await runRunnerLaunch({
        adapter: adapter({ runnerId: "codex", readModelAssignments: () => ({}), readThinkingAssignments: () => ({}), buildDeveloperTeamInstallPlan: (input) => {
          expect(input.materializationScope).toBeUndefined();
          expect(input.deckConfig?.adaptiveMemory.enabled).toBe(true);
          return { files: [], mutationPreview: [] };
        } }),
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } } },
        yes: true, interactive: false, presentPreview: async () => {},
        codexSupermemoryCredential: () => { throw new Error("Protected shared profile store is invalid."); },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport: {
          add: async () => { throw new Error("no provider add allowed"); },
          search: async () => { throw new Error("no provider search allowed"); },
          profile: async () => { throw new Error("no provider profile allowed"); },
          health: async () => { throw new Error("no provider health allowed"); },
        } },
        processEffects: { spawn: async () => { spawned = true; return { exitCode: 0, stdout: "", stderr: "" }; } },
      });
      expect(result).toMatchObject({ status: "blocked", message: "Protected shared profile store is invalid." });
      expect(spawned).toBe(false);
    } finally { await rm(projectRoot, { recursive: true, force: true }); }
  });

  test("real Codex fallback preserves installed hooks and MCP config without memory provider effects", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-codex-memory-fallback-"));
    const projectRoot = join(root, "project");
    const home = join(root, "home");
    const roots = layout(home);
    const source = '[features]\nmulti_agent = true\n\n# deck-codex-hook:supermemory:start\n[[hooks.Stop]]\nhooks = [{ type = "command", command = "node supermemory-flush.js" }]\n# deck-codex-hook:supermemory:end\n\n[mcp_servers.user]\ncommand = "user-server"\n';
    try {
      await mkdir(projectRoot, { recursive: true });
      await mkdir(roots.codexHome, { recursive: true });
      await writeFile(join(roots.codexHome, "config.toml"), source);
      const runner = createCodexRunnerAdapter({ ...roots, tools: testTools(), journalRoot: join(root, "journals"), preflight: {
        probe: async () => ({ found: true, version: "0.160.0", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
        readProject: async () => ({ config: null, roles: [], skills: [], agentsInstructions: false }),
      } });
      let spawned = false;
      const result = await runRunnerLaunch({
        adapter: runner,
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } } },
        yes: true, interactive: false, presentPreview: async () => {},
        codexSupermemoryCredential: () => { throw new Error("no memory credential effect allowed"); },
        supermemoryRuntime: { stateHome: join(root, "state"), secretStore: { read: () => { throw new Error("no memory store effect allowed"); }, write: () => { throw new Error("no memory write allowed"); } }, transport: { add: async () => { throw new Error("no provider add"); }, search: async () => { throw new Error("no provider search"); }, profile: async () => { throw new Error("no provider profile"); }, health: async () => { throw new Error("no provider health"); } } },
        processEffects: { inheritedEnv: { SUPERMEMORY_API_KEY: TOKEN_SENTINEL, SUPERMEMORY_REPO_TAG: "ambient" }, spawn: async (_command, args, options) => {
          spawned = true;
          expect(args.join(" ")).toContain("features.hooks=false");
          expect(options.env.SUPERMEMORY_API_KEY).toBeUndefined();
          expect(options.env.SUPERMEMORY_REPO_TAG).toBeUndefined();
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
      });
      expect(result.status).toBe("launched");
      expect(spawned).toBe(true);
      expect(await readFile(join(roots.codexHome, "config.toml"), "utf8")).toBe(source);
      expect(existsSync(join(root, "state"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 120000);

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

  test("real OpenCode managed launch activates only the pinned official plugin and never calls Deck memory transport", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-opencode-official-memory-"));
    const projectRoot = join(root, "project");
    const configDir = join(root, "opencode-home");
    const secretStore = createOwnerOnlyFileSecretStore({ configHome: join(root, "config") });
    await mkdir(projectRoot, { recursive: true });
    initGitRemote(projectRoot);
    storeOpenCodeSupermemoryCredential({ store: secretStore, token: TOKEN_SENTINEL, makeDefault: true, eligibleAliases: [] });
    const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: configDir });
    const cfg = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const, supermemory: { mcpServerName: "supermemory" } } };
    const transportCalls: string[] = [];
    let childEnv: Record<string, string> = {};
    try {
      const result = await runRunnerLaunch({
        adapter,
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig: cfg },
        yes: true,
        interactive: false,
        presentPreview: async () => {},
        processEffects: { spawn: async (_command, _args, options) => {
          childEnv = options.env;
          return { exitCode: 0, stdout: "", stderr: "" };
        } },
        supermemoryRuntime: {
          secretStore,
          transport: {
            health: async () => { transportCalls.push("health"); return { ok: true }; },
            profile: async () => { transportCalls.push("profile"); return { profile: { static: [] } }; },
            search: async () => { transportCalls.push("search"); return { results: [] }; },
            add: async () => { transportCalls.push("add"); return { id: "capture" }; },
          },
        },
        opencodeSupermemoryLaunchEffects: readyOpenCodeSupermemoryLaunchEffects,
      });
      expect(result.status).toBe("launched");
      expect(childEnv.SUPERMEMORY_API_KEY).toBe(TOKEN_SENTINEL);
      expect(childEnv.SUPERMEMORY_REPO_TAG).toBe("sm_project_v1_kevin15011_deck");
      expect(childEnv.OPENCODE_DECK_INVOCATION_AUTHORIZATION).toBeUndefined();
      expect(JSON.parse(childEnv.OPENCODE_CONFIG_CONTENT ?? "{}").plugin).toEqual([TEST_SUPERMEMORY_LOADER_LOCATOR]);
      expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_ENDPOINT");
      expect(childEnv).not.toHaveProperty("DECK_RUNNER_MEMORY_TOKEN");
      expect(transportCalls).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(TOKEN_SENTINEL);
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
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
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
      const staticConfig = <T extends Omit<RunnerLaunchInput, "deckConfig">>(input: T) => {
        const cfg = getDefaultDeckConfig();
        cfg.packageInstructions.codex.serena = false;
        return { ...input, deckConfig: cfg };
      };
      const routes = [
        { launch: staticConfig({ projectRoot, teamId: "developer-team", mode: "interactive" as const }), newSession: true },
        { launch: staticConfig({ projectRoot, teamId: "developer-team", mode: "exec" as const, prompt: [], stdin: "closed" as const }), newSession: true },
        { launch: staticConfig({ projectRoot, teamId: "developer-team", mode: "resume-by-id" as const, sessionId: "session-1" }), args: ["--dangerously-bypass-approvals-and-sandbox", "-c", 'features.multi_agent_v2.multi_agent_mode_hint_text=""', "resume", "session-1"] },
        { launch: staticConfig({ projectRoot, teamId: "developer-team", mode: "resume-latest" as const }), args: ["--dangerously-bypass-approvals-and-sandbox", "-c", 'features.multi_agent_v2.multi_agent_mode_hint_text=""', "resume", "--last"] },
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
          processEffects: { inheritedEnv: {
            PATH: "/bin",
            DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:9999/stale-parent-memory",
            DECK_RUNNER_MEMORY_TOKEN: "stale-parent-memory-token",
            DECK_RUNNER_MEMORY_SCOPE: "stale-parent-memory-scope",
            DECK_CODEX_BRIDGE_ENDPOINT: "http://127.0.0.1:9999/stale-parent-codex",
            DECK_CODEX_BRIDGE_TOKEN: "stale-parent-codex-token",
            DECK_CODEX_BRIDGE_MODE: "stale-parent-codex-mode",
          }, spawn: async (_command, args, options) => {
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
            expect(Object.keys(options.env).filter((key) => /DECK_CODEX_BRIDGE/.test(key))).toEqual([]);
            expect(Object.keys(options.env).filter((key) => /DECK_RUNNER_MEMORY/.test(key))).toEqual([]);
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
          expect(result.launch.diagnostics).not.toContainEqual(expect.objectContaining({ code: "materialized-but-inactive" }));
        }
      }
      expect(await Bun.file(join(projectRoot, ".codex", "deck", "hooks", "developer-team-execution.js")).exists()).toBe(true);
      expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).toContain("deck-codex-hook:memory-bridge:start");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

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
      const adapter = createCodexRunnerAdapter({ tools: testTools(), ...layout(projectRoot),
        journalRoot: join(root, "journals"),
        preflight: {
          probe: async () => ({ found: true, version: "0.146.1", help: "Usage: codex [OPTIONS]", execHelp: "Usage: codex exec [OPTIONS]", resumeHelp: "Usage: codex resume [SESSION_ID] --last" }),
          inspectTrust: async () => "trusted",
          readProject: async (project) => ({ config: await readFile(join(project, ".codex", "config.toml"), "utf8").catch(() => null), roles: [], skills: [], agentsInstructions: false }),
        },
      });
      adapter.verifyDeveloperTeamInstall = () => ({ valid: false, diagnostics: ["forced semantic mismatch"] });
      const deckConfig = getDefaultDeckConfig();
      deckConfig.packageInstructions.codex.serena = false;
      const result = await runRunnerLaunch({
        adapter,
        launch: { projectRoot, teamId: "developer-team", mode: "interactive", deckConfig },
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
  }, 120_000);

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
