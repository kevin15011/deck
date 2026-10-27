import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { validateSupermemoryPiMcpRuntime } from "@deck/adapter-pi";
import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";
import { validateDeckConfig } from "@deck/core";
import { runPiLaunch } from "./pi-launch-command";

const SENTINEL_TOKEN = "supermemory-test-token-should-not-appear";

function createTempDir(prefix = "deck-supermemory-launch-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function initCanonicalRemote(projectRoot: string) {
  execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
}

function writePiMcpConfig(configPath: string, _token = SENTINEL_TOKEN, projectScope = "sm_project_v1_kevin15011_deck") {
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        mcpServers: {
          supermemory: {
            transport: "http",
            url: "https://mcp.supermemory.ai/mcp",
            headers: { "x-sm-project": projectScope },
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
    endpoint: "https://mcp.supermemory.ai/mcp",
    toolNames: ["memory", "recall"],
    diagnostics: [],
  });
}

function failedRuntimeValidation(code: "unauthenticated" | "timeout", message: string) {
  return Promise.resolve({
    ok: false as const,
    authenticatedRuntimeValidated: false as const,
    path: "redacted-path",
    serverName: "supermemory",
    endpoint: "https://mcp.supermemory.ai/mcp",
    diagnostics: [{ code, message }],
  });
}

function hermeticSupermemoryRuntime(projectRoot: string): { stateHome: string; transport: SupermemoryRuntimeTransport } {
  return {
    stateHome: join(projectRoot, ".state"),
    transport: {
      async health() {},
      async profile() { return { profile: { static: ["Hermetic test profile."] } }; },
      async search() { return { results: [] }; },
      async add() {},
    },
  };
}

function deckConfig(activeProvider: "none" | "supermemory" = "none") {
  return validateDeckConfig({
    version: 1,
    adaptiveMemory: {
      activeProvider,
      supermemory: {
        mcpServerName: "supermemory",
        searchMode: "memories",
        maxMemoriesPerSession: 7,
      },
    },
  });
}

describe("runPiLaunch Supermemory provider resolution", () => {
  test("uses injected global Deck config when no CLI memory flag is supplied and enables Supermemory after authenticated runtime validation", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      initCanonicalRemote(projectRoot);
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toBe(false);
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).toContain("Supermemory Runtime Conversation Memory");
        expect(systemPrompt).toContain("Deck Runtime binds the verified project scope server-side");
        expect(systemPrompt).toContain("schemas permit model-selected project scope");
        expect(systemPrompt).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(systemPrompt).not.toContain("supermemory_search_memory");
        expect(systemPrompt).not.toContain("supermemory.memory");
        expect(systemPrompt).not.toContain("memory` (action");
        expect(existsSync(join(projectRoot, ".pi", "agents", "deck-lead.md"))).toBe(true);
        const orchestrator = readFileSync(join(projectRoot, ".pi", "agents", "deck-lead.md"), "utf-8");
        expect(orchestrator).toContain("Supermemory Runtime Conversation Memory");
        expect(orchestrator).toContain("Deck Runtime binds the verified project scope server-side");
        expect(orchestrator).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(orchestrator).not.toContain("supermemory_search_memory");
        expect(orchestrator).not.toContain("supermemory_add_memory");
        expect(orchestrator).not.toContain("supermemory.memory");
        expect(orchestrator).not.toContain(SENTINEL_TOKEN);
        expect(orchestrator).not.toContain("x-supermemory-api-key");
        const standaloneSkill = readFileSync(join(projectRoot, ".pi", "skills", "api-and-interface-design", "SKILL.md"), "utf-8");
        const bootstrapSkill = readFileSync(join(projectRoot, ".pi", "skills", "deck-onboard", "SKILL.md"), "utf-8");
        for (const content of [standaloneSkill, bootstrapSkill]) {
          expect(content).toContain("Runtime-managed recall and capture bind project scope server-side");
          expect(content).toContain("schemas permit model-selected project scope");
          expect(content).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
          expect(content).not.toContain("supermemory_search_memory");
          expect(content).not.toContain("No manual containerTag required");
          expect(content).not.toContain("sm_project_default");
        }
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("failed Supermemory validation overwrites stale generated agent files without Supermemory tools", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      initCanonicalRemote(projectRoot);
      writePiMcpConfig(piMcpConfigPath);

      const first = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });
      expect(first.status).toBe("ready");
      expect(readFileSync(join(projectRoot, ".pi", "agents", "deck-lead.md"), "utf-8")).toContain("Supermemory Runtime Conversation Memory");

      const second = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
        supermemoryRuntimeValidator: () => failedRuntimeValidation("unauthenticated", `bad token ${SENTINEL_TOKEN}`),
      });

      expect(second.status).toBe("ready");
      if (second.status === "ready") {
        expect(second.memoryDiagnostics.some((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toBe(true);
        const agentFiles = readdirSync(join(projectRoot, ".pi", "agents")).filter((name) => name.endsWith(".md"));
        expect(agentFiles.length).toBeGreaterThan(0);
        for (const agentFile of agentFiles) {
          const content = readFileSync(join(projectRoot, ".pi", "agents", agentFile), "utf-8");
          expect(content).not.toContain("Supermemory Runtime Conversation Memory");
          expect(content).not.toContain("supermemory.execute");
          expect(content).not.toContain("supermemory.search_docs");
        }
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("configured Pi MCP scope mismatch is ignored because Runtime owns project scope", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      initCanonicalRemote(projectRoot);
      writePiMcpConfig(piMcpConfigPath, SENTINEL_TOKEN, "sm_project_v1_other_repo");

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.providerId === "supermemory")).toBe(false);
        const samples = [
          readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8"),
          readFileSync(join(projectRoot, ".pi", "agents", "deck-lead.md"), "utf-8"),
          readFileSync(join(projectRoot, ".pi", "skills", "api-and-interface-design", "SKILL.md"), "utf-8"),
          readFileSync(join(projectRoot, ".pi", "skills", "deck-onboard", "SKILL.md"), "utf-8"),
        ];
        for (const content of samples.slice(1)) {
          expect(content).toContain("Runtime-managed recall and capture bind project scope server-side");
          expect(content).toContain("schemas permit model-selected project scope");
          expect(content).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
          expect(content).not.toContain("sm_project_v1_other_repo");
        }
        expect(samples[0]).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(samples[0]).not.toContain("sm_project_v1_other_repo");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("configured Pi MCP default scope is ignored because Runtime owns project scope", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      initCanonicalRemote(projectRoot);
      writePiMcpConfig(piMcpConfigPath, SENTINEL_TOKEN, "sm_project_default");

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.providerId === "supermemory")).toBe(false);
        const samples = [
          readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8"),
          readFileSync(join(projectRoot, ".pi", "agents", "deck-lead.md"), "utf-8"),
          readFileSync(join(projectRoot, ".pi", "skills", "api-and-interface-design", "SKILL.md"), "utf-8"),
          readFileSync(join(projectRoot, ".pi", "skills", "deck-onboard", "SKILL.md"), "utf-8"),
        ];
        for (const content of samples.slice(1)) {
          expect(content).toContain("Runtime-managed recall and capture bind project scope server-side");
          expect(content).toContain("schemas permit model-selected project scope");
          expect(content).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
          expect(content).not.toContain("sm_project_default");
        }
        expect(samples[0]).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
        expect(samples[0]).not.toContain("sm_project_default");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("CLI Supermemory overrides disabled global Deck config and does not double-inject providers", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      writePiMcpConfig(piMcpConfigPath);
      initCanonicalRemote(projectRoot);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("none"),
        cliMemoryProvider: "supermemory",
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
        supermemoryRuntimeValidator: successfulRuntimeValidation,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).toContain("Supermemory Runtime Conversation Memory");
        expect(systemPrompt).not.toContain("supermemory_search_memory");

        const orchestrator = readFileSync(join(projectRoot, ".pi", "agents", "deck-lead.md"), "utf-8");
        expect(orchestrator).toContain("Supermemory Runtime Conversation Memory");
        expect(orchestrator).not.toContain("supermemory_search_memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("CLI none overrides active Supermemory config", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        cliMemoryProvider: "none",
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Adaptive Memory (provider-injected)");
        expect(existsSync(join(projectRoot, ".pi", "agents", "deck-lead.md"))).toBe(false);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("missing Pi MCP config falls back to no adaptive-memory injection with redacted warning", async () => {
    const projectRoot = createTempDir();
    const piMcpConfigPath = join(projectRoot, "home", ".pi", "agent", "mcp.json");
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.code === "memory_provider_unavailable")).toBe(true);
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        expect(diagnosticText).not.toMatch(/x-supermemory-api-key\s*[:=]\s*[^\s,}]+/i);

        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Conversation Memory");
        const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-lead.md");
        expect(existsSync(orchestratorPath)).toBe(true);
        const orchestrator = readFileSync(orchestratorPath, "utf-8");
        expect(orchestrator).not.toContain("Supermemory MCP Conversation Memory");
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
      mkdirSync(join(piMcpConfigPath, ".."), { recursive: true });
      writeFileSync(piMcpConfigPath, `{ "headers": { "x-supermemory-api-key": "${SENTINEL_TOKEN}" }`, "utf-8");

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        const diagnosticText = JSON.stringify(result.memoryDiagnostics);
        expect(diagnosticText).toContain("memory_provider_unavailable");
        expect(diagnosticText).not.toContain(SENTINEL_TOKEN);
        expect(diagnosticText).not.toMatch(/x-supermemory-api-key\s*[:=]\s*[^\s,}]+/i);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Conversation Memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });


  test("runtime auth failure emits one redacted unavailable diagnostic", async () => {
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
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
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
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
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
      writePiMcpConfig(piMcpConfigPath);

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: deckConfig("supermemory"),
        piMcpConfigPath,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
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

  test("incomplete injected Supermemory Deck config launches without adaptive-memory injection", async () => {
    const projectRoot = createTempDir();
    try {
      // Use piMcpHomeDir to point to a fake home so the Pi MCP config doesn't exist,
      // isolating the test to the incomplete injected Supermemory config.
      const fakeHome = join(projectRoot, ".fake-pi-home");

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        deckConfig: validateDeckConfig({ version: 1, adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } } }),
        piMcpHomeDir: fakeHome,
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics.some((diagnostic) => diagnostic.providerId === "supermemory")).toBe(true);
        const systemPrompt = readFileSync(join(result.profileDir, "system-prompt.md"), "utf-8");
        expect(systemPrompt).not.toContain("Supermemory MCP Conversation Memory");
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
        deckConfig: deckConfig("none"),
        cliMemoryProvider: "supermemory",
        supermemoryRuntime: hermeticSupermemoryRuntime(projectRoot),
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
