import { CLAUDE_ATTRIBUTION_SETTINGS_ARGS } from "../../../packages/adapter-claude/src/launch-settings";
import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDefaultDeckConfig } from "@deck/core";
import { createDefaultAdapterRegistry } from "./runner-adapters";
import { executeRunnerLaunchPlan } from "./runner-launch-command";
import { writeTavilyCredentialToActiveShellProfile } from "./web-search-shell-profile";
import { createHash } from "node:crypto";

test("default Claude composition requires verified global plugin and passes only --plugin-dir to supervised interactive child", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-claude-team-launch-"));
  const dataRoot = join(root, "data", "deck");
  const project = join(root, "repo");
  try {
    await mkdir(project);
    const adapter = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot } }).get("claude");
    const deckConfig = getDefaultDeckConfig();
    const input = { projectRoot: project, teamId: "developer-team", deckConfig, mode: "interactive" as const };
    expect((await adapter.buildLaunchPlan!(input)).status).toBe("blocked");
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: project, environmentId: "claude-development", deckConfig });
    await adapter.applyDeveloperTeamInstall({ projectRoot: project, environmentId: "claude-development", plan });
    const ready = await adapter.buildLaunchPlan!(input);
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") return;
    expect(ready.plan.args).toEqual([...CLAUDE_ATTRIBUTION_SETTINGS_ARGS, "--plugin-dir", dirname(dirname(plan.files[0]!.path)), "--agent", "deck-developer-team:deck-lead"]);
    expect(ready.plan.args).not.toContain("--safe-mode");
    let called = false;
    const outcome = await executeRunnerLaunchPlan(ready.plan, { inheritedEnv: { PATH: "/usr/bin", SUPERMEMORY_CC_API_KEY: "fake-inherited", SUPERMEMORY_REPO_TAG: "wrong" }, spawn: async (command, args, options) => {
      called = true;
      expect(command).toBe("claude");
      expect(args).toEqual(ready.plan.args);
      expect(options.cwd).toBe(project);
      expect(options.env.SUPERMEMORY_CC_API_KEY).toBeUndefined();
      expect(options.env.SUPERMEMORY_REPO_TAG).toBeUndefined();
      return { exitCode: 0, stdout: "", stderr: "" };
    } });
    expect(called).toBe(true);
    expect(outcome.exitCode).toBe(0);
    expect((await adapter.buildLaunchPlan!({ ...input, deckConfig: { ...deckConfig, adaptiveMemory: { ...deckConfig.adaptiveMemory, enabled: true, activeProvider: "supermemory" } } })).status).toBe("blocked");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real CLI composition blocks the limited team launch without verified global files", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-claude-cli-no-plugin-"));
  try {
    await mkdir(join(root, "deck"));
    await writeFile(join(root, "deck", "config.json"), JSON.stringify(getDefaultDeckConfig()));
    const main = fileURLToPath(new URL("./main.tsx", import.meta.url));
    const outcome = spawnSync(process.execPath, [main, "claude", "developer"], { cwd: root, encoding: "utf8", env: { ...process.env, HOME: root, XDG_CONFIG_HOME: root, XDG_DATA_HOME: root, PATH: root } });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("Deck-owned global Claude plugin or model selection is missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude shared Tavily credential is child-only, redacted, and absent when Web Search is disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-claude-shared-tavily-"));
  const dataRoot = join(root, "data", "deck");
  const token = "fixture-tavily-process-secret";
  try {
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "tavily-mcp"), "fixture", { mode: 0o700 });
    const adapter = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot, resolveCommand: (name) => name === "tavily-mcp" ? join(bin, "tavily-mcp") : undefined, webSearchCredential: () => token } }).get("claude");
    const config = { ...getDefaultDeckConfig(), webSearch: { enabled: true, provider: "tavily" } } as ReturnType<typeof getDefaultDeckConfig>;
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "web-search"] });
    expect(plan.blocked).toBe(false);
    expect(JSON.stringify(plan.files)).not.toContain(token);
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan });
    const launch = await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: config });
    expect(launch.status).toBe("ready");
    if (launch.status !== "ready") return;
    const result = await executeRunnerLaunchPlan(launch.plan, { inheritedEnv: { PATH: bin, TAVILY_API_KEY: "inherited-wrong-token" }, spawn: async (_command, args, options) => {
      expect(args).toEqual(launch.plan.args);
      expect(options.env.TAVILY_API_KEY).toBe(token);
      return { exitCode: 0, stdout: "", stderr: token };
    } });
    expect(result.stderr).toBe("[REDACTED]");
    expect((await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() })).status).toBe("blocked");
    const disabled = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: getDefaultDeckConfig(), capabilityIds: ["claude-team-files"] });
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan: disabled });
    const noSearch = await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig() });
    expect(noSearch.status === "ready" && noSearch.plan.envOverlay).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude reuses the previously enrolled shell-profile Tavily key without another TUI prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "deck-claude-shared-profile-"));
  const before = { home: process.env.HOME, shell: process.env.SHELL, key: process.env.TAVILY_API_KEY };
  try {
    process.env.HOME = root;
    process.env.SHELL = "/bin/bash";
    delete process.env.TAVILY_API_KEY;
    const token = "fixture-once-only-tavily";
    expect(writeTavilyCredentialToActiveShellProfile(token, { home: root, shell: "/bin/bash" }).ok).toBe(true);
    const bin = join(root, "tavily-mcp");
    await writeFile(bin, "fixture", { mode: 0o700 });
    const adapter = createDefaultAdapterRegistry({ claude: { homeDir: root, dataRoot: join(root, "data", "deck"), resolveCommand: (name) => name === "tavily-mcp" ? bin : undefined } }).get("claude");
    const config = { ...getDefaultDeckConfig(), webSearch: { enabled: true, provider: "tavily" } } as ReturnType<typeof getDefaultDeckConfig>;
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: root, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "web-search"] });
    expect(plan.blocked).toBe(false);
    await adapter.applyDeveloperTeamInstall({ projectRoot: root, environmentId: "claude-development", plan });
    const launch = await adapter.buildLaunchPlan!({ projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: config });
    expect(launch.status === "ready" && launch.plan.envOverlay?.TAVILY_API_KEY?.value).toBe(token);
    expect(JSON.stringify(plan.files)).not.toContain(token);
  } finally {
    if (before.home === undefined) delete process.env.HOME; else process.env.HOME = before.home;
    if (before.shell === undefined) delete process.env.SHELL; else process.env.SHELL = before.shell;
    if (before.key === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = before.key;
    await rm(root, { recursive: true, force: true });
  }
});

test("official memory plus shared Web Search bind only selected secrets to the Claude child and redact effects", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-claude-dual-credentials-"));
  const published = Buffer.from('{"name":"supermemory"}\n');
  const manifest = [[".claude-plugin/plugin.json", createHash("sha256").update(published).digest("hex"), published.length]] as const;
  const memoryToken = "fixture-memory-selected-token";
  const searchToken = "fixture-tavily-selected-token";
  try {
    execFileSync("git", ["init", "-q"], { cwd: home });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo.git"], { cwd: home });
    const tavily = join(home, "tavily-mcp");
    await writeFile(tavily, "fixture", { mode: 0o700 });
    const adapter = createDefaultAdapterRegistry({ claude: {
      homeDir: home,
      dataRoot: join(home, "data", "deck"),
      officialPluginManifest: manifest,
      supermemoryArtifactEffects: { fetchFile: async () => published },
      resolveMemoryCredential: () => ({ token: memoryToken, profile: "default", canonicalRepoTag: "sm_project_v1_acme_repo" }),
      resolveCommand: (name) => name === "tavily-mcp" ? tavily : undefined,
      webSearchCredential: () => searchToken,
    } }).get("claude");
    const config = { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" as const }, webSearch: { enabled: true, provider: "tavily" } } as ReturnType<typeof getDefaultDeckConfig>;
    const official = await adapter.runAction({ id: "official", kind: "install-claude-supermemory", capabilityId: "adaptive-memory", title: "Official memory", status: "ready" }, { projectRoot: home, runnerId: "claude", environmentId: "claude-development" });
    expect(official.status).toBe("executed");
    const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "web-search"] });
    expect(plan.blocked).toBe(false);
    await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
    const launch = await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig: config });
    expect(launch.status).toBe("ready");
    if (launch.status !== "ready") return;
    expect(launch.plan.args.filter((value) => value === "--plugin-dir")).toHaveLength(2);
    expect(JSON.stringify({ args: launch.plan.args, diagnostics: launch.diagnostics, files: plan.files })).not.toContain(memoryToken);
    const result = await executeRunnerLaunchPlan(launch.plan, { inheritedEnv: { PATH: "/bin", SUPERMEMORY_CC_API_KEY: "wrong-inherited", SUPERMEMORY_REPO_TAG: "wrong-tag", TAVILY_API_KEY: "wrong-tavily" }, spawn: async (_command, _args, options) => {
      expect(options.env.SUPERMEMORY_CC_API_KEY).toBe(memoryToken);
      expect(options.env.SUPERMEMORY_REPO_TAG).toBe("sm_project_v1_acme_repo");
      expect(options.env.TAVILY_API_KEY).toBe(searchToken);
      return { exitCode: 0, stdout: memoryToken, stderr: searchToken };
    } });
    expect(result.stdout).toBe("[REDACTED]");
    expect(result.stderr).toBe("[REDACTED]");
  } finally { await rm(home, { recursive: true, force: true }); }
});
