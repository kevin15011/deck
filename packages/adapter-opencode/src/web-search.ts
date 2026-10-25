import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  hasWebSearchProviderCredential,
  isWebSearchProviderDescriptor,
  resolveWebSearchReadiness,
  assertNoContributionSymlink,
  beginRunnerContributions,
  contributionHash,
  canonicalContributionJson,
  type NativeSearchEvidence,
  type WebSearchProviderDescriptorV1,
  type WebSearchReadinessResult,
} from "@deck/core";

export type OpenCodeWebSearchReadinessInput = Readonly<{
  nativeSearch?: NativeSearchEvidence;
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
    nativeSearch: input.nativeSearch,
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
  try { assertNoContributionSymlink(path); }
  catch { return fail("Unsafe Web Search configuration path; no changes were written."); }

  let config: Record<string, unknown> = {};
  let preimage: string | undefined;
  if (existsSync(path)) {
    try {
      preimage = readFileSync(path, "utf8");
      const parsed: unknown = JSON.parse(preimage);
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
  if (existing !== undefined && !isExactEntry(existing, provider)) {
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

  let accounting: ReturnType<typeof beginRunnerContributions> | undefined;
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    accounting = beginRunnerContributions({ runnerId: "opencode", root: dirname(path), manifestPath: join(dirname(path), "deck/manifest.json"), deckVersion: "0.13.0",
      targets: [{ path, selector: { kind: "json", keys: ["mcp", provider.semanticServerId] }, sourceItemId: "capability:web-search",
        expectedHash: contributionHash(canonicalContributionJson(nextConfig.mcp[provider.semanticServerId])) }] });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(nextConfig, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    assertNoContributionSymlink(path);
    if ((existsSync(path) ? readFileSync(path, "utf8") : undefined) !== preimage) throw new Error("Web Search configuration changed during apply");
    renameSync(temporary, path);
    accounting.commit();
    return {
      ok: true,
      status: existsSync(path) && existing !== undefined ? "updated" : "created",
      path,
      collisions: [],
      diagnostics: [],
    };
  } catch {
    accounting?.abandon();
    return fail("OpenCode Web Search MCP configuration could not be written; no credential was persisted.");
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
