import { statSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { WebSearchProviderDescriptorV1 } from "../../core/src/index";
import { CLAUDE_CAPABILITY_IDS, type ClaudeCapabilityId } from "./models";

export type ClaudeCapabilityOptions = {
  resolveCommand?: (name: string) => string | undefined;
  webSearchProviderResolver?: (id: string | undefined) => WebSearchProviderDescriptorV1 | undefined;
  webSearchCredential?: () => string | undefined;
  serenaProxyCommand?: readonly string[];
  /** Must come from the Deck-owned Serena bootstrap/revalidation port, never PATH alone. */
  serenaReadinessVerified?: () => boolean;
  installSharedTool?: (id: "context-mode" | "context7" | "web-search") => Promise<boolean>;
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

/** Explicitly selected native plugin files. No credential value is serialized. */
export function claudeCapabilityFiles(
  root: string,
  ids: readonly ClaudeCapabilityId[],
  effects: ClaudeCapabilityOptions,
  providerId?: string,
): readonly { path: string; content: string; kind: "other" }[] {
  const servers: Record<string, { command: string; args?: string[] }> = {};
  const files: { path: string; content: string; kind: "other" }[] = [];
  if (ids.includes("context-mode")) servers["context-mode"] = { command: verifyClaudeExecutable("context-mode", effects) };
  if (ids.includes("codebase-memory")) servers["codebase-memory"] = { command: verifyClaudeExecutable("codebase-memory-mcp", effects) };
  if (ids.includes("context7")) servers.context7 = { command: verifyClaudeExecutable("context7-mcp", effects) };
  if (ids.includes("serena")) {
    const proxy = effects.serenaProxyCommand;
    if (effects.serenaReadinessVerified?.() !== true || !proxy || proxy.length < 2 || !isAbsolute(proxy[0] ?? "") || proxy.slice(1).some((part) => /[\0\r\n]/.test(part))) throw new Error("Deck Serena proxy/bootstrap evidence is unavailable.");
    servers.serena = { command: verifyClaudeExecutable(proxy[0]!, { resolveCommand: () => proxy[0] }), args: [...proxy.slice(1)] };
  }
  if (ids.includes("web-search")) {
    const descriptor = effects.webSearchProviderResolver?.(providerId);
    if (!descriptor || descriptor.providerId !== "tavily" || descriptor.semanticServerId !== "web-search" || descriptor.credentialEnvVar !== "TAVILY_API_KEY" || descriptor.command.join("\0") !== "npx\0-y\0tavily-mcp@0.2.22") throw new Error("Selected Deck Web Search provider is unsupported for Claude.");
    servers[descriptor.semanticServerId] = { command: verifyClaudeExecutable("tavily-mcp", effects) };
  }
  if (Object.keys(servers).length > 0) files.push({ path: join(root, ".mcp.json"), content: JSON.stringify({ mcpServers: servers }, null, 2) + "\n", kind: "other" });
  if (ids.includes("rtk")) {
    const command = `${quote(verifyClaudeExecutable("rtk", effects))} hook claude`;
    files.push({ path: join(root, "hooks", "hooks.json"), content: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command }] }] } }, null, 2) + "\n", kind: "other" });
  }
  if (ids.some((id) => !CLAUDE_CAPABILITY_IDS.includes(id))) throw new Error("Unknown Claude capability.");
  return files;
}
