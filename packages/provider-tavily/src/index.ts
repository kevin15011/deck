import type { WebSearchProviderDescriptorV1 } from "@deck/core";

/**
 * Shared Tavily MCP implementation descriptor.
 *
 * This package contains metadata only. It does not depend on or install the
 * upstream runtime package; runner adapters serialize this descriptor through
 * their native MCP configuration formats.
 */

export const TAVILY_PROVIDER_ID = "tavily" as const;
export const TAVILY_IMPLEMENTATION_ID = "tavily-mcp" as const;
export const TAVILY_MCP_SERVER_ID = "web-search" as const;
export const TAVILY_CREDENTIAL_ENV_VAR = "TAVILY_API_KEY" as const;
export const TAVILY_MCP_COMMAND = Object.freeze(["npx", "-y", "tavily-mcp@0.2.22"] as const);

export const TAVILY_INTERNAL_TOOL_MAPPING = Object.freeze({
  search: "tavily_search",
  extract: "tavily_extract",
} as const);

/** Upstream tools deliberately outside Deck's v1 semantic scope. */
export const TAVILY_FORBIDDEN_TOOL_NAMES = Object.freeze([
  "tavily_crawl",
  "tavily_map",
  "tavily_research",
] as const);

export const TAVILY_PROVIDER_DESCRIPTOR = Object.freeze({
  providerId: TAVILY_PROVIDER_ID,
  implementationId: TAVILY_IMPLEMENTATION_ID,
  semanticServerId: TAVILY_MCP_SERVER_ID,
  command: TAVILY_MCP_COMMAND,
  credentialEnvVar: TAVILY_CREDENTIAL_ENV_VAR,
  toolMapping: TAVILY_INTERNAL_TOOL_MAPPING,
  forbiddenToolNames: TAVILY_FORBIDDEN_TOOL_NAMES,
}) satisfies WebSearchProviderDescriptorV1;

export type TavilyProviderDescriptor = typeof TAVILY_PROVIDER_DESCRIPTOR;

export function isTavilyProvider(provider: string | undefined): boolean {
  return provider?.trim() === TAVILY_PROVIDER_ID;
}

/** Return only presence; callers never receive the credential value. */
export function hasTavilyCredential(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return typeof environment[TAVILY_CREDENTIAL_ENV_VAR] === "string"
    && environment[TAVILY_CREDENTIAL_ENV_VAR]!.trim().length > 0;
}
