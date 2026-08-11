import { parseTOML, type AST } from "toml-eslint-parser";
import {
  isWebSearchProviderDescriptor,
  WEB_SEARCH_CAPABILITY_ID,
  type WebSearchProviderDescriptorV1,
} from "@deck/core";

export const CODEX_MCP_SERVER_IDS = ["context7", "context-mode", "codebase-memory", "serena", "supermemory", WEB_SEARCH_CAPABILITY_ID] as const;
export const CODEX_SUPERMEMORY_MCP_URL = "https://mcp.supermemory.ai/mcp";


export const CODEX_SERENA_PROXY_COMMAND = "deck";
export const CODEX_SERENA_PROXY_ARGS = ["internal", "serena-mcp"] as const;
export const CODEX_SERENA_PROXY_ENV_VARS = ["HOME", "PATH", "XDG_DATA_HOME"] as const;
export type CodexMcpServerId = (typeof CODEX_MCP_SERVER_IDS)[number];

export type CodexMcpServer =
  | { id: CodexMcpServerId; transport: "stdio"; command: string; args?: readonly string[]; envVars?: readonly string[] }
  | { id: CodexMcpServerId; transport: "streamable-http"; url: string; bearerTokenEnvVar?: string; envHttpHeaders?: Readonly<Record<string, string>> };

export type CodexMcpMergeResult =
  | { status: "unchanged" | "updated"; content: string; configured: readonly CodexMcpServerId[] }
  | { status: "blocked"; content: string; collisions: readonly CodexMcpServerId[]; diagnostics: readonly string[] };

const SECRET = /(?:token|secret|password|credential|api[-_]?key)/i;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function quote(value: string): string { return JSON.stringify(value); }

function normalized(server: CodexMcpServer): object {
  return server.transport === "stdio"
    ? {
      command: server.command,
      ...(server.args?.length ? { args: [...server.args] } : {}),
      ...(server.envVars?.length ? { env_vars: [...server.envVars] } : {}),
    }
    : {
      url: server.url,
      ...(server.bearerTokenEnvVar ? { bearer_token_env_var: server.bearerTokenEnvVar } : {}),
      ...(server.envHttpHeaders ? { env_http_headers: Object.fromEntries(Object.entries(server.envHttpHeaders).sort()) } : {}),
    };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
}

function scalar(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const node = value as { type?: string; value?: unknown; elements?: unknown[]; body?: unknown[] };
  if (node.type === "TOMLValue") return node.value;
  if (node.type === "TOMLArray") return (node.elements ?? []).map(scalar);
  if (node.type === "TOMLInlineTable") {
    return Object.fromEntries((node.body ?? []).map((entry) => {
      const item = entry as { key: { keys: Array<{ name?: string; value?: string }> }; value: unknown };
      return [item.key.keys.map((key) => key.name ?? key.value).join("."), scalar(item.value)];
    }));
  }
  return undefined;
}

function existingServers(source: string): Map<string, object> {
  const ast = parseTOML(source, { tomlVersion: "1.0.0" });
  const result = new Map<string, object>();
  for (const node of ast.body[0]?.body ?? []) {
    if (node.type !== "TOMLTable" || node.resolvedKey.length !== 2 || node.resolvedKey[0] !== "mcp_servers") continue;
    const fields = Object.fromEntries(node.body.map((entry) => [entry.key.keys.map((key) => key.type === "TOMLBare" ? key.name : key.value).join("."), scalar(entry.value)]));
    result.set(String(node.resolvedKey[1]), fields);
  }
  return result;
}

export function inspectCodexMcpServerIds(source: string): readonly string[] {
  try { return [...existingServers(source).keys()].sort(); } catch { return []; }
}

/** Confirms the exact credential-free Supermemory table that Deck is allowed to use. */
export function isCodexSupermemoryMcpConfigured(source: string): boolean {
  try {
    const server = existingServers(source).get("supermemory");
    const expected = normalized({ id: "supermemory", transport: "streamable-http", url: CODEX_SUPERMEMORY_MCP_URL });
    return server !== undefined && JSON.stringify(canonical(server)) === JSON.stringify(canonical(expected));
  } catch {
    return false;
  }
}

/** Confirms the exact portable Deck proxy contract. */
export function isCodexSerenaMcpConfigured(source: string): boolean {
  try {
    const server = existingServers(source).get("serena");
    const expected = normalized({
      id: "serena",
      transport: "stdio",
      command: CODEX_SERENA_PROXY_COMMAND,
      args: [...CODEX_SERENA_PROXY_ARGS],
      envVars: [...CODEX_SERENA_PROXY_ENV_VARS],
    });
    return server !== undefined && JSON.stringify(canonical(server)) === JSON.stringify(canonical(expected));
  } catch {
    return false;
  }
}

/** Confirms the exact credential-name-only Web Search table. */
export function isCodexWebSearchMcpConfigured(
  source: string,
  provider?: WebSearchProviderDescriptorV1,
): boolean {
  if (!isWebSearchProviderDescriptor(provider)) return false;
  try {
    const server = existingServers(source).get(provider.semanticServerId);
    const expected = normalized({
      id: provider.semanticServerId as CodexMcpServerId,
      transport: "stdio",
      command: provider.command[0]!,
      args: [...provider.command.slice(1)],
      envVars: [provider.credentialEnvVar],
    });
    return server !== undefined && JSON.stringify(canonical(server)) === JSON.stringify(canonical(expected));
  } catch {
    return false;
  }
}

function validate(server: CodexMcpServer): void {
  if (!CODEX_MCP_SERVER_IDS.includes(server.id)) throw new Error(`Unsupported Codex MCP server: ${server.id}`);
  if (server.transport === "stdio") {
    if (!server.command || /[\0\r\n]/.test(server.command)) throw new Error(`Invalid command for ${server.id}.`);
    for (const name of server.envVars ?? []) if (!ENV_NAME.test(name)) throw new Error(`Invalid external environment name for ${server.id}.`);
  } else {
    const url = new URL(server.url);
    if (url.protocol !== "https:") throw new Error(`Codex remote MCP ${server.id} must use HTTPS.`);
    if (server.id === "supermemory" && (server.bearerTokenEnvVar || server.envHttpHeaders)) {
      throw new Error("Supermemory must use Codex native OAuth without bearer or header credentials.");
    }
    if (server.bearerTokenEnvVar && !ENV_NAME.test(server.bearerTokenEnvVar)) throw new Error(`Invalid bearer token environment name for ${server.id}.`);
    for (const [header, envName] of Object.entries(server.envHttpHeaders ?? {})) {
      if (!header || !ENV_NAME.test(envName)) throw new Error(`Invalid external header environment mapping for ${server.id}.`);
    }
  }
  const serialized = JSON.stringify(server);
  if (/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{8,}/i.test(serialized)) throw new Error(`Inline credentials are forbidden for ${server.id}.`);
}

function render(server: CodexMcpServer): string {
  const lines = [`# deck-codex-mcp:${server.id}`, `[mcp_servers.${server.id}]`];
  if (server.transport === "stdio") {
    lines.push(`command = ${quote(server.command)}`);
    if (server.args?.length) lines.push(`args = [${server.args.map(quote).join(", ")}]`);
    if (server.envVars?.length) lines.push(`env_vars = [${server.envVars.map(quote).join(", ")}]`);
  } else {
    lines.push(`url = ${quote(server.url)}`);
    if (server.bearerTokenEnvVar) lines.push(`bearer_token_env_var = ${quote(server.bearerTokenEnvVar)}`);
    if (server.envHttpHeaders && Object.keys(server.envHttpHeaders).length > 0) {
      const entries = Object.entries(server.envHttpHeaders).sort().map(([header, env]) => `${quote(header)} = ${quote(env)}`);
      lines.push(`env_http_headers = { ${entries.join(", ")} }`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function managedServerIds(source: string): Set<string> {
  return new Set([...source.matchAll(/^# deck-codex-mcp:([a-z0-9-]+)$/gm)].map((match) => match[1]!));
}

/** True only for a Deck-owned MCP block, never a same-named user MCP server. */
export function isDeckManagedCodexMcpServer(source: string, serverId: CodexMcpServerId): boolean {
  return managedServerIds(source).has(serverId);
}

function stripManagedServerBlocks(source: string, ids: ReadonlySet<string>): string {
  if (ids.size === 0) return source;
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const output: string[] = [];
  for (let index = 0; index < lines.length;) {
    const marker = lines[index]!.trimEnd().match(/^# deck-codex-mcp:([a-z0-9-]+)$/);
    if (!marker || !ids.has(marker[1]!)) { output.push(lines[index++]!); continue; }
    index += 1;
    if (index < lines.length && lines[index]!.trimEnd() === `[mcp_servers.${marker[1]}]`) index += 1;
    while (index < lines.length && !lines[index]!.startsWith("[") && !lines[index]!.startsWith("# deck-codex-mcp:")) index += 1;
  }
  return output.join("").replace(/\n{3,}/g, "\n\n");
}

export function mergeCodexMcpServers(source: string, desired: readonly CodexMcpServer[]): CodexMcpMergeResult {
  let existing: Map<string, object>;
  try { existing = existingServers(source); } catch { return { status: "blocked", content: source, collisions: [], diagnostics: ["Malformed TOML cannot be changed safely."] }; }
  const managed = managedServerIds(source);
  const desiredIds = new Set<string>(desired.map((server) => server.id));
  const replaceManaged = new Set<string>([...managed].filter((id) => !desiredIds.has(id)));
  const collisions: CodexMcpServerId[] = [];
  const missing: CodexMcpServer[] = [];
  for (const server of desired) {
    try { validate(server); } catch (error) {
      return { status: "blocked", content: source, collisions: [], diagnostics: [redactCodexMcpDiagnostic(error instanceof Error ? error.message : "Invalid MCP configuration.")] };
    }
    const present = existing.get(server.id);
    if (!present) missing.push(server);
    else if (JSON.stringify(canonical(present)) !== JSON.stringify(canonical(normalized(server)))) {
      if (managed.has(server.id)) { replaceManaged.add(server.id); missing.push(server); }
      else collisions.push(server.id);
    }
  }
  if (collisions.length > 0) return {
    status: "blocked",
    content: source,
    collisions,
    diagnostics: collisions.map((id) => `Existing user MCP server '${id}' differs from Deck's reviewed semantic configuration.`),
  };
  if (missing.length === 0 && replaceManaged.size === 0) return { status: "unchanged", content: source, configured: desired.map((server) => server.id) };
  const base = stripManagedServerBlocks(source, replaceManaged);
  const separator = base.length === 0 || base.endsWith("\n") ? "" : "\n";
  const content = `${base}${separator}${missing.map(render).join("\n")}`;
  try { existingServers(content); } catch { return { status: "blocked", content: source, collisions: [], diagnostics: ["The MCP TOML edit did not reparse."] }; }
  return { status: "updated", content, configured: desired.map((server) => server.id) };
}

export function buildCodexMcpServers(input: {
  packageIds: readonly string[];
  memoryProvider: "none" | "supermemory" | "engram";
  /** A fresh Core probe confirmed the Deck-owned Serena launcher. */
  serenaLauncherAvailable?: boolean;
  /** The effective `deck` command has confirmed the hidden Serena proxy route. */
  serenaProxyAvailable?: boolean;
  /** Provider selection is validated by the CLI composition root. */
  webSearchProviderSupported?: boolean;
  /** Provider selection was supplied at all; false reports an incomplete optional setup. */
  webSearchProviderConfigured?: boolean;
  /** Reviewed provider descriptor selected by the CLI composition root. */
  webSearchProvider?: WebSearchProviderDescriptorV1;
  /** Presence-only credential evidence; the value is never accepted here. */
  webSearchCredentialAvailable?: boolean;
  /** Presence-only executable prerequisite evidence. */
  webSearchExecutableAvailable?: boolean;
}): { servers: readonly CodexMcpServer[]; gaps: readonly string[] } {
  const selected = new Set(input.packageIds);
  const servers: CodexMcpServer[] = [];
  const gaps: string[] = [];
  if (selected.has("context-mode")) servers.push({ id: "context-mode", transport: "stdio", command: "context-mode", args: ["mcp"] });
  if (selected.has("codebase-memory")) servers.push({ id: "codebase-memory", transport: "stdio", command: "codebase-memory-mcp" });
  if (selected.has("serena")) {
    if (input.serenaLauncherAvailable !== true) {
      gaps.push("serena-launcher-not-ready");
    } else if (input.serenaProxyAvailable === true) {
      servers.push({
        id: "serena",
        transport: "stdio",
        command: CODEX_SERENA_PROXY_COMMAND,
        args: [...CODEX_SERENA_PROXY_ARGS],
        envVars: [...CODEX_SERENA_PROXY_ENV_VARS],
      });
    } else {
      gaps.push("serena-proxy-not-ready");
    }
  }
  if (selected.has("context7")) servers.push({ id: "context7", transport: "streamable-http", url: "https://mcp.context7.com/mcp", envHttpHeaders: { "X-Context7-API-Key": "CONTEXT7_API_KEY" } });
  if (input.memoryProvider === "supermemory") servers.push({ id: "supermemory", transport: "streamable-http", url: CODEX_SUPERMEMORY_MCP_URL });
  if (selected.has(WEB_SEARCH_CAPABILITY_ID)) {
    if (input.webSearchProviderConfigured !== true) {
      gaps.push("web-search-provider-unconfigured");
    } else if (input.webSearchProviderSupported !== true || !isWebSearchProviderDescriptor(input.webSearchProvider)) {
      gaps.push("web-search-provider-unsupported");
    } else {
      if (input.webSearchCredentialAvailable !== true) gaps.push("web-search-credential-missing");
      if (input.webSearchExecutableAvailable !== true) gaps.push("web-search-executable-missing");
      servers.push({
        id: input.webSearchProvider.semanticServerId as CodexMcpServerId,
        transport: "stdio",
        command: input.webSearchProvider.command[0]!,
        args: [...input.webSearchProvider.command.slice(1)],
        envVars: [input.webSearchProvider.credentialEnvVar],
      });
    }
  }
  if (input.memoryProvider === "engram") gaps.push("engram-codex-deferred");
  return { servers, gaps };
}

export function redactCodexMcpDiagnostic(message: string): string {
  return message.split(/\s+/).map((part) => SECRET.test(part) && part.includes("=") ? `${part.split("=")[0]}=[REDACTED]` : part).join(" ");
}
