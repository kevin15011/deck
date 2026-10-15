/** Native Supermemory preparation for managed cross sessions. No installation or provider I/O. */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCodexTools } from "@deck/adapter-codex";
import { inspectOwnedOpenCodeSupermemory } from "@deck/adapter-opencode";
import { resolveCanonicalSupermemoryProjectScope, resolveDefaultDeckDataRoot, type NormalizedDeckConfig } from "@deck/core";
import type { ChildMcpServerSpec, NativeMemoryDescriptor } from "@deck/core/session/driver";
import { CLAUDE_SUPERMEMORY_COMMIT, inspectClaudeSupermemoryArtifact } from "../../../packages/adapter-claude/src/supermemory-artifact";
import { resolveClaudeSupermemoryLaunchCredential } from "./claude-supermemory-launch";
import { assertCodexSupermemoryReady, buildCodexSupermemoryLaunchOverlay, resolveCodexSupermemoryLaunchCredential } from "./codex-supermemory-launch";
import { buildOpenCodeSupermemoryLaunchOverlay } from "./opencode-supermemory-launch";

type Credential = { token: string; canonicalRepoTag: string };
type Plugin = NonNullable<NativeMemoryDescriptor["plugin"]>;
export type NativeMemoryPreparationEffects = {
  credential?: (runnerId: string, projectRoot: string) => Credential;
  plugin?: (runnerId: string, projectRoot: string, credential: Credential) => { plugin: Plugin; env: Record<string, string> };
};
export type PreparedNativeMemory = { nativeMemory: NativeMemoryDescriptor; envOverlay?: Record<string, string> };

function assertTrustedPath(root: string): void {
  let current = root;
  for (;;) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0) || typeof process.getuid === "function" && stat.uid !== process.getuid() && stat.uid !== 0) throw new Error("Native plugin path is untrusted");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function prepareClaudePlugin(environment: Readonly<Record<string, string | undefined>>): Plugin {
  const home = realpathSync(environment.HOME ?? "");
  const root = join(resolveDefaultDeckDataRoot(environment, home), "claude", `official-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0, 12)}`);
  assertTrustedPath(root);
  if (inspectClaudeSupermemoryArtifact(root) !== "ready") throw new Error("Pinned Claude plugin is unavailable");
  const node = Bun.which("node", { PATH: environment.PATH });
  if (!node || Number(Bun.spawnSync([node, "--version"], { stdout: "pipe", stderr: "ignore", timeout: 3000 }).stdout.toString().match(/^v(\d+)/)?.[1] ?? 0) < 18) throw new Error("Official plugin needs Node.js 18+");
  // --setting-sources excludes optional user/project/local settings; mandatory managed
  // settings still apply, so do not claim an exclusive plugin when they add hooks/plugins.
  const managed = [join(home, ".claude", "managed-settings.json"), ...(process.platform === "darwin" ? ["/Library/Application Support/ClaudeCode/managed-settings.json"] : process.platform === "linux" ? ["/etc/claude-code/managed-settings.json"] : [])];
  for (const file of managed) {
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("Untrusted managed Claude settings");
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (data.hooks && Object.keys(data.hooks).length || data.enabledPlugins && Object.values(data.enabledPlugins).some(value => value !== false) || data.disableAllHooks === true) throw new Error("Managed Claude hooks cannot be isolated");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return readPreparedClaudeMemoryPlugin(root);
}

/** Called only after the complete pinned artifact has verified. */
export function readPreparedClaudeMemoryPlugin(root: string): Plugin {
  const hookConfigPath = join(root, "hooks", "hooks.json");
  const hooks = JSON.parse(readFileSync(hookConfigPath, "utf8")).hooks;
  const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  const mcpServers: Record<string, ChildMcpServerSpec> = {};
  for (const [id, value] of Object.entries(mcp.mcpServers ?? mcp)) {
    const spec = value as { command: string; args?: string[]; env?: Record<string, string> };
    const expand = (s: string) => s.replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
    mcpServers[`plugin_supermemory_${id}`] = { command: expand(spec.command), args: (spec.args ?? []).map(expand), env: Object.fromEntries(Object.entries(spec.env ?? {}).map(([key, value]) => [key, expand(value)])) };
  }
  return { root, hookConfigPath, hooks, exclusiveHookEvents: Object.keys(hooks), mcpServers };
}

export function prepareSessionNativeMemory(
  runnerId: string, projectRoot: string, config: NormalizedDeckConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  effects: NativeMemoryPreparationEffects = {},
): PreparedNativeMemory | undefined {
  if (!["claude", "codex", "opencode"].includes(runnerId)) return undefined;
  const base = { provider: "supermemory", integration: "runner-plugin" } as const;
  if (!config.adaptiveMemory.enabled || config.adaptiveMemory.activeProvider !== "supermemory") return { nativeMemory: { ...base, status: "disabled", reasonCode: "memory-disabled" } };
  const unavailable = (reasonCode: string): PreparedNativeMemory => ({ nativeMemory: { ...base, status: "unavailable", reasonCode } });
  const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
  if (!scope.ok) return unavailable("native-memory-scope-unavailable");
  let credential: Credential;
  try {
    credential = effects.credential?.(runnerId, projectRoot) ?? (runnerId === "claude"
      ? resolveClaudeSupermemoryLaunchCredential(projectRoot, { home: environment.HOME, configHome: environment.XDG_CONFIG_HOME })
      : resolveCodexSupermemoryLaunchCredential(projectRoot, { home: environment.HOME, configHome: environment.XDG_CONFIG_HOME }));
    if (credential.canonicalRepoTag !== scope.scope || !credential.token.trim() || credential.token.length > 16 * 1024 || /[\0\r\n]/.test(credential.token)) return unavailable("native-memory-profile-unavailable");
  } catch { return unavailable("native-memory-profile-unavailable"); }
  try {
    let prepared: { plugin: Plugin; env: Record<string, string> };
    if (effects.plugin) prepared = effects.plugin(runnerId, projectRoot, credential);
    else if (runnerId === "claude") prepared = { plugin: prepareClaudePlugin(environment), env: { SUPERMEMORY_CC_API_KEY: credential.token, SUPERMEMORY_API_URL: "https://api.supermemory.ai", SUPERMEMORY_MCP_URL: "https://mcp.supermemory.ai/mcp", SUPERMEMORY_REPO_TAG: scope.scope } };
    else if (runnerId === "codex") {
      assertCodexSupermemoryReady(projectRoot, { home: environment.HOME, codexHome: environment.CODEX_HOME });
      const tools = createCodexTools({ homeDir: environment.HOME });
      const scripts = tools.supermemory.scripts(), nodeCommand = tools.node.command();
      if (!scripts || !nodeCommand) throw new Error("Pinned Codex hooks unavailable");
      const overlay = buildCodexSupermemoryLaunchOverlay({ token: credential.token, projectRoot, canonicalRepoTag: scope.scope });
      prepared = { plugin: { root: tools.supermemory.root, scripts, nodeCommand }, env: Object.fromEntries(Object.entries(overlay).map(([key, value]) => [key, value.value])) };
    } else {
      const overlay = buildOpenCodeSupermemoryLaunchOverlay({ token: credential.token, projectRoot, canonicalRepoTag: scope.scope, environment, homeDirectory: environment.HOME });
      const owned = inspectOwnedOpenCodeSupermemory({ environment, homeDirectory: environment.HOME });
      if (!owned.ready) throw new Error("Pinned OpenCode loader unavailable");
      prepared = { plugin: { root: owned.paths.installRoot, loaderPath: owned.paths.loaderPath }, env: Object.fromEntries(Object.entries(overlay).filter(([key]) => key !== "OPENCODE_CONFIG_CONTENT").map(([key, value]) => [key, value.value])) };
    }
    return { nativeMemory: { ...base, status: "ready", projectScope: scope.scope, automaticRecall: "native-hook", automaticCapture: "unverified", plugin: prepared.plugin }, envOverlay: prepared.env };
  } catch { return unavailable("native-memory-plugin-unavailable"); }
}
