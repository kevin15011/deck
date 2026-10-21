import type { DriverTaskInput } from "@deck/core/session/driver";
import { isAbsolute } from "node:path";
import { object } from "./rpc";

/** App-server has no --ignore-user-config in 0.162.1 (that flag belongs to exec). */
export const ISOLATION_FEATURES = ["multi_agent", "multi_agent_v2"] as const;
export type CodexLaunchOptions = { executable?: string; baseEnv?: Readonly<Record<string, string | undefined>> };
export const nativeCodexMcpId = (taskId: string, logicalId: string): string => `deck-session-${taskId}-${logicalId}`;
export type CodexHookMetadata = { key: string; currentHash: string; eventName: string; command?: string; handlerType?: string; source?: string; enabled?: boolean; trustStatus?: string; async?: boolean };
export function codexMemoryHooks(input: DriverTaskInput): Record<string, unknown> {
  if (input.nativeMemory?.status === "unavailable") throw new Error("codex-native-memory-unavailable");
  const hooks: Record<string, unknown> = {};
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
/** Installed owned blocks spell the default matcher explicitly; native layers keep that syntax. */
export function matchesCodexMemoryGroups(value: unknown, event: string, input: DriverTaskInput): boolean {
  const expected = (codexMemoryHooks(input)[event] as {hooks:{command:string}[]}[] | undefined)?.[0]?.hooks[0]?.command;
  return !!expected && Array.isArray(value) && value.every(group => {
    const entry = object(group);
    return (entry.matcher === undefined || entry.matcher === "*") && Array.isArray(entry.hooks) && entry.hooks.length === 1 && entry.hooks.every(raw => {
      const hook = object(raw); return hook.type === "command" && hook.command === expected && hook.async !== true;
    });
  });
}
function toml(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(",")}]`;
  return `{${Object.entries(object(value)).map(([key, v]) => `${JSON.stringify(key)}=${toml(v)}`).join(",")}}`;
}
/** Only Deck additions/suppressions travel through stdin. Personal config stays native. */
export function codexThreadMcpConfig(input: DriverTaskInput, nativeIds: readonly string[] = []): Record<string, unknown> {
  const servers: Record<string, unknown> = Object.fromEntries((input.suppressedMcpServers ?? []).filter(id => nativeIds.includes(id)).map(id => [id, { enabled: false }]));
  for (const id of input.mcp.servers) {
    const spec = input.mcpServerSpecs[id]; if (!spec) throw new Error("codex-mcp-spec-missing");
    servers[id] = spec.transport === "http" ? { enabled: true, url: spec.url, ...(spec.envHttpHeaders ? { env_http_headers: spec.envHttpHeaders } : {}) } : { enabled: true, command: spec.command, args: spec.args, env: spec.env };
  }
  return { mcp_servers: servers };
}
export function buildCodexLaunch(input: DriverTaskInput, options: CodexLaunchOptions = {}, inheritedHooks: readonly CodexHookMetadata[] = []) {
  // Under development in Codex 0.162.1; supervised questions use io.question in both approval modes.
  codexMemoryHooks(input);
  const args = ["app-server", "--stdio", "-c", "features.default_mode_request_user_input=true"];
  if (input.disableNativeDelegation) for (const feature of ISOLATION_FEATURES) args.push("-c", `features.${feature}=false`);
  if (input.nativeMemory?.status === "ready") {
    args.push("-c", "features.hooks=true");
    const hooks = codexMemoryHooks(input);
    hooks.state = Object.fromEntries(inheritedHooks.flatMap(hook => {
      if (isAdmittedCodexMemoryHook(hook, input)) return [[hook.key, { enabled: true, trusted_hash: hook.currentHash }]];
      const event = hook.eventName === "userPromptSubmit" ? "UserPromptSubmit" : hook.eventName === "stop" ? "Stop" : undefined;
      const expected = event ? (codexMemoryHooks(input)[event] as {hooks:{command:string}[]}[])[0]?.hooks[0]?.command : undefined;
      return expected && hook.command === expected ? [[hook.key, { enabled: false }]] : [];
    }));
    args.push("-c", `hooks=${toml(hooks)}`);
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv ?? process.env)) if (typeof value === "string") env[key] = value;
  if (input.nativeMemory?.scopeMode === "global") for (const key of Object.keys(env)) if (/^SUPERMEMORY_/i.test(key) || /^DECK_MEMORY_/i.test(key)) delete env[key];
  return { command: options.executable ?? "codex", args, env };
}

/** Config is never emitted: keep only server names and compare explicit fields in memory. */
export function verifyCodexConfig(config: Record<string, unknown>, input: DriverTaskInput): void {
  const features = object(config.features);
  if (input.disableNativeDelegation && ISOLATION_FEATURES.some(id => features[id] !== false)) throw new Error("codex-feature-isolation-violation");
  // Config/read precedes thread overrides. Fresh task aliases must not already exist
  // in native sources, otherwise nested native merge could retain foreign fields.
  for (const id of input.mcp.servers) if (object(config.mcp_servers)[id] !== undefined) throw new Error("codex-mcp-spec-isolation-violation");
}
