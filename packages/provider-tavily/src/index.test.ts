import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  TAVILY_CREDENTIAL_ENV_VAR,
  TAVILY_FORBIDDEN_TOOL_NAMES,
  TAVILY_INTERNAL_TOOL_MAPPING,
  TAVILY_MCP_COMMAND,
  TAVILY_MCP_SERVER_ID,
  TAVILY_PROVIDER_DESCRIPTOR,
  hasTavilyCredential,
} from "./index";

describe("Tavily provider descriptor", () => {
  test("centralizes the reviewed implementation metadata", () => {
    expect(TAVILY_PROVIDER_DESCRIPTOR).toMatchObject({
      providerId: "tavily",
      implementationId: "tavily-mcp",
      semanticServerId: "web-search",
      command: ["npx", "-y", "tavily-mcp@0.2.22"],
      credentialEnvVar: "TAVILY_API_KEY",
      toolMapping: {
        search: "tavily_search",
        extract: "tavily_extract",
      },
    });
    expect(TAVILY_MCP_SERVER_ID).toBe("web-search");
    expect(TAVILY_MCP_COMMAND).toEqual(["npx", "-y", "tavily-mcp@0.2.22"]);
    expect(TAVILY_CREDENTIAL_ENV_VAR).toBe("TAVILY_API_KEY");
    expect(TAVILY_INTERNAL_TOOL_MAPPING).toEqual({ search: "tavily_search", extract: "tavily_extract" });
    expect(TAVILY_FORBIDDEN_TOOL_NAMES.join(" ")).toMatch(/crawl|map|research/);
  });

  test("checks credential presence without returning or serializing its value", () => {
    const secret = "sentinel-tavily-secret";
    expect(hasTavilyCredential({ TAVILY_API_KEY: `  ${secret}  ` })).toBe(true);
    expect(hasTavilyCredential({ TAVILY_API_KEY: "   " })).toBe(false);
    expect(JSON.stringify(TAVILY_PROVIDER_DESCRIPTOR)).not.toContain(secret);
    expect(readFileSync(new URL("../package.json", import.meta.url), "utf8")).not.toMatch(/tavily-mcp|TAVILY_API_KEY/);
  });
});
