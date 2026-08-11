import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION, getOpenCodeRunnerCapability } from "./capability-catalog";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { createOpenCodeRunnerAdapter } from "./runner-adapter";
import {
  resolveOpenCodeWebSearchReadiness,
  writeOpenCodeWebSearchMcpConfig,
} from "./web-search";

describe("OpenCode web-search adapter", () => {
  test("declares the canonical capability and provider-derived implementation", () => {
    expect(getOpenCodeRunnerCapability("web-search")).toMatchObject({
      capabilityId: "web-search",
      canonicalCapabilityId: "web-search",
      installKind: "mcp-server",
      implementationId: "tavily-mcp",
    });
    expect(OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION.mappings).toContainEqual(expect.objectContaining({
      capabilityId: "web-search",
      status: "supported",
      implementationId: "tavily-mcp",
    }));
  });

  test("reports missing credentials without exposing the credential value", () => {
    const secret = "opencode-tavily-secret";
    const result = resolveOpenCodeWebSearchReadiness({
      enabled: true,
      provider: TAVILY_PROVIDER_DESCRIPTOR,
      credentialEnvironment: { TAVILY_API_KEY: ` ${secret} ` },
      executableAvailable: true,
      mcpConfigured: false,
    });
    expect(result.readiness).toMatchObject({ state: "configured-but-not-materialized" });
    expect(result.diagnostics.join(" ")).not.toContain(secret);

    const incomplete = resolveOpenCodeWebSearchReadiness({
      enabled: true,
      provider: TAVILY_PROVIDER_DESCRIPTOR,
      credentialEnvironment: {},
      executableAvailable: true,
      mcpConfigured: false,
    });
    expect(incomplete.readiness.state).toBe("enabled-unconfigured");
    expect(incomplete.diagnostics.join(" ")).not.toContain(secret);
  });

  test("preserves unrelated MCP config and fails closed on same-name collisions", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-"));
    const path = join(root, "opencode.json");
    try {
      writeFileSync(path, JSON.stringify({ mcp: { unrelated: { type: "local", command: ["keep-me"] } } }));
      const created = writeOpenCodeWebSearchMcpConfig({ configPath: path, provider: TAVILY_PROVIDER_DESCRIPTOR });
      expect(created.ok).toBe(true);
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      expect(parsed.mcp.unrelated).toEqual({ type: "local", command: ["keep-me"] });
      expect(parsed.mcp["web-search"]).toMatchObject({ type: "local", command: ["npx", "-y", "tavily-mcp@0.2.22"], enabled: true });
      expect(JSON.stringify(parsed)).not.toContain("TAVILY_API_KEY");

      writeFileSync(path, JSON.stringify({ mcp: { "web-search": { type: "local", command: ["other"] }, unrelated: { keep: true } } }));
      const blocked = writeOpenCodeWebSearchMcpConfig({ configPath: path, provider: TAVILY_PROVIDER_DESCRIPTOR });
      expect(blocked).toMatchObject({ ok: false, status: "blocked", collisions: ["web-search"] });
      expect(JSON.parse(readFileSync(path, "utf8")).mcp.unrelated).toEqual({ keep: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not write when the CLI did not select a provider descriptor", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-provider-"));
    const path = join(root, "opencode.json");
    try {
      writeFileSync(path, JSON.stringify({ mcp: { unrelated: { command: ["keep-me"] } } }));
      const before = readFileSync(path, "utf8");
      const result = writeOpenCodeWebSearchMcpConfig({ configPath: path });
      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed");
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, "utf8")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adapter action execution fails closed without provider selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-action-"));
    try {
      const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root });
      const result = await adapter.runAction({
        id: "capability.web-search.mcp-config",
        kind: "write-mcp-config",
        title: "Configure Web Search MCP",
        capabilityId: "web-search",
        status: "ready",
      }, {
        projectRoot: root,
        runnerId: "opencode",
        environmentId: "opencode-development",
      });
      expect(result.status).toBe("failed");
      expect(existsSync(join(root, "opencode.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
