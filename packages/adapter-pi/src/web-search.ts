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
import type { PiMcpConfigWriteResult } from "./pi-mcp-config";

export type PiWebSearchReadinessInput = Readonly<{
  enabled: boolean;
  provider?: WebSearchProviderDescriptorV1 | string;
  credentialEnvironment?: Readonly<Record<string, string | undefined>>;
  executableAvailable: boolean;
  mcpConfigured: boolean;
  mcpConfigConflict?: boolean;
  runnerSupported?: boolean;
}>;

export type PiWebSearchMcpState = Readonly<{ configured: boolean; conflict: boolean }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExactEntry(value: unknown, provider: WebSearchProviderDescriptorV1): boolean {
  if (!isRecord(value)) return false;
  const env = value.env;
  const envIsReference = isRecord(env)
    && Object.keys(env).length === 1
    && env[provider.credentialEnvVar] === `$${provider.credentialEnvVar}`;
  return value.command === provider.command[0]
    && Array.isArray(value.args)
    && value.args.length === provider.command.length - 1
    && value.args.every((part, index) => part === provider.command[index + 1])
    && value.transport === "process"
    && envIsReference;
}

export function inspectPiWebSearchMcpConfig(
  configPath: string,
  provider?: WebSearchProviderDescriptorV1,
): PiWebSearchMcpState {
  if (!isWebSearchProviderDescriptor(provider)) return { configured: false, conflict: false };
  if (!existsSync(configPath)) return { configured: false, conflict: false };
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!isRecord(parsed) || parsed.mcpServers === undefined) return { configured: false, conflict: false };
    if (!isRecord(parsed.mcpServers)) return { configured: false, conflict: true };
    const entry = parsed.mcpServers[provider.semanticServerId];
    if (entry === undefined) return { configured: false, conflict: false };
    return isExactEntry(entry, provider) ? { configured: true, conflict: false } : { configured: false, conflict: true };
  } catch {
    return { configured: false, conflict: true };
  }
}

export function resolvePiWebSearchReadiness(input: PiWebSearchReadinessInput): {
  readiness: WebSearchReadinessResult;
  diagnostics: readonly string[];
} {
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

export function writePiWebSearchMcpConfig(options: {
  configPath?: string;
  homeDir?: string;
  credentialEnvironment?: Readonly<Record<string, string | undefined>>;
  provider?: WebSearchProviderDescriptorV1;
} = {}): PiMcpConfigWriteResult {
  const configPath = options.configPath ?? join(options.homeDir ?? homedir(), ".pi", "agent", "mcp.json");
  const provider = options.provider;
  const serverName = isWebSearchProviderDescriptor(provider) ? provider.semanticServerId : "web-search";
  if (!isWebSearchProviderDescriptor(provider)) {
    return {
      ok: false,
      action: "failed",
      path: configPath,
      serverName,
      diagnostics: [{
        code: "PI_MCP_PROVIDER_UNAVAILABLE",
        severity: "error",
        path: configPath,
        serverName,
        message: "Web Search provider selection is unavailable; no changes were written.",
      }],
    };
  }
  if (!hasWebSearchProviderCredential(provider, options.credentialEnvironment)) {
    return {
      ok: false,
      action: "failed",
      path: configPath,
      serverName,
      diagnostics: [{
        code: "PI_MCP_CONFIG_CONFLICT",
        severity: "error",
        path: configPath,
        serverName,
        message: `${provider.credentialEnvVar} is not available in the process environment; no credential was persisted.`,
      }],
    };
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
      if (!isRecord(parsed)) return failedPiWebSearch(configPath, "Pi MCP config must be a JSON object; no changes were written.", false, serverName);
      config = parsed;
    } catch {
      return failedPiWebSearch(configPath, "Pi MCP config is malformed; no changes were written.", false, serverName);
    }
  }

  if (config.mcpServers !== undefined && !isRecord(config.mcpServers)) {
    return failedPiWebSearch(configPath, "Pi MCP config mcpServers must be an object; no changes were written.", false, serverName);
  }
  const servers = (config.mcpServers as Record<string, unknown> | undefined) ?? {};
  const existing = servers[serverName];
   if (existing !== undefined && !isExactEntry(existing, provider)) {
    return failedPiWebSearch(configPath, "Existing Web Search MCP entry differs from Deck's reviewed semantic configuration; no changes were written.", true, serverName);
  }
   if (isExactEntry(existing, provider)) {
    return {
      ok: true,
      action: "unchanged",
      path: configPath,
      serverName,
      diagnostics: [{
        code: "PI_MCP_CONFIG_UNCHANGED",
        severity: "info",
        path: configPath,
        serverName,
        message: "Web Search MCP server entry is already configured; credential remains process-provided.",
      }],
    };
  }

  const nextConfig = {
    ...config,
    mcpServers: {
      ...servers,
      [serverName]: {
         command: provider.command[0],
         args: [...provider.command.slice(1)],
         env: { [provider.credentialEnvVar]: `$${provider.credentialEnvVar}` },
        transport: "process",
      },
    },
  };

  try {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return {
      ok: true,
      action: "created",
      path: configPath,
      serverName,
      diagnostics: [{
        code: "PI_MCP_CONFIG_CREATED",
        severity: "info",
        path: configPath,
        serverName,
        message: "Web Search MCP server entry configured; credential remains process-provided.",
      }],
    };
  } catch {
    return failedPiWebSearch(configPath, "Pi Web Search MCP configuration could not be written; no credential was persisted.", false, serverName);
  }
}

function failedPiWebSearch(path: string, message: string, conflict = false, serverName = "web-search"): PiMcpConfigWriteResult {
  return {
    ok: false,
    action: "failed",
    path,
    serverName,
    diagnostics: [{
      code: conflict ? "PI_MCP_CONFIG_CONFLICT" : "PI_MCP_CONFIG_MALFORMED",
      severity: "error",
      path,
      serverName,
      message,
    }],
  };
}
