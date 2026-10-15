import type { DriverTaskInput } from "@deck/core/session/driver";
import { isAbsolute } from "node:path";
import { object } from "./rpc";

/** App-server has no --ignore-user-config in 0.162.1 (that flag belongs to exec). */
export const ISOLATION_FEATURES = ["hooks", "plugins", "remote_plugin", "apps", "multi_agent", "multi_agent_v2", "skill_mcp_dependency_install"] as const;
export type CodexLaunchOptions = { executable?: string; baseEnv?: Readonly<Record<string, string | undefined>> };
export const nativeCodexMcpId = (taskId: string, logicalId: string): string => `deck-session-${taskId}-${logicalId}`;
const HOOK_EVENTS = ["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "SessionStart", "SessionEnd", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "Interrupt"];
export type CodexHookMetadata = { key: string; currentHash: string; eventName: string; command?: string; handlerType?: string; source?: string; enabled?: boolean; trustStatus?: string; async?: boolean };
export function codexMemoryHooks(input: DriverTaskInput): Record<string, unknown> {
  if (input.nativeMemory?.status === "unavailable") throw new Error("codex-native-memory-unavailable");
  const hooks: Record<string, unknown> = Object.fromEntries(HOOK_EVENTS.map(event => [event, []]));
  if (input.nativeMemory?.status !== "ready") return hooks;
  const plugin = input.nativeMemory.plugin;
  if (!(input.nativeMemory.scopeMode === "global" ? input.nativeMemory.projectScope === undefined : /^sm_project_v1_[a-z0-9_]+$/.test(input.nativeMemory.projectScope ?? "")) || !plugin?.nodeCommand || !isAbsolute(plugin.nodeCommand)
    || !plugin.scripts || !isAbsolute(plugin.scripts.recall) || !isAbsolute(plugin.scripts.flush)) throw new Error("codex-native-memory-invalid");
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const command = (script: string) => `${quote(plugin.nodeCommand!)} ${quote(script)}`;
  hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: command(plugin.scripts.recall), timeout: 60, statusMessage: "Searching memories..." }] }];
  hooks.Stop = [{ hooks: [{ type: "command", command: command(plugin.scripts.flush), timeout: 30 }] }];
  return hooks;
}
export function isAdmittedCodexMemoryHook(hook: CodexHookMetadata, input: DriverTaskInput): boolean {
  const nativeEvent = hook.eventName === "userPromptSubmit" ? "UserPromptSubmit" : hook.eventName === "stop" ? "Stop" : undefined;
  const group = nativeEvent ? (codexMemoryHooks(input)[nativeEvent] as { hooks: { command: string }[] }[])[0] : undefined;
  return !!group && hook.source === "sessionFlags" && hook.handlerType === "command" && hook.async !== true && hook.command === group.hooks[0]?.command;
}
function toml(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  return `{${Object.entries(object(value)).map(([key, v]) => `${JSON.stringify(key)}=${toml(v)}`).join(",")}}`;
}
export function buildCodexLaunch(input: DriverTaskInput, inheritedIds: readonly string[] | undefined, options: CodexLaunchOptions = {}, inheritedPluginIds: readonly string[] = [], inheritedHooks: readonly CodexHookMetadata[] = []) {
  const args = ["app-server", "--stdio"];
  for (const feature of ISOLATION_FEATURES) args.push("-c", `features.${feature}=${feature === "hooks" && input.nativeMemory?.status === "ready"}`);
  const hooks = codexMemoryHooks(input);
  hooks.state = Object.fromEntries(inheritedHooks.map(hook => [hook.key, isAdmittedCodexMemoryHook(hook, input) ? { enabled: true, trusted_hash: hook.currentHash } : { enabled: false }]));
  args.push("-c", `hooks=${toml(hooks)}`);
  if (inheritedIds) {
    const servers: Record<string, unknown> = Object.fromEntries(inheritedIds.map((id) => [id, { enabled: false }]));
    for (const id of input.mcp.servers) {
      const spec = input.mcpServerSpecs[id];
      if (!spec) throw new Error("codex-mcp-spec-missing");
      if (spec.transport === "http") {
        let url: URL;
        try { url = new URL(spec.url); } catch { throw new Error("codex-http-mcp-url-invalid"); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("codex-http-mcp-url-invalid");
        for (const [header, variable] of Object.entries(spec.envHttpHeaders ?? {})) {
          if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) || !/^[A-Z_][A-Z0-9_]*$/.test(variable)) throw new Error("codex-http-mcp-env-header-invalid");
        }
      }
      servers[id] = spec.transport === "http" ? { enabled: true, url: spec.url, ...(spec.envHttpHeaders ? { env_http_headers: spec.envHttpHeaders } : {}) } : { enabled: true, command: spec.command, args: spec.args, env: spec.env };
    }
    // CLI dotted key paths do not parse quoted segments. Quote IDs inside TOML values instead.
    args.push("-c", `mcp_servers=${toml(servers)}`);
    args.push("-c", `plugins=${toml(Object.fromEntries(inheritedPluginIds.map((id) => [id, { enabled: false }])))}`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv ?? process.env)) if (typeof value === "string") env[key] = value;
  if (input.nativeMemory?.scopeMode === "global") for (const key of Object.keys(env)) if (/^SUPERMEMORY_/i.test(key) || /^DECK_MEMORY_/i.test(key)) delete env[key];
  return { command: options.executable ?? "codex", args, env };
}

/** Config is never emitted: keep only server names and compare explicit fields in memory. */
export function verifyCodexConfig(config: Record<string, unknown>, input: DriverTaskInput): void {
  const features = object(config.features);
  if (ISOLATION_FEATURES.some((id) => features[id] !== (id === "hooks" && input.nativeMemory?.status === "ready"))) throw new Error("codex-feature-isolation-violation");
  const servers = object(config.mcp_servers);
  const enabled = Object.keys(servers).filter((id) => object(servers[id]).enabled !== false).sort();
  if (JSON.stringify(enabled) !== JSON.stringify([...input.mcp.servers].sort())) throw new Error("codex-mcp-isolation-violation");
  for (const id of enabled) {
    const effective = object(servers[id]), expected = input.mcpServerSpecs[id]!;
    if (["bearer_token_env_var", "http_headers"].some((key) => effective[key] !== undefined && JSON.stringify(effective[key]) !== "{}"))
      throw new Error("codex-mcp-spec-isolation-violation");
    if (expected.transport === "http") {
      if (effective.url !== expected.url || effective.command !== undefined || effective.args !== undefined || effective.env !== undefined || effective.env_vars !== undefined)
        throw new Error("codex-mcp-spec-isolation-violation");
      if (JSON.stringify(Object.entries(object(effective.env_http_headers)).sort()) !== JSON.stringify(Object.entries(expected.envHttpHeaders ?? {}).sort()))
        throw new Error("codex-mcp-spec-isolation-violation");
    } else if (effective.command !== expected.command || JSON.stringify(effective.args ?? []) !== JSON.stringify(expected.args)
      || effective.url !== undefined || Array.isArray(effective.env_vars) && effective.env_vars.length > 0
      || Object.keys(object(effective.env_http_headers)).length > 0
      || JSON.stringify(Object.entries(object(effective.env)).sort()) !== JSON.stringify(Object.entries(expected.env).sort()))
      throw new Error("codex-mcp-spec-isolation-violation");
  }
}
