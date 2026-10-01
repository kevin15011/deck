import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOwnerOnlyFileSecretStore, getDefaultDeckConfig } from "@deck/core";
import { resolveOpenCodeSupermemoryCredential, storeOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import { resolveClaudeSupermemoryLaunchCredential } from "./claude-supermemory-launch";
import { createClaudeRunnerAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { createHash } from "node:crypto";
import { createDeckConfigStore } from "./deck-config-store";
import { runRunnerReviewPlan } from "./tui/runner-dashboard/action-runner";
import { createDefaultRunnerDashboardState, type RunnerReviewPlan } from "./tui/runner-dashboard/state";
import { validateAndStoreSupermemoryRuntimeCredential } from "./tui/runner-dashboard/action-runner";
import { openCodeProfileCredentialEffects } from "./tui/app";

describe("shared Claude Supermemory launch credential handoff", () => {
  test("Claude TUI credential collection writes only the existing protected alias store, without Deck API validation", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-shared-credential-"));
    try {
      const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "xdg") });
      let validated = false;
      const result = await validateAndStoreSupermemoryRuntimeCredential({
        runnerId: "claude", token: "fixture-shared-alias-token", alias: "github.com", eligibleAliases: ["github.com"],
        secretStore: store, profileCredentialEffects: openCodeProfileCredentialEffects,
        validateSupermemoryReadOnlyApi: async () => { validated = true; return { ok: false }; },
      });
      expect(result.ok).toBe(true);
      expect(validated).toBe(false);
      expect(resolveOpenCodeSupermemoryCredential({ store, origin: "git@github.com:acme/repo.git", sshDiscoveryStatus: "trusted" })).toMatchObject({ ok: true, token: "fixture-shared-alias-token", profile: "github.com" });
      expect(JSON.stringify(result)).not.toContain("fixture-shared-alias-token");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("failed pinned artifact effect skips team mutation and global memory activation", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-memory-failed-artifact-"));
    try {
      const configStore = createDeckConfigStore({ homeDir: home, xdgConfigHome: join(home, "xdg"), projectRoot: home });
      configStore.write(getDefaultDeckConfig());
      const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "xdg") });
      storeOpenCodeSupermemoryCredential({ store, token: "fixture-never-disclose", makeDefault: true, eligibleAliases: [] });
      const payload = Buffer.from('{"name":"supermemory"}\n');
      const manifest = [[".claude-plugin/plugin.json", createHash("sha256").update(payload).digest("hex"), payload.length]] as const;
      const dataRoot = join(home, "data", "deck");
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot, officialPluginManifest: manifest, supermemoryArtifactEffects: { fetchFile: async () => Buffer.from("corrupt") }, resolveMemoryCredential: () => ({ token: "fixture-never-disclose", profile: "default", canonicalRepoTag: "sm_project_v1_acme_repo" }) });
      const state = createDefaultRunnerDashboardState({ runnerScope: "claude", runnerUi: adapter.ui, adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, runtimeCredentialStored: true, runtimeCredentialVerification: "verified-present", diagnostics: [] } }, selectedCapabilities: { "claude-team-files": true, "context-mode": false, "codebase-memory": false, "codebase-memory-mcp": false, rtk: false, serena: false, context7: false, "web-search": false }, teams: { "developer-team": { teamId: "developer-team", label: "Developer Team", selected: true } }, runtime: { inspectionState: "ready", projectIdentity: "verified" }, operationId: "fixture-op", currentOperation: { runner: "claude", operationId: "fixture-op", explicitlySelected: false } });
      const plan = adapter.buildReviewPlan({ runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true }, packageInstructions: {}, adaptiveMemory: { provider: "supermemory", supermemory: { configured: true } }, runtime: { projectIdentity: "verified", projectRoot: home } } as never, { runnerId: "claude", environmentId: "claude-development", capabilities: [] }) as unknown as RunnerReviewPlan;
      expect(plan.ready).toBe(true);
      state.plan = plan;
      state.planGeneratedForRevision = state.planRevision;
      const results = await runRunnerReviewPlan(plan, { dashboardState: state, projectRoot: home, runnerId: "claude", operationId: "fixture-op", currentOperation: state.currentOperation as import("@deck/core").SerenaOperationIdentity, configStore, secretStore: store, profileCredentialEffects: { secretName: "opencode-supermemory-profiles", hasUsableCredential: () => true, storeCredential: () => { throw new Error("not called"); } }, runnerAdapter: { runAction: (action, context) => adapter.runAction(action, context) }, installTeamBundle: async () => { throw new Error("team install must not run"); } });
      expect(results.map((result) => ({ id: result.actionId, status: result.status }))).toContainEqual({ id: "claude.official-supermemory.install", status: "failed" });
      expect(configStore.readRequired().adaptiveMemory.enabled).toBe(false);
      expect(results.some((result) => result.actionId === "claude.team.install" && result.status === "executed")).toBe(false);
      expect(JSON.stringify(results)).not.toContain("fixture-never-disclose");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  test("reuses the OpenCode alias/default protected store and one verified canonical repo tag", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-memory-profiles-"));
    const project = join(home, "repo");
    try {
      await mkdir(project);
      execFileSync("git", ["init", "-q"], { cwd: project });
      execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/repo.git"], { cwd: project });
      const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "xdg") });
      storeOpenCodeSupermemoryCredential({ store, token: "fixture-alias-shared", alias: "github.com", eligibleAliases: ["github.com"] });
      expect(() => resolveClaudeSupermemoryLaunchCredential(project, { home, store, origin: () => "https://github.com/acme/repo.git", discoverAliases: () => ({ status: "trusted", aliases: ["github.com"], ambiguousAliases: [] }), managedSettingsPaths: [] })).toThrow("no explicit shared default credential");
      storeOpenCodeSupermemoryCredential({ store, token: "fixture-default-shared", makeDefault: true, eligibleAliases: ["github.com"] });
      const discoverAliases = () => ({ status: "trusted" as const, aliases: ["github.com"], ambiguousAliases: [] });
      const alias = resolveClaudeSupermemoryLaunchCredential(project, { home, store, discoverAliases, claudeConfigDir: join(home, ".claude"), managedSettingsPaths: [] });
      expect(alias).toEqual({ token: "fixture-alias-shared", profile: "github.com", canonicalRepoTag: "sm_project_v1_acme_repo" });
      expect(resolveOpenCodeSupermemoryCredential({ store, origin: "git@github.com:acme/repo.git", sshDiscoveryStatus: "trusted" })).toMatchObject({ ok: true, token: alias.token, profile: alias.profile });
      expect(resolveClaudeSupermemoryLaunchCredential(project, { home, store, discoverAliases: () => ({ status: "uncertain", aliases: [], ambiguousAliases: [] }), managedSettingsPaths: [] }).profile).toBe("default");
      expect(resolveClaudeSupermemoryLaunchCredential(project, { home, store, discoverAliases: () => ({ status: "trusted", aliases: ["github.com"], ambiguousAliases: ["GITHUB.COM"] }), managedSettingsPaths: [] }).profile).toBe("default");
      expect(() => resolveClaudeSupermemoryLaunchCredential(project, { home, store: { read: () => JSON.stringify({ schema: "invalid", profiles: { "github.com": "fixture-invalid-secret" } }) }, discoverAliases, managedSettingsPaths: [] })).toThrow("Protected shared profile store is invalid.");
      execFileSync("git", ["remote", "set-url", "origin", "https://github.com/acme/repo.git"], { cwd: project });
      expect(resolveClaudeSupermemoryLaunchCredential(project, { home, store, discoverAliases, claudeConfigDir: join(home, ".claude"), managedSettingsPaths: [] })).toEqual({ token: "fixture-default-shared", profile: "default", canonicalRepoTag: "sm_project_v1_acme_repo" });
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("uses the logical origin and the same canonical tag from a linked worktree", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-worktree-scope-"));
    const main = join(home, "main");
    const linked = join(home, "linked");
    try {
      await mkdir(main);
      await mkdir(linked);
      execFileSync("git", ["init", "-q"], { cwd: main });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/shared-repo.git"], { cwd: main });
      const worktreeGitdir = join(main, ".git", "worktrees", "linked");
      await mkdir(worktreeGitdir, { recursive: true });
      await writeFile(join(worktreeGitdir, "HEAD"), "ref: refs/heads/master\n");
      await writeFile(join(worktreeGitdir, "commondir"), "../..\n");
      await writeFile(join(worktreeGitdir, "gitdir"), `${join(linked, ".git")}\n`);
      await writeFile(join(linked, ".git"), `gitdir: ${worktreeGitdir}\n`);
      const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "xdg") });
      storeOpenCodeSupermemoryCredential({ store, token: "fixture-worktree-default", makeDefault: true, eligibleAliases: [] });
      const effects = { home, store, claudeConfigDir: join(home, ".claude"), managedSettingsPaths: [], discoverAliases: () => ({ status: "uncertain" as const, aliases: [], ambiguousAliases: [] }) };
      expect(resolveClaudeSupermemoryLaunchCredential(main, effects).canonicalRepoTag).toBe("sm_project_v1_acme_shared_repo");
      expect(resolveClaudeSupermemoryLaunchCredential(linked, effects).canonicalRepoTag).toBe("sm_project_v1_acme_shared_repo");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("blocks higher-priority project settings, absent identity and malformed stores without credential disclosure", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-memory-overrides-"));
    const project = join(home, "repo");
    try {
      await mkdir(project);
      execFileSync("git", ["init", "-q"], { cwd: project });
      const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "xdg") });
      storeOpenCodeSupermemoryCredential({ store, token: "fixture-private-secret", makeDefault: true, eligibleAliases: [] });
      const input = { home, store, claudeConfigDir: join(home, ".claude"), managedSettingsPaths: [], discoverAliases: () => ({ status: "uncertain" as const, aliases: [], ambiguousAliases: [] }) };
      expect(() => resolveClaudeSupermemoryLaunchCredential(project, input)).toThrow("canonical Supermemory repository identity");
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo.git"], { cwd: project });
      await mkdir(join(project, ".claude", ".supermemory-claude"), { recursive: true });
      await writeFile(join(project, ".claude", ".supermemory-claude", "config.json"), JSON.stringify({ repoContainerTag: "foreign", apiKey: "fixture-foreign-secret" }));
      let message = "";
      try { resolveClaudeSupermemoryLaunchCredential(project, input); } catch (error) { message = String(error); }
      expect(message).toContain("override");
      expect(message).not.toContain("fixture-private-secret");
      expect(message).not.toContain("fixture-foreign-secret");
      await rm(join(project, ".claude"), { recursive: true });
      await mkdir(join(home, ".supermemory-claude"));
      await writeFile(join(home, ".supermemory-claude", "settings.json"), JSON.stringify({ baseUrl: "https://untrusted.invalid" }));
      expect(() => resolveClaudeSupermemoryLaunchCredential(project, input)).toThrow("override");
      await rm(join(home, ".supermemory-claude"), { recursive: true });
      await mkdir(join(home, ".claude"));
      await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "supermemory@supermemory-plugins": true } }));
      expect(() => resolveClaudeSupermemoryLaunchCredential(project, input)).toThrow("second enabled Supermemory plugin");
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  test("rejects memory endpoint/auth/tag overrides from project, user, relocated and managed Claude settings", async () => {
    const home = await mkdtemp(join(tmpdir(), "deck-claude-settings-env-"));
    const project = join(home, "repo");
    try {
      await mkdir(project);
      execFileSync("git", ["init", "-q"], { cwd: project });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/repo.git"], { cwd: project });
      const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "xdg") });
      storeOpenCodeSupermemoryCredential({ store, token: "fixture-never-leak-token", makeDefault: true, eligibleAliases: [] });
      const projectSettings = join(project, ".claude", "settings.json");
      const localSettings = join(project, ".claude", "settings.local.json");
      const userSettings = join(home, ".claude", "settings.json");
      const relocated = join(home, "relocated");
      const managed = join(home, "managed", "managed-settings.json");
      await mkdir(join(project, ".claude"));
      await mkdir(join(home, ".claude"));
      await mkdir(relocated);
      await mkdir(join(home, "managed"));
      const effects = { home, store, claudeConfigDir: relocated, managedSettingsPaths: [managed], discoverAliases: () => ({ status: "uncertain" as const, aliases: [], ambiguousAliases: [] }) };
      const examples = [
        [projectSettings, { env: { SUPERMEMORY_MCP_URL: "https://untrusted.invalid/mcp" } }],
        [localSettings, { env: { SUPERMEMORY_REPO_TAG: "foreign" } }],
        [userSettings, { env: { SUPERMEMORY_CC_API_KEY: "foreign" } }],
        [join(relocated, "settings.json"), { env: { SUPERMEMORY_API_URL: "https://untrusted.invalid/api" } }],
        [managed, { env: { SUPERMEMORY_MCP_URL: "https://untrusted.invalid/mcp" } }],
      ] as const;
      for (const [path, config] of examples) {
        await writeFile(path, JSON.stringify(config));
        let diagnostic = "";
        try { resolveClaudeSupermemoryLaunchCredential(project, effects); } catch (error) { diagnostic = String(error); }
        expect(diagnostic).toContain("override");
        expect(diagnostic).not.toContain("fixture-never-leak-token");
        expect(diagnostic).not.toContain("untrusted.invalid");
        await rm(path);
      }
      await writeFile(projectSettings, JSON.stringify({ env: { SAFE_UNRELATED: "yes" } }));
      expect(resolveClaudeSupermemoryLaunchCredential(project, effects).canonicalRepoTag).toBe("sm_project_v1_acme_repo");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
