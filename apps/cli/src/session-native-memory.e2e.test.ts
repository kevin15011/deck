import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultDeckConfig, resolveCanonicalSupermemoryProjectScope, createOwnerOnlyFileSecretStore } from "@deck/core";
import { storeOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import { resolveClaudeSupermemorySessionCredential, resolveClaudeSupermemoryLaunchCredential } from "./claude-supermemory-launch";
import { resolveCodexSupermemorySessionCredential, resolveCodexSupermemoryLaunchCredential } from "./codex-supermemory-launch";
import { prepareSessionNativeMemory, readPreparedClaudeMemoryPlugin } from "./session-native-memory";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deck-native-memory-")); roots.push(root);
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/deck.git"], { cwd: root, stdio: "ignore" });
  const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot: root, remotes: [] });
  if (!scope.ok) throw new Error("fixture scope");
  const config = getDefaultDeckConfig(); config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
  return { root, config, scope: scope.scope };
}
test.each(["claude", "codex", "opencode"])("%s binds verified native preparation to the same canonical project scope", runnerId => {
  const f = fixture(); let seen = "";
  const prepared = prepareSessionNativeMemory(runnerId, f.root, f.config, {}, {
    credential: (runner, root) => { expect(runner).toBe(runnerId); expect(root).toBe(f.root); return { token: "private-token", canonicalRepoTag: f.scope }; },
    plugin: (runner, root, credential) => { seen = runner; expect(root).toBe(f.root); expect(credential.canonicalRepoTag).toBe(f.scope); return { plugin: { root: "/verified/plugin" }, env: { SUPERMEMORY_API_KEY: credential.token, SUPERMEMORY_REPO_TAG: f.scope } }; },
  });
  expect(seen).toBe(runnerId);
  expect(prepared?.nativeMemory).toMatchObject({ status: "ready", provider: "supermemory", integration: "runner-plugin", projectScope: f.scope });
  expect(JSON.stringify(prepared?.nativeMemory)).not.toContain("private-token");
  expect(prepared?.envOverlay).toEqual({ SUPERMEMORY_API_KEY: "private-token", SUPERMEMORY_REPO_TAG: f.scope });
});
test("disabled memory and Pi do not resolve profiles or inspect plugins", () => {
  const effects = { credential: () => { throw new Error("must not resolve"); } };
  expect(prepareSessionNativeMemory("claude", "/missing", getDefaultDeckConfig(), {}, effects)?.nativeMemory.status).toBe("disabled");
  expect(prepareSessionNativeMemory("pi", "/missing", getDefaultDeckConfig(), {}, effects)).toBeUndefined();
});
test("missing canonical identity and mismatched profile fail closed without plugin effects", () => {
  const f = fixture(); let effects = 0;
  expect(prepareSessionNativeMemory("codex", "/missing", f.config)?.nativeMemory).toMatchObject({ status: "unavailable", reasonCode: "native-memory-scope-unavailable" });
  const prepared = prepareSessionNativeMemory("codex", f.root, f.config, {}, { credential: () => ({ token: "private-token", canonicalRepoTag: "sm_project_v1_other_repo" }), plugin: () => { effects++; throw new Error("unreachable"); } });
  expect(prepared?.nativeMemory).toMatchObject({ status: "unavailable", reasonCode: "native-memory-profile-unavailable" }); expect(effects).toBe(0);
});
test("credential and plugin failures are value-free and never silently fall back", () => {
  const f = fixture();
  const bad = prepareSessionNativeMemory("claude", f.root, f.config, {}, { credential: () => { throw new Error("private-token"); } });
  expect(bad?.nativeMemory).toMatchObject({ status: "unavailable", reasonCode: "native-memory-profile-unavailable" });
  const missing = prepareSessionNativeMemory("claude", f.root, f.config, {}, { credential: () => ({ token: "private-token", canonicalRepoTag: f.scope }), plugin: () => { throw new Error("private-token"); } });
  expect(missing?.nativeMemory).toMatchObject({ status: "unavailable", reasonCode: "native-memory-plugin-unavailable" });
  expect(JSON.stringify([bad, missing])).not.toContain("private-token");
});


test("verified Claude plugin uses the official top-level MCP shape and expands only the plugin root", () => {
  const f = fixture();
  mkdirSync(join(f.root, "hooks"));
  writeFileSync(join(f.root, "hooks", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [], UserPromptSubmit: [], Stop: [] } }));
  writeFileSync(join(f.root, ".mcp.json"), JSON.stringify({ supermemory: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/mcp-proxy.js"] } }));
  const plugin = readPreparedClaudeMemoryPlugin(f.root);
  expect(plugin.mcpServers).toEqual({ plugin_supermemory_supermemory: { command: "node", args: [join(f.root, "hooks", "mcp-proxy.js")], env: {} } });
  expect(plugin.exclusiveHookEvents).toEqual(["SessionStart", "UserPromptSubmit", "Stop"]);
});

for (const withGit of [false, true]) test.each(["claude", "codex", "opencode"])(`%s prepares explicit global memory when identity is absent (git=${withGit})`, runnerId => {
  const root = mkdtempSync(join(tmpdir(), "deck-global-memory-")); roots.push(root);
  if (withGit) execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  const config = getDefaultDeckConfig(); config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
  const prepared = prepareSessionNativeMemory(runnerId, root, config, {}, {
    credential: () => ({ token: "host-secret" }),
    plugin: () => ({ plugin: { root: "/verified/plugin" }, env: { SUPERMEMORY_API_KEY: "host-secret", SUPERMEMORY_REPO_TAG: "path-hash" } }),
  });
  expect(prepared?.nativeMemory).toMatchObject({ status: "ready", scopeMode: "global" });
  expect(prepared?.nativeMemory.projectScope).toBeUndefined();
  expect(JSON.stringify(prepared?.nativeMemory)).not.toContain("host-secret");
  expect(JSON.stringify(prepared?.envOverlay)).not.toContain("host-secret");
  expect(prepared?.envOverlay?.SUPERMEMORY_REPO_TAG).toBeUndefined();
});

for (const withGit of [false, true]) test.each(["claude", "codex"])(`%s managed global credentials require the protected explicit default (git=${withGit})`, runner => {
  const home = mkdtempSync(join(tmpdir(), "deck-global-profile-")); roots.push(home);
  const project = join(home, "project"); mkdirSync(project);
  if (withGit) execFileSync("git", ["init"], { cwd: project, stdio: "ignore" });
  const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "config") });
  const resolve = runner === "claude" ? resolveClaudeSupermemorySessionCredential : resolveCodexSupermemorySessionCredential;
  const staticResolve = runner === "claude" ? resolveClaudeSupermemoryLaunchCredential : resolveCodexSupermemoryLaunchCredential;
  const effects = { home, store, claudeConfigDir: join(home, ".claude"), managedSettingsPaths: [], origin: () => "git@private-alias:owner/repo.git", discoverAliases: () => ({ status: "trusted" as const, aliases: ["private-alias"], ambiguousAliases: [] }) };
  storeOpenCodeSupermemoryCredential({ store, token: "alias-key", alias: "private-alias", eligibleAliases: ["private-alias"] });
  expect(() => resolve(project, effects)).toThrow("explicit shared default");
  storeOpenCodeSupermemoryCredential({ store, token: "default-key", makeDefault: true, eligibleAliases: [] });
  expect(resolve(project, effects)).toEqual({ profile: "default", token: "default-key" });
  expect(() => staticResolve(project, effects)).toThrow("canonical Supermemory repository identity");
  expect(() => resolve(project, { ...effects, store: { read: () => "{}" } })).toThrow("Protected shared profile store is invalid");
});

test("global Claude credentials preserve higher-priority override refusal", () => {
  const home = mkdtempSync(join(tmpdir(), "deck-global-claude-override-")); roots.push(home);
  const project = join(home, "project"); mkdirSync(project);
  mkdirSync(join(project, ".claude"));
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ env: { SUPERMEMORY_API_URL: "https://foreign.example" } }));
  const store = createOwnerOnlyFileSecretStore({ configHome: join(home, "config") });
  storeOpenCodeSupermemoryCredential({ store, token: "default-key", makeDefault: true, eligibleAliases: [] });
  expect(() => resolveClaudeSupermemorySessionCredential(project, { home, store, claudeConfigDir: join(home, ".claude"), managedSettingsPaths: [] })).toThrow("environment override conflicts");
});

test.each(["claude", "codex", "opencode"])("%s global native memory rejects explicit project container overrides before plugin effects", runner => {
  const root = mkdtempSync(join(tmpdir(), "deck-global-override-")); roots.push(root);
  mkdirSync(join(root, ".claude", ".supermemory-claude"), { recursive: true });
  writeFileSync(join(root, ".claude", ".supermemory-claude", "config.json"), JSON.stringify({ repoContainerTag: "foreign" }));
  const config = getDefaultDeckConfig(); config.adaptiveMemory = { enabled: true, activeProvider: "supermemory" };
  let pluginCalls = 0;
  const prepared = prepareSessionNativeMemory(runner, root, config, {}, { credential: () => ({ token: "default-key" }), plugin: () => { pluginCalls++; return { plugin: { root: "/verified/plugin" }, env: {} }; } });
  expect(prepared?.nativeMemory).toMatchObject({ status: "unavailable", reasonCode: "native-memory-plugin-unavailable" });
  expect(pluginCalls).toBe(0);
});
