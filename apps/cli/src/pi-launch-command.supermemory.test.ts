import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPiLaunch } from "./pi-launch-command";

const SENTINEL_TOKEN = "supermemory-test-token-should-not-appear";

function createTempDir(prefix = "deck-supermemory-launch-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writePiMcpConfig(configPath: string, token = SENTINEL_TOKEN) {
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        mcpServers: {
          supermemory: {
            transport: "http",
            url: "https://supermemory-new.stlmcp.com",
            headers: { "x-supermemory-api-key": token },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function writeDeckConfig(projectRoot: string, activeProvider: "none" | "engram" | "supermemory") {
  mkdirSync(join(projectRoot, ".deck"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".deck", "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        adaptiveMemory: {
          activeProvider,
          supermemory: {
            mcpServerName: "supermemory",
            userId: "kevin",
            searchMode: "memories",
            maxMemoriesPerSession: 7,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

describe("runPiLaunch Supermemory provider resolution", () => {
  test("uses .deck/config.json when no CLI memory flag is supplied and constructs Supermemory provider", () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).toContain("Supermemory MCP Adaptive Memory");
        expect(systemPrompt).toContain("execute");
        expect(systemPrompt).toContain("search_docs");

        const orchestrator = readFileSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"), "utf-8");
        expect(orchestrator).toContain("Supermemory MCP Adaptive Memory");
        expect(orchestrator).toContain("execute");
        expect(orchestrator).toContain("search_docs");
        expect(orchestrator).not.toContain(SENTINEL_TOKEN);
        expect(orchestrator).not.toContain("x-supermemory-api-key");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("CLI provider overrides .deck/config.json and does not double-inject providers", () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        cliMemoryProvider: "engram",
        piMcpConfigPath,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).toContain("Engram Memory");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");

        const orchestrator = readFileSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"), "utf-8");
        expect(orchestrator).toContain("memory_search");
        expect(orchestrator).not.toContain("search_docs");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("CLI none overrides active Supermemory config", () => {
    const projectRoot = createTempDir();
    try {
      writeDeckConfig(projectRoot, "supermemory");

      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        cliMemoryProvider: "none",
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Adaptive Memory (provider-injected)");
        expect(existsSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"))).toBe(false);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("missing Pi MCP config falls back to no adaptive-memory injection with redacted warning", () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");

      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toBe(true);
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        expect(diagnosticText).not.toMatch(/x-supermemory-api-key\s*[:=]\s*[^\s,}]+/i);

        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");
        expect(existsSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"))).toBe(false);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("malformed Pi MCP config falls back without leaking token or header values", () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      mkdirSync(join(piMcpConfigPath, ".."), { recursive: true });
      writeFileSync(piMcpConfigPath, `{ "headers": { "x-supermemory-api-key": "${SENTINEL_TOKEN}" }`, "utf-8");

      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).toContain("memory_provider_unavailable");
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        expect(diagnosticText).not.toMatch(/x-supermemory-api-key\s*[:=]\s*[^\s,}]+/i);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("incomplete Supermemory Deck config launches without adaptive-memory injection", () => {
    const projectRoot = createTempDir();
    try {
      mkdirSync(join(projectRoot, ".deck"), { recursive: true });
      writeFileSync(
        join(projectRoot, ".deck", "config.json"),
        JSON.stringify({ version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }),
        "utf-8",
      );

      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.providerId === "supermemory")).toBe(true);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Adaptive Memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("preconstructed provider cannot be combined with CLI/config resolution", () => {
    const projectRoot = createTempDir();
    try {
      const result = runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        cliMemoryProvider: "engram",
        memoryProvider: {
          id: "supermemory",
          displayName: "Supermemory MCP",
          buildInjection: () => ({ instructions: [], toolBindings: [] }),
        },
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.code === "multiple_memory_providers")).toBe(true);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Adaptive Memory (provider-injected)");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
