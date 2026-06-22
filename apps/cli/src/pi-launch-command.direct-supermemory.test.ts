import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPiLaunch } from "./pi-launch-command";

const SENTINEL_TOKEN = "direct-supermemory-token-should-not-appear";

function createTempDir(prefix = "deck-direct-supermemory-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writePiMcpConfig(configPath: string) {
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        mcpServers: {
          supermemory: {
            transport: "http",
            url: "https://supermemory-new.stlmcp.com",
            headers: { "x-supermemory-api-key": SENTINEL_TOKEN },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

describe("runPiLaunch direct Supermemory dashboard config", () => {
  test("fails closed for invalid dashboard container tags without injecting memory", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        activeProvider: "supermemory",
        supermemory: {
          mcpServerName: "supermemory",
          // userId/teamId/orgId removed — these fields are `never` in DeckSupermemoryConfig
          // (token-only: user identity derived from token, project via x-sm-project header)
          searchMode: "memories",
          maxMemoriesPerSession: 7,
        },
        // Simulate runtime validation failure to test fails-closed behavior
        supermemoryRuntimeValidator: async () => ({
          ok: false,
          authenticatedRuntimeValidated: false,
          path: piMcpConfigPath,
          serverName: "supermemory",
          diagnostics: [{ code: "runtime-unreachable" as const, message: "Supermemory runtime is unreachable; launched without adaptive-memory injection." }],
        }),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toContainEqual(expect.objectContaining({
          code: "memory_provider_unavailable",
          providerId: "supermemory",
        }));
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        expect(diagnosticText).not.toMatch(/x-supermemory-api-key\s*[:=]\s*[^\s,}]+/i);

        // Token-only contract: when runtime validation fails, the orchestrator file is still
        // created (with a "memory unavailable" note) rather than being omitted entirely.
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("validates direct dashboard Supermemory config like Deck config and rejects secret fields", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        activeProvider: "supermemory",
        supermemory: {
          mcpServerName: "supermemory",
          userId: "kevin",
          apiKey: SENTINEL_TOKEN,
        } as never,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).toContain("memory_provider_unavailable");
        expect(diagnosticText).toContain("Deck config may not store Supermemory credentials.");
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("validates direct dashboard Supermemory config like Deck config and rejects extra fields", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        activeProvider: "supermemory",
        supermemory: {
          mcpServerName: "supermemory",
          userId: "kevin",
          extraField: "unexpected",
        } as never,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).toContain("memory_provider_unavailable");
        expect(diagnosticText).toContain("Unknown Deck config field: adaptiveMemory.supermemory.extraField");
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
