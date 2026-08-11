import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PI_RUNNER_CAPABILITY_CONTRIBUTION, getPiRunnerCapability } from "./capability-catalog";
import { resolvePiWebSearchReadiness, writePiWebSearchMcpConfig } from "./web-search";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { createPiRunnerAdapter } from "./runner-adapter";

describe("Pi web-search adapter", () => {
  test("declares the canonical capability and provider-derived implementation", () => {
    expect(getPiRunnerCapability("web-search")).toMatchObject({
      capabilityId: "web-search",
      installKind: "mcp-server",
      implementationId: "tavily-mcp",
    });
    expect(PI_RUNNER_CAPABILITY_CONTRIBUTION.mappings).toContainEqual(expect.objectContaining({
      capabilityId: "web-search",
      status: "supported",
      implementationId: "tavily-mcp",
    }));
  });

  test("requires an environment credential but never serializes its value", () => {
    const secret = "pi-tavily-secret";
    const root = mkdtempSync(join(tmpdir(), "deck-pi-web-search-"));
    const path = join(root, "mcp.json");
    try {
      const incomplete = resolvePiWebSearchReadiness({
        enabled: true,
        provider: TAVILY_PROVIDER_DESCRIPTOR,
        credentialEnvironment: {},
        executableAvailable: true,
        mcpConfigured: false,
      });
      expect(incomplete.readiness.state).toBe("enabled-unconfigured");

      const configured = writePiWebSearchMcpConfig({
        configPath: path,
        provider: TAVILY_PROVIDER_DESCRIPTOR,
        credentialEnvironment: { TAVILY_API_KEY: secret },
      });
      expect(configured.ok).toBe(true);
      const raw = readFileSync(path, "utf8");
      expect(raw).not.toContain(secret);
      expect(raw).toContain("TAVILY_API_KEY");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves unrelated MCP config and blocks semantic collisions", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-pi-web-search-collision-"));
    const path = join(root, "mcp.json");
    try {
      writeFileSync(path, JSON.stringify({ mcpServers: { unrelated: { command: "keep-me" } } }));
      expect(writePiWebSearchMcpConfig({ configPath: path, provider: TAVILY_PROVIDER_DESCRIPTOR, credentialEnvironment: { TAVILY_API_KEY: "secret" } }).ok).toBe(true);
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      expect(parsed.mcpServers.unrelated).toEqual({ command: "keep-me" });
      expect(parsed.mcpServers["web-search"]).toMatchObject({ command: "npx", args: ["-y", "tavily-mcp@0.2.22"], transport: "process" });

      writeFileSync(path, JSON.stringify({ mcpServers: { "web-search": { command: "other" } } }));
      const blocked = writePiWebSearchMcpConfig({ configPath: path, provider: TAVILY_PROVIDER_DESCRIPTOR, credentialEnvironment: { TAVILY_API_KEY: "secret" } });
      expect(blocked).toMatchObject({ ok: false, action: "failed" });
      expect(blocked.diagnostics.some((diagnostic) => diagnostic.code === "PI_MCP_CONFIG_CONFLICT")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not write when the CLI did not select a provider descriptor", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-pi-web-search-provider-"));
    const path = join(root, "mcp.json");
    try {
      writeFileSync(path, JSON.stringify({ mcpServers: { unrelated: { command: "keep-me" } } }));
      const before = readFileSync(path, "utf8");
      const result = writePiWebSearchMcpConfig({ configPath: path, credentialEnvironment: { TAVILY_API_KEY: "secret" } });
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adapter action execution fails closed without provider selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-pi-web-search-action-"));
    try {
      const adapter = createPiRunnerAdapter({ homeDirectory: root });
      const result = await adapter.runAction({
        id: "capability.web-search.mcp-config",
        kind: "write-pi-mcp-config",
        title: "Configure Web Search MCP",
        capabilityId: "web-search",
        status: "ready",
      }, {
        projectRoot: root,
        runnerId: "pi",
        environmentId: "pi-development",
      });
      expect(result.status).toBe("failed");
      expect(existsSync(join(root, ".pi", "agent", "mcp.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
