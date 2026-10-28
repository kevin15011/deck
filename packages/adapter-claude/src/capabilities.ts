import { statSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WebSearchProviderDescriptorV1 } from "../../core/src/index";
import { CLAUDE_CAPABILITY_IDS, type ClaudeCapabilityId } from "./models";
import { claudeRtkHookScript } from "./rtk-hook";
import { claudeSessionStartHook } from "./session-start-hook";

export type ClaudeCapabilityOptions = {
  /** Existing CLI read-only native SessionStart transport, included in the generation hash. */
  nativeSessionStartCommand?: readonly string[];
  resolveCommand?: (name: string) => string | undefined;
  webSearchProviderResolver?: (id: string | undefined) => WebSearchProviderDescriptorV1 | undefined;
  webSearchCredential?: () => string | undefined;
  serenaProxyCommand?: readonly string[];
  /** Must come from the Deck-owned Serena bootstrap/revalidation port, never PATH alone. */
  serenaReadinessVerified?: () => boolean;
  installSharedTool?: (id: "context-mode" | "context7" | "web-search") => Promise<boolean>;
  /** Optional absolute Node.js path for the owned RTK JSON protocol bridge. */
  rtkHookRuntimeCommand?: string;
};

export function verifyClaudeExecutable(name: string, effects: ClaudeCapabilityOptions): string {
  const candidate = effects.resolveCommand?.(name) ?? (effects.resolveCommand ? undefined : Bun.which(name) ?? undefined);
  if (!candidate || !isAbsolute(candidate) || /[\0\r\n]/.test(candidate)) throw new Error(`${name} has no verified executable.`);
  const path = realpathSync(candidate);
  const stat = statSync(path);
  if (!stat.isFile() || (stat.mode & 0o111) === 0) throw new Error(`${name} has no verified executable.`);
  return path;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function verifyClaudeRtkHookRuntime(effects: ClaudeCapabilityOptions): string {
  const runtime = verifyClaudeExecutable("node", { resolveCommand: () => effects.rtkHookRuntimeCommand ?? Bun.which("node") ?? undefined });
  const probe = Bun.spawnSync([runtime, "--version"], { timeout: 3000, stdout: "pipe", stderr: "ignore", env: { PATH: "/usr/bin:/bin" } });
  const major = probe.stdout.toString().trim().match(/^v(\d+)\./)?.[1];
  if (probe.exitCode !== 0 || Number(major ?? 0) < 18) throw new Error("RTK JSON hook bridge requires an installed Node.js 18+ runtime.");
  return runtime;
}

/** Explicitly selected native plugin files. No credential value is serialized. */
export function claudeCapabilityFiles(
  root: string,
  ids: readonly ClaudeCapabilityId[],
  effects: ClaudeCapabilityOptions,
  providerId?: string,
): readonly { path: string; content: string; kind: "other" }[] {
  ids = ids.filter(id => id !== "context-mode" && id !== "serena");
  const servers: Record<string, { command: string; args?: string[] }> = {};
  const files: { path: string; content: string; kind: "other" }[] = [];
  const sessionStartCommand = effects.nativeSessionStartCommand?.length ? [...effects.nativeSessionStartCommand, "--hook"].map(quote).join(" ") : 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cjs"';
  const hooks: Record<string, unknown> = { SessionStart: [{ hooks: [{ type: "command", command: sessionStartCommand }] }] };
  files.push({ path: join(root, "hooks", "session-start.cjs"), content: claudeSessionStartHook(effects.nativeSessionStartCommand), kind: "other" });
  if (ids.includes("context-mode")) servers["context-mode"] = { command: verifyClaudeExecutable("context-mode", effects) };
  if (ids.includes("codebase-memory")) servers["codebase-memory"] = { command: verifyClaudeExecutable("codebase-memory-mcp", effects) };
  if (ids.includes("context7")) servers.context7 = { command: verifyClaudeExecutable("context7-mcp", effects) };
  if (ids.includes("serena")) {
    const proxy = effects.serenaProxyCommand;
    if (effects.serenaReadinessVerified?.() !== true || !proxy || proxy.length < 2 || !isAbsolute(proxy[0] ?? "") || proxy.slice(1).some((part) => /[\0\r\n]/.test(part))) throw new Error("Deck Serena proxy/bootstrap evidence is unavailable.");
    servers.serena = { command: verifyClaudeExecutable(proxy[0]!, { resolveCommand: () => proxy[0] }), args: [...proxy.slice(1)] };
  }
  if (Object.keys(servers).length > 0) files.push({ path: join(root, ".mcp.json"), content: JSON.stringify({ mcpServers: servers }, null, 2) + "\n", kind: "other" });
  if (ids.includes("rtk")) {
    const binary = verifyClaudeExecutable("rtk", effects);
    const runtime = verifyClaudeRtkHookRuntime(effects);
    const command = `${quote(runtime)} "\${CLAUDE_PLUGIN_ROOT}/hooks/rtk-hook.cjs"`;
    files.push({ path: join(root, "hooks", "rtk-hook.cjs"), content: claudeRtkHookScript(binary), kind: "other" });
    hooks.PreToolUse = [{ matcher: "Bash", hooks: [{ type: "command", command }] }];
  }
  files.push({ path: join(root, "hooks", "hooks.json"), content: JSON.stringify({ hooks }, null, 2) + "\n", kind: "other" });
  if (ids.some((id) => !(CLAUDE_CAPABILITY_IDS as readonly string[]).includes(id))) throw new Error("Unknown Claude capability.");
  return files;
}
