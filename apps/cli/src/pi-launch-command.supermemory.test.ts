import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateSupermemoryPiMcpRuntime } from "@deck/adapter-pi";
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


function successfulRuntimeValidation() {
  return Promise.resolve({
    ok: true as const,
    authenticatedRuntimeValidated: true as const,
    path: "redacted-path",
    serverName: "supermemory",
    endpoint: "https://supermemory-new.stlmcp.com",
    toolNames: ["execute", "search_docs"],
    diagnostics: [],
  });
}

function failedRuntimeValidation(code: "unauthenticated" | "timeout", message: string) {
  return Promise.resolve({
    ok: false as const,
    authenticatedRuntimeValidated: false as const,
    path: "redacted-path",
    serverName: "supermemory",
    endpoint: "https://supermemory-new.stlmcp.com",
    diagnostics: [{ code, message }],
  });
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
  test("uses .deck/config.json when no CLI memory flag is supplied but enables Supermemory after authenticated runtime validation", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toBe(false);
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).toContain("Supermemory MCP Adaptive Memory");
        expect(existsSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"))).toBe(true);
        const orchestrator = readFileSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"), "utf-8");
        expect(orchestrator).toContain("Supermemory MCP Adaptive Memory");
        expect(orchestrator).toContain("supermemory.memory");
        expect(orchestrator).not.toContain(SENTINEL_TOKEN);
        expect(orchestrator).not.toContain("x-supermemory-api-key");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("failed Supermemory validation overwrites stale generated agent files without Supermemory tools", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const first = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });
      expect(first.status).toBe("ready");
      expect(readFileSync(join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"), "utf-8")).toContain("supermemory.memory");

      const second = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        supermemoryRuntimeValidator: () => failedRuntimeValidation("unauthenticated", `bad token ${SENTINEL_TOKEN}`),
      });

      expect(second.status).toBe("ready");
      if (second.status === "ready") {
        expect(second.memoryDiagnostics.some((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toBe(true);
        const agentFiles = readdirSync(join(projectRoot, ".pi", "agents")).filter((name) => name.endsWith(".md"));
        expect(agentFiles.length).toBeGreaterThan(0);
        for (const agentFile of agentFiles) {
          const content = readFileSync(join(projectRoot, ".pi", "agents", agentFile), "utf-8");
          expect(content).not.toContain("Supermemory MCP Adaptive Memory");
          expect(content).not.toContain("supermemory.execute");
          expect(content).not.toContain("supermemory.search_docs");
        }
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("CLI provider overrides .deck/config.json and does not double-inject providers", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
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

  test("CLI none overrides active Supermemory config", async () => {
    const projectRoot = createTempDir();
    try {
      writeDeckConfig(projectRoot, "supermemory");

      const result = await runPiLaunch({
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

  test("missing Pi MCP config falls back to no adaptive-memory injection with redacted warning", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");

      const result = await runPiLaunch({
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
        const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md");
        expect(existsSync(orchestratorPath)).toBe(true);
        const orchestrator = readFileSync(orchestratorPath, "utf-8");
        expect(orchestrator).not.toContain("Supermemory MCP Adaptive Memory");
        expect(orchestrator).not.toContain("supermemory.execute");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("malformed Pi MCP config falls back without leaking token or header values", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      mkdirSync(join(piMcpConfigPath, ".."), { recursive: true });
      writeFileSync(piMcpConfigPath, `{ "headers": { "x-supermemory-api-key": "${SENTINEL_TOKEN}" }`, "utf-8");

      const result = await runPiLaunch({
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


  test("runtime auth failure emits one redacted unavailable diagnostic", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        supermemoryRuntimeValidator: () => failedRuntimeValidation("unauthenticated", `bad token ${SENTINEL_TOKEN}`),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const unavailable = result.memoryDiagnostics.filter((diagnostic) => diagnostic.code === "memory_provider_unavailable");
        expect(unavailable).toHaveLength(1);
        expect(JSON.stringify(unavailable)).not.toContain(SENTINEL_TOKEN);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("runtime validator redacts exact configured token before launch diagnostics", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        supermemoryRuntimeValidator: (options) => validateSupermemoryPiMcpRuntime({
          ...options,
          fetch: (async () => { throw new Error(SENTINEL_TOKEN); }) as unknown as typeof fetch,
        }),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).toContain("memory_provider_unavailable");
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("runtime timeout emits one redacted unavailable diagnostic", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writeDeckConfig(projectRoot, "supermemory");
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpConfigPath,
        supermemoryRuntimeValidator: () => failedRuntimeValidation("timeout", "Supermemory runtime validation timed out."),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.filter((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toHaveLength(1);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("incomplete Supermemory Deck config launches without adaptive-memory injection", async () => {
    const projectRoot = createTempDir();
    try {
      mkdirSync(join(projectRoot, ".deck"), { recursive: true });
      writeFileSync(
        join(projectRoot, ".deck", "config.json"),
        JSON.stringify({ version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }),
        "utf-8",
      );

      // Use piMcpHomeDir to point to a fake home so the Pi MCP config doesn't exist,
      // isolating the test to the incomplete Supermemory config in .deck/config.json.
      const fakeHome = join(projectRoot, ".fake-pi-home");

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        piMcpHomeDir: fakeHome,
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

  test("preconstructed provider cannot be combined with CLI/config resolution", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
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
