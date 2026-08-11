import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  hasWebSearchProviderCredential,
  isWebSearchProviderDescriptor,
  resolveWebSearchReadiness,
  type WebSearchProviderDescriptorV1,
  type WebSearchReadinessResult,
} from "@deck/core";

export type OpenCodeWebSearchReadinessInput = Readonly<{
  enabled: boolean;
  provider?: WebSearchProviderDescriptorV1 | string;
  credentialEnvironment?: Readonly<Record<string, string | undefined>>;
  executableAvailable: boolean;
  mcpConfigured: boolean;
  mcpConfigConflict?: boolean;
  runnerSupported?: boolean;
}>;

export type OpenCodeWebSearchReadiness = Readonly<{
  readiness: WebSearchReadinessResult;
  diagnostics: readonly string[];
}>;

export type OpenCodeWebSearchMcpState = Readonly<{
  configured: boolean;
  conflict: boolean;
}>;

export type OpenCodeWebSearchMcpWriteResult = Readonly<{
  ok: boolean;
  status: "created" | "updated" | "unchanged" | "blocked" | "failed";
  path: string;
  collisions: readonly string[];
  diagnostics: readonly string[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExactEntry(value: unknown, provider: WebSearchProviderDescriptorV1): boolean {
  if (!isRecord(value)) return false;
  return value.type === "local"
    && value.enabled !== false
    && Array.isArray(value.command)
    && value.command.length === provider.command.length
    && value.command.every((part, index) => part === provider.command[index]);
}

function isDisabledExactEntry(value: unknown, provider: WebSearchProviderDescriptorV1): boolean {
  if (!isRecord(value)) return false;
  return value.type === "local"
    && value.enabled === false
    && Array.isArray(value.command)
    && value.command.length === provider.command.length
    && value.command.every((part, index) => part === provider.command[index]);
}

export function inspectOpenCodeWebSearchMcpConfig(
  configPath: string,
  provider?: WebSearchProviderDescriptorV1,
): OpenCodeWebSearchMcpState {
  if (!isWebSearchProviderDescriptor(provider)) return { configured: false, conflict: false };
  if (!existsSync(configPath)) return { configured: false, conflict: false };
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!isRecord(parsed) || parsed.mcp === undefined) return { configured: false, conflict: false };
    if (!isRecord(parsed.mcp)) return { configured: false, conflict: true };
    const entry = parsed.mcp[provider.semanticServerId];
    if (entry === undefined) return { configured: false, conflict: false };
    if (isExactEntry(entry, provider)) return { configured: true, conflict: false };
    if (isDisabledExactEntry(entry, provider)) return { configured: false, conflict: false };
    return { configured: false, conflict: true };
  } catch {
    return { configured: false, conflict: true };
  }
}

export function resolveOpenCodeWebSearchReadiness(
  input: OpenCodeWebSearchReadinessInput,
): OpenCodeWebSearchReadiness {
  const readiness = resolveWebSearchReadiness({
    enabled: input.enabled,
    runnerSupported: input.runnerSupported ?? true,
    providerConfigured: isWebSearchProviderDescriptor(input.provider),
    credentialAvailable: hasWebSearchProviderCredential(
      isWebSearchProviderDescriptor(input.provider) ? input.provider : undefined,
      input.credentialEnvironment,
    ),
    executableAvailable: input.executableAvailable,
    mcpConfigured: input.mcpConfigured,
    mcpConfigConflict: input.mcpConfigConflict,
  });
  return { readiness, diagnostics: readiness.diagnostics };
}

export function writeOpenCodeWebSearchMcpConfig(options: {
  configPath?: string;
  homeDir?: string;
  provider?: WebSearchProviderDescriptorV1;
} = {}): OpenCodeWebSearchMcpWriteResult {
  const path = options.configPath ?? join(options.homeDir ?? homedir(), ".config", "opencode", "opencode.json");
  const fail = (diagnostic: string, collisions: readonly string[] = []): OpenCodeWebSearchMcpWriteResult => ({
    ok: false,
    status: collisions.length > 0 ? "blocked" : "failed",
    path,
    collisions,
    diagnostics: [diagnostic],
  });

  const provider = options.provider;
  if (!isWebSearchProviderDescriptor(provider)) {
    return fail("Web Search provider selection is unavailable; no changes were written.");
  }

  let config: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(parsed)) return fail("OpenCode MCP config must be a JSON object; no changes were written.");
      config = parsed;
    } catch {
      return fail("OpenCode MCP config is malformed; no changes were written.");
    }
  }

  const currentMcp = config.mcp;
  if (currentMcp !== undefined && !isRecord(currentMcp)) {
    return fail("OpenCode MCP config must contain an object mcp map; no changes were written.");
  }
  const mcp = (currentMcp as Record<string, unknown> | undefined) ?? {};
  const existing = mcp[provider.semanticServerId];
  if (existing !== undefined && !isExactEntry(existing, provider) && !isDisabledExactEntry(existing, provider)) {
    return fail("Existing Web Search MCP entry differs from Deck's reviewed semantic configuration; no changes were written.", [provider.semanticServerId]);
  }
  if (isExactEntry(existing, provider)) {
    return { ok: true, status: "unchanged", path, collisions: [], diagnostics: [] };
  }

  const nextConfig = {
    ...config,
    mcp: {
      ...mcp,
       [provider.semanticServerId]: {
        type: "local",
        command: [...provider.command],
        enabled: true,
      },
    },
  };

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    return {
      ok: true,
      status: existsSync(path) && existing !== undefined ? "updated" : "created",
      path,
      collisions: [],
      diagnostics: [],
    };
  } catch {
    return fail("OpenCode Web Search MCP configuration could not be written; no credential was persisted.");
  }
}
