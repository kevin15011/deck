import { describe, expect, test } from "bun:test";

import { CODEX_CAPABILITY_CATALOG, CODEX_RUNNER_CAPABILITY_CONTRIBUTION } from "./capability-catalog";
import { hasWebSearchProviderCredential } from "@deck/core";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import {
  buildCodexMcpServers,
  isCodexWebSearchMcpConfigured,
  mergeCodexMcpServers,
} from "./mcp-config";

describe("Codex web-search adapter", () => {
  test("declares supported parity without changing unrelated Codex ownership gaps", () => {
    expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({
      capabilityId: "web-search",
      status: "supported",
      provisionMode: "native-mcp",
      mcpServerName: "web-search",
    }));
    expect(CODEX_RUNNER_CAPABILITY_CONTRIBUTION.mappings).toContainEqual(expect.objectContaining({
      capabilityId: "web-search",
      status: "supported",
      implementationId: "tavily-mcp",
    }));
    expect(CODEX_RUNNER_CAPABILITY_CONTRIBUTION.mappings).toContainEqual(expect.objectContaining({
      capabilityId: "trusted-runner-host-bridge",
      status: "gap",
    }));
  });

  test("uses env_vars for the credential name and never accepts an inline value", () => {
    const syntheticCredential = "codex-web-search-synthetic-credential";
    const credentialAvailable = hasWebSearchProviderCredential(
      TAVILY_PROVIDER_DESCRIPTOR,
      { [TAVILY_PROVIDER_DESCRIPTOR.credentialEnvVar]: syntheticCredential },
    );
    expect(credentialAvailable).toBe(true);

    const result = buildCodexMcpServers({
      packageIds: ["web-search"],
      memoryProvider: "none",
      webSearchCredentialAvailable: credentialAvailable,
      webSearchExecutableAvailable: true,
      webSearchProviderSupported: true,
      webSearchProviderConfigured: true,
      webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR,
    });
    expect(result.servers).toContainEqual({
      id: "web-search",
      transport: "stdio",
      command: "npx",
      args: ["-y", "tavily-mcp@0.2.22"],
      envVars: ["TAVILY_API_KEY"],
    });
    expect(JSON.stringify(result)).not.toContain(syntheticCredential);
    expect(result.gaps).not.toContain(syntheticCredential);

    const serialized = mergeCodexMcpServers("", result.servers);
    expect(serialized.status).toBe("updated");
    if (serialized.status === "updated") {
      expect(serialized.content).toContain('env_vars = ["TAVILY_API_KEY"]');
      expect(serialized.content).not.toContain(syntheticCredential);
    }

    const incomplete = buildCodexMcpServers({ packageIds: ["web-search"], memoryProvider: "none", webSearchCredentialAvailable: false, webSearchExecutableAvailable: true, webSearchProviderSupported: true, webSearchProviderConfigured: true, webSearchProvider: TAVILY_PROVIDER_DESCRIPTOR });
    expect(incomplete.servers).toContainEqual(expect.objectContaining({ id: "web-search", envVars: ["TAVILY_API_KEY"] }));
    expect(incomplete.gaps).toContain("web-search-credential-missing");
  });

  test("fails closed when Web Search has no selected provider descriptor", () => {
    const result = buildCodexMcpServers({
      packageIds: ["web-search"],
      memoryProvider: "none",
      webSearchCredentialAvailable: true,
      webSearchExecutableAvailable: true,
    });

    expect(result.servers.some((server) => server.id === "web-search")).toBe(false);
    expect(result.gaps).toContain("web-search-provider-unconfigured");
  });

  test("preserves unrelated TOML and fails closed on same-name semantic collisions", () => {
    const source = "# user content\n[mcp_servers.unrelated]\ncommand = \"keep-me\"\n";
    const merged = mergeCodexMcpServers(source, [{
      id: "web-search",
      transport: "stdio",
      command: "npx",
      args: ["-y", "tavily-mcp@0.2.22"],
      envVars: ["TAVILY_API_KEY"],
    }]);
    expect(merged.status).toBe("updated");
    expect(merged.content).toContain("command = \"keep-me\"");
    expect(merged.content).toContain("env_vars = [\"TAVILY_API_KEY\"]");
    expect(isCodexWebSearchMcpConfigured(merged.content, TAVILY_PROVIDER_DESCRIPTOR)).toBe(true);

    const blocked = mergeCodexMcpServers("[mcp_servers.web-search]\ncommand = \"other\"\n", [{
      id: "web-search",
      transport: "stdio",
      command: "npx",
      args: ["-y", "tavily-mcp@0.2.22"],
      envVars: ["TAVILY_API_KEY"],
    }]);
    expect(blocked).toMatchObject({ status: "blocked", collisions: ["web-search"] });
  });
});
