import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as adapterPi from "./index";

import {
  SUPERMEMORY_API_KEY_HEADER,
  SUPERMEMORY_MCP_URL,
  defaultPiMcpConfigPath,
  extractValidatedSupermemoryPiMcpServer,
  redactPiMcpConfigDiagnosticText,
  writeCodebaseMemoryMcpConfig,
  writeContextModeMcpConfig,
  writeEvidenceGatedSerenaMcpConfig,
  writeGatedLocalMcpConfig,
  writeLocalMcpConfig,
  writeSerenaMcpConfig,
  writeSupermemoryPiMcpConfig,
} from "./pi-mcp-config";
import type { SerenaReadinessEvidence } from "@deck/core";

const SENTINEL_TOKEN = "sm_test_DO_NOT_LEAK_123456789";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "deck-pi-mcp-test-"));
}

function cleanup(path: string) {
  rmSync(path, { recursive: true, force: true });
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function allDiagnosticsText(value: unknown): string {
  return JSON.stringify(value);
}

const SERENA_ROOT = "/fixtures/deck-data/tools/serena";
const SERENA_PATH = `${SERENA_ROOT}/bin/serena`;
const SERENA_ARGS = ["start-mcp-server", "--context", "ide", "--project-from-cwd"] as const;
const SERENA_AUTHORIZATION = {
  kind: "interactive-tui-explicit-selection" as const,
  runner: "pi" as const,
  operationId: "pi-operation-1",
};
const SERENA_OPERATION = {
  runner: "pi" as const,
  operationId: "pi-operation-1",
  explicitlySelected: true as const,
};
const SERENA_EVIDENCE = {
  capabilityId: "serena" as const,
  state: "ready" as const,
  resolvedExecutablePath: SERENA_PATH,
  source: "installed-deck-tool" as const,
  probe: "serena-help" as const,
  fingerprint: "serena-fingerprint-1",
};

function memoryFileSystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const calls: string[] = [];
  const fileSystem = {
    existsSync: (path: string) => files.has(path),
    readFileSync: (path: string) => {
      calls.push(`read:${path}`);
      const content = files.get(path);
      if (content === undefined) throw new Error("missing fixture");
      return content;
    },
    mkdirSync: (path: string) => {
      calls.push(`mkdir:${path}`);
    },
    writeFileSync: (path: string, content: string) => {
      calls.push(`write:${path}`);
      files.set(path, content);
    },
    renameSync: (from: string, to: string) => {
      calls.push(`rename:${from}:${to}`);
      const content = files.get(from);
      if (content === undefined) throw new Error("missing temporary fixture");
      files.delete(from);
      files.set(to, content);
    },
    rmSync: (path: string) => {
      calls.push(`remove:${path}`);
      files.delete(path);
    },
  };
  return { files, calls, fileSystem };
}

function serenaWriterOptions(fileSystem: ReturnType<typeof memoryFileSystem>["fileSystem"], configPath = "/fixtures/pi/mcp.json") {
  return {
    authorization: SERENA_AUTHORIZATION,
    operation: SERENA_OPERATION,
    readiness: SERENA_EVIDENCE,
    command: SERENA_PATH,
    args: SERENA_ARGS,
    ownedRoot: SERENA_ROOT,
    configPath,
    fileSystem,
    revalidate: async (evidence: SerenaReadinessEvidence) => ({ valid: true as const, evidence }),
  };
}

describe("Pi Serena MCP config writer", () => {
  test("creates the exact absolute-path command and four fixed arguments atomically", async () => {
    const fixture = memoryFileSystem();
    const result = await writeEvidenceGatedSerenaMcpConfig(serenaWriterOptions(fixture.fileSystem));

    expect(result).toMatchObject({ ok: true, action: "created", serverName: "serena" });
    expect(JSON.parse(fixture.files.get("/fixtures/pi/mcp.json")!)).toEqual({
      mcpServers: {
        serena: {
          command: SERENA_PATH,
          args: [...SERENA_ARGS],
        },
      },
    });
    expect(fixture.calls.some((call) => call.startsWith("write:"))).toBe(true);
    expect(fixture.calls.some((call) => call.startsWith("rename:"))).toBe(true);
  });

  test("returns unchanged without a write for equivalent known-good Serena config", async () => {
    const configPath = "/fixtures/pi/mcp.json";
    const fixture = memoryFileSystem({
      [configPath]: JSON.stringify({
        mcpServers: { serena: { command: SERENA_PATH, args: [...SERENA_ARGS] } },
        unrelated: { keep: true },
      }),
    });

    const result = await writeEvidenceGatedSerenaMcpConfig(serenaWriterOptions(fixture.fileSystem, configPath));

    expect(result).toMatchObject({ ok: true, action: "unchanged" });
    expect(fixture.calls.some((call) => call.startsWith("write:"))).toBe(false);
    expect(fixture.calls.some((call) => call.startsWith("rename:"))).toBe(false);
  });

  test("updates a legacy bare Serena entry while preserving unrelated config", async () => {
    const configPath = "/fixtures/pi/mcp.json";
    const original = {
      mcpServers: {
        serena: { command: "serena", legacy: true },
        filesystem: { command: "npx", args: ["filesystem"] },
      },
      topLevel: "preserved",
    };
    const fixture = memoryFileSystem({ [configPath]: JSON.stringify(original) });

    const result = await writeEvidenceGatedSerenaMcpConfig(serenaWriterOptions(fixture.fileSystem, configPath));
    const written = JSON.parse(fixture.files.get(configPath)!);

    expect(result).toMatchObject({ ok: true, action: "updated" });
    expect(written.topLevel).toBe("preserved");
    expect(written.mcpServers.filesystem).toEqual(original.mcpServers.filesystem);
    expect(written.mcpServers.serena).toEqual({ command: SERENA_PATH, args: [...SERENA_ARGS], legacy: true });
  });

  test("preserves malformed config and rejects unsafe command or exact-argument drift", async () => {
    const malformedPath = "/fixtures/pi/malformed.json";
    const malformed = memoryFileSystem({ [malformedPath]: "{not-json" });
    const malformedResult = await writeEvidenceGatedSerenaMcpConfig(serenaWriterOptions(malformed.fileSystem, malformedPath));
    expect(malformedResult).toMatchObject({ ok: false, action: "failed" });
    expect(malformed.files.get(malformedPath)).toBe("{not-json");
    expect(malformed.calls.some((call) => call.startsWith("write:"))).toBe(false);

    const unsafe = await writeEvidenceGatedSerenaMcpConfig({
      ...serenaWriterOptions(memoryFileSystem().fileSystem),
      command: "../serena",
    });
    expect(unsafe).toMatchObject({ ok: false, action: "failed" });

    const outsideRoot = await writeEvidenceGatedSerenaMcpConfig({
      ...serenaWriterOptions(memoryFileSystem().fileSystem),
      readiness: { ...SERENA_EVIDENCE, resolvedExecutablePath: "/outside/bin/serena" },
      command: "/outside/bin/serena",
      ownedRoot: SERENA_ROOT,
    });
    expect(outsideRoot).toMatchObject({ ok: false, action: "failed" });

    const wrongArgs = await writeEvidenceGatedSerenaMcpConfig({
      ...serenaWriterOptions(memoryFileSystem().fileSystem),
      args: ["serena"] as unknown as typeof SERENA_ARGS,
    });
    expect(wrongArgs).toMatchObject({ ok: false, action: "failed" });
  });

  test("does not call the writer when immediate same-path/fingerprint revalidation is stale", async () => {
    const fixture = memoryFileSystem();
    const result = await writeEvidenceGatedSerenaMcpConfig({
      ...serenaWriterOptions(fixture.fileSystem),
      revalidate: async (evidence) => ({
        valid: true as const,
        evidence: { ...evidence, fingerprint: "changed-fingerprint" },
      }),
    });

    expect(result).toMatchObject({ ok: false, action: "failed" });
    expect(fixture.calls.some((call) => call.startsWith("write:"))).toBe(false);
    expect(fixture.calls.some((call) => call.startsWith("rename:"))).toBe(false);
  });

  test("legacy compatibility calls cannot claim success or write Serena", () => {
    const result = writeSerenaMcpConfig();
    expect(result).toMatchObject({ ok: false, action: "failed" });
  });
});

describe("Pi global MCP config writer", () => {
  test("resolves default Pi MCP config path under the provided home directory", () => {
    const home = "/tmp/example-home";
    expect(defaultPiMcpConfigPath(home)).toBe(join(home, ".pi", "agent", "mcp.json"));
  });

  test("creates ~/.pi/agent/mcp.json with the Supermemory server entry", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("created");
      expect(result.path).toBe(configPath);
      expect(result.serverName).toBe("supermemory");
      expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);

      const config = readJson(configPath);
      expect(config).toEqual({
        mcpServers: {
          supermemory: {
            transport: "http",
            url: SUPERMEMORY_MCP_URL,
            headers: {
              "x-sm-project": "sm_project_v1_kevin15011_deck",
              [SUPERMEMORY_API_KEY_HEADER]: SENTINEL_TOKEN,
            },
          },
        },
      });
    } finally {
      cleanup(home);
    }
  });

  test("preserves unrelated servers while updating only the configured server", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(
        configPath,
        JSON.stringify(
          {
            mcpServers: {
              filesystem: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-filesystem"],
              },
              supermemory: {
                transport: "http",
                url: "https://old.example.invalid",
                headers: {
                  "x-existing-header": "keep-me",
                  [SUPERMEMORY_API_KEY_HEADER]: "old-token",
                },
                extraSetting: true,
              },
            },
            topLevel: "preserved",
          },
          null,
          2,
        ),
      );

      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });
      expect(result.ok).toBe(true);
      expect(result.action).toBe("updated");
      expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);

      const config = readJson(configPath);
      expect(config.topLevel).toBe("preserved");
      expect(config.mcpServers.filesystem).toEqual({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
      });
      expect(config.mcpServers.supermemory.extraSetting).toBe(true);
      expect(config.mcpServers.supermemory.transport).toBe("http");
      expect(config.mcpServers.supermemory.url).toBe(SUPERMEMORY_MCP_URL);
      expect(config.mcpServers.supermemory.headers["x-existing-header"]).toBe("keep-me");
      expect(config.mcpServers.supermemory.headers["x-sm-project"]).toBe("sm_project_v1_kevin15011_deck");
      expect(config.mcpServers.supermemory.headers[SUPERMEMORY_API_KEY_HEADER]).toBe(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });

  test("supports a configured server name", () => {
    const home = tempHome();
    try {
      const result = writeSupermemoryPiMcpConfig({
        homeDir: home,
        token: SENTINEL_TOKEN,
        serverName: "team-supermemory",
        projectScope: "sm_project_v1_kevin15011_deck",
      });

      expect(result.ok).toBe(true);
      expect(result.serverName).toBe("team-supermemory");
      const config = readJson(defaultPiMcpConfigPath(home));
      expect(config.mcpServers.supermemory).toBeUndefined();
      expect(config.mcpServers["team-supermemory"].headers[SUPERMEMORY_API_KEY_HEADER]).toBe(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });

  test("fails closed on malformed JSON without partial writes", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      const original = "{ this is not json";
      writeFileSync(configPath, original);

      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });

      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_MALFORMED");
      expect(readFileSync(configPath, "utf-8")).toBe(original);
      expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });

  test("fails closed on conflicting config shapes without overwriting existing file", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      const originalConfig = { mcpServers: { supermemory: { headers: "not-an-object" } } };
      writeFileSync(configPath, JSON.stringify(originalConfig, null, 2));

      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });

      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_CONFLICT");
      expect(readJson(configPath)).toEqual(originalConfig);
      expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });

  test("returns unchanged when the existing entry already matches", () => {
    const home = tempHome();
    try {
      const first = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });
      const second = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.action).toBe("unchanged");
      expect(allDiagnosticsText(second)).not.toContain(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });

  test("attempts restrictive directory and file permissions where supported", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });

      expect(result.ok).toBe(true);
      expect(existsSync(configPath)).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(join(home, ".pi", "agent")).mode & 0o777).toBe(0o700);
        expect(statSync(configPath).mode & 0o777).toBe(0o600);
      }
    } finally {
      cleanup(home);
    }
  });

  test("does not export secret-bearing runtime server extraction from public adapter API", () => {
    expect("extractValidatedSupermemoryPiMcpRuntimeServer" in adapterPi).toBe(false);
  });

  test("extracts validated Supermemory server endpoint without credentials", () => {
    const home = tempHome();
    try {
      writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });
      const server = extractValidatedSupermemoryPiMcpServer({ homeDir: home });

      expect(server).toEqual({
        path: defaultPiMcpConfigPath(home),
        serverName: "supermemory",
        endpoint: SUPERMEMORY_MCP_URL,
      });
      expect(JSON.stringify(server)).not.toContain(SENTINEL_TOKEN);
      expect(JSON.stringify(server)).not.toContain(SUPERMEMORY_API_KEY_HEADER);
    } finally {
      cleanup(home);
    }
  });

  test("redacts token-like diagnostic text and header values", () => {
    const redacted = redactPiMcpConfigDiagnosticText(
      `token=${SENTINEL_TOKEN} ${SUPERMEMORY_API_KEY_HEADER}: ${SENTINEL_TOKEN} Bearer ${SENTINEL_TOKEN}`,
    );

    expect(redacted).not.toContain(SENTINEL_TOKEN);
    expect(redacted).toContain("[REDACTED]");
  });

  test("redacts quoted JSON, env-style, authorization, and bearer secrets", () => {
    const redacted = redactPiMcpConfigDiagnosticText(
      JSON.stringify({
        headers: {
          [SUPERMEMORY_API_KEY_HEADER]: SENTINEL_TOKEN,
          Authorization: `Bearer ${SENTINEL_TOKEN}`,
        },
        token: SENTINEL_TOKEN,
        apiKey: SENTINEL_TOKEN,
      }) + ` SUPERMEMORY_API_KEY=${SENTINEL_TOKEN}`,
    );

    expect(redacted).not.toContain(SENTINEL_TOKEN);
    expect(redacted).toContain("[REDACTED]");
  });

  test("rejects blank tokens without writing config", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: "   ", projectScope: "sm_project_v1_kevin15011_deck" });

      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(existsSync(configPath)).toBe(false);
      expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });

  test("fails closed without canonical project scope and writes no Supermemory config", () => {
    const home = tempHome();
    const configPath = join(home, ".pi", "agent", "mcp.json");

    const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN } as any);

    expect(result.ok).toBe(false);
    expect(result.action).toBe("failed");
    expect(existsSync(configPath)).toBe(false);
    expect(allDiagnosticsText(result)).toContain("Canonical x-sm-project");
    expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);
  });

  test("rejects invalid project scope overrides", () => {
    const home = tempHome();
    const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_default" });

    expect(result.ok).toBe(false);
    expect(result.action).toBe("failed");
  });

  test("validation rejects legacy non-canonical project scope headers", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(configPath, JSON.stringify({
        mcpServers: {
          supermemory: {
            transport: "http",
            url: SUPERMEMORY_MCP_URL,
            headers: { "x-sm-project": "sm_project_default", [SUPERMEMORY_API_KEY_HEADER]: SENTINEL_TOKEN },
          },
        },
      }));

      const result = extractValidatedSupermemoryPiMcpServer({ homeDir: home });
      expect(result).toBeUndefined();
    } catch (error) {
      expect(String(error)).toContain("canonical x-sm-project");
    } finally {
      cleanup(home);
    }
  });
});

// ---------------------------------------------------------------------------
// Healthcheck-gated local MCP config write tests
// REQ-PI-003, REQ-CBM-002: Gate config writes behind binary usability check
// ---------------------------------------------------------------------------

describe("writeGatedLocalMcpConfig", () => {
  test("does NOT write config when binary is missing", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck returns "missing"
      const result = await writeGatedLocalMcpConfig({
        command: "definitely-not-a-real-command-12345",
        serverName: "context-mode",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "missing" as const,
          command: "definitely-not-a-real-command-12345",
          reason: "Command not found in PATH",
        }),
      });

      // Config should NOT be written
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(existsSync(configPath)).toBe(false);
      expect(result.diagnostics[0]?.message).toContain("not found in PATH");
    } finally {
      cleanup(home);
    }
  });

  test("does NOT write config when binary is unusable (exists but fails healthcheck)", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck returns "unusable"
      const result = await writeGatedLocalMcpConfig({
        command: "broken-binary",
        serverName: "codebase-memory",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "unusable" as const,
          command: "broken-binary",
          reason: "Command exists but failed healthcheck: exit code 1",
        }),
      });

      // Config should NOT be written
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(existsSync(configPath)).toBe(false);
      expect(result.diagnostics[0]?.message).toContain("failed healthcheck");
    } finally {
      cleanup(home);
    }
  });

  test("does NOT write config when binary is blocked", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck returns "blocked"
      const result = await writeGatedLocalMcpConfig({
        command: "blocked-binary",
        serverName: "context-mode",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "blocked" as const,
          command: "blocked-binary",
          reason: "Binary is blocked by system policy",
        }),
      });

      // Config should NOT be written
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(existsSync(configPath)).toBe(false);
      expect(result.diagnostics[0]?.message).toContain("blocked");
    } finally {
      cleanup(home);
    }
  });

  test("WRITES config when binary is ready (healthcheck passes)", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck returns "ready"
      const result = await writeGatedLocalMcpConfig({
        command: "context-mode",
        serverName: "context-mode",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "ready" as const,
          command: "context-mode",
          version: "1.0.0",
        }),
      });

      // Config SHOULD be written
      expect(result.ok).toBe(true);
      expect(result.action).toBe("created");
      expect(existsSync(configPath)).toBe(true);

      const config = readJson(configPath);
      expect(config.mcpServers["context-mode"]).toEqual({
        command: "context-mode",
        args: [],
        env: {},
        transport: "process",
      });
    } finally {
      cleanup(home);
    }
  });

  test("writes config with correct shape for codebase-memory-mcp", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      const result = await writeGatedLocalMcpConfig({
        command: "codebase-memory-mcp",
        serverName: "codebase-memory",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "ready" as const,
          command: "codebase-memory-mcp",
          version: "2.1.0",
        }),
      });

      expect(result.ok).toBe(true);
      expect(result.serverName).toBe("codebase-memory");

      const config = readJson(configPath);
      expect(config.mcpServers["codebase-memory"].command).toBe("codebase-memory-mcp");
    } finally {
      cleanup(home);
    }
  });

  test("updates existing config when binary is ready (not first time)", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // First write: create initial config
      await writeGatedLocalMcpConfig({
        command: "context-mode",
        serverName: "context-mode",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "ready" as const,
          command: "context-mode",
          version: "1.0.0",
        }),
      });

      // Second write: update with new args
      const result = await writeGatedLocalMcpConfig({
        command: "context-mode",
        serverName: "context-mode",
        args: ["--verbose"],
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "ready" as const,
          command: "context-mode",
          version: "1.0.0",
        }),
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("updated");

      const config = readJson(configPath);
      expect(config.mcpServers["context-mode"].args).toEqual(["--verbose"]);
    } finally {
      cleanup(home);
    }
  });

  test("preserves unrelated servers when updating gated config", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // First create a Supermemory config
      writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN, projectScope: "sm_project_v1_kevin15011_deck" });

      // Then add context-mode via gated write
      const result = await writeGatedLocalMcpConfig({
        command: "context-mode",
        serverName: "context-mode",
        configPath,
        homeDir: home,
        healthcheck: async () => ({
          status: "ready" as const,
          command: "context-mode",
          version: "1.0.0",
        }),
      });

      expect(result.ok).toBe(true);

      const config = readJson(configPath);
      // Both servers should exist
      expect(config.mcpServers.supermemory).toBeDefined();
      expect(config.mcpServers["context-mode"]).toBeDefined();
    } finally {
      cleanup(home);
    }
  });
});

// ---------------------------------------------------------------------------
// writeLocalMcpConfig (ungated) tests - baseline comparison
// ---------------------------------------------------------------------------

describe("writeLocalMcpConfig (ungated baseline)", () => {
  test("writes config regardless of binary existence (ungated)", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // This writes config even though the command doesn't exist
      const result = writeLocalMcpConfig({
        command: "definitely-not-a-real-command-99999",
        serverName: "test-server",
        configPath,
        homeDir: home,
      });

      // Un gated - config IS written (for runtime validation)
      expect(result.ok).toBe(true);
      expect(result.action).toBe("created");
      expect(existsSync(configPath)).toBe(true);
    } finally {
      cleanup(home);
    }
  });
});

// ---------------------------------------------------------------------------
// Production path: writeContextModeMcpConfig - GATED with healthcheck
// ---------------------------------------------------------------------------

describe("writeContextModeMcpConfig (production path - gated)", () => {
  test("DOES NOT write config when healthcheck returns missing", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates missing binary
      const healthcheckMissing = async () => ({
        status: "missing" as const,
        command: "context-mode",
        reason: "Binary not found in PATH",
      });

      const result = await writeContextModeMcpConfig(
        { configPath, homeDir: home },
        healthcheckMissing,
      );

      // Gated - config is NOT written when binary is missing
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_WRITE_FAILED");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("DOES NOT write config when healthcheck returns unusable", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates unusable binary
      const healthcheckUnusable = async () => ({
        status: "unusable" as const,
        command: "context-mode",
        reason: "Binary failed --version check",
      });

      const result = await writeContextModeMcpConfig(
        { configPath, homeDir: home },
        healthcheckUnusable,
      );

      // Gated - config is NOT written when binary is unusable
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_WRITE_FAILED");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("DOES NOT write config when healthcheck returns blocked", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates blocked binary
      const healthcheckBlocked = async () => ({
        status: "blocked" as const,
        command: "context-mode",
        reason: "Binary permission denied",
      });

      const result = await writeContextModeMcpConfig(
        { configPath, homeDir: home },
        healthcheckBlocked,
      );

      // Gated - config is NOT written when binary is blocked
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_WRITE_FAILED");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("WRITES config when healthcheck returns ready", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates ready binary
      const healthcheckReady = async () => ({
        status: "ready" as const,
        command: "context-mode",
        version: "1.0.0",
      });

      const result = await writeContextModeMcpConfig(
        { configPath, homeDir: home },
        healthcheckReady,
      );

      // Gated but ready - config IS written
      expect(result.ok).toBe(true);
      expect(result.action).toBe("created");
      expect(existsSync(configPath)).toBe(true);

      const config = readJson(configPath);
      expect(config.mcpServers["context-mode"]).toBeDefined();
      expect(config.mcpServers["context-mode"].command).toBe("context-mode");
    } finally {
      cleanup(home);
    }
  });
});

// ---------------------------------------------------------------------------
// Production path: writeCodebaseMemoryMcpConfig - GATED with healthcheck
// ---------------------------------------------------------------------------

describe("writeCodebaseMemoryMcpConfig (production path - gated)", () => {
  test("DOES NOT write config when healthcheck returns missing", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates missing binary
      const healthcheckMissing = async () => ({
        status: "missing" as const,
        command: "codebase-memory-mcp",
        reason: "Binary not found in PATH",
      });

      const result = await writeCodebaseMemoryMcpConfig(
        { configPath, homeDir: home },
        healthcheckMissing,
      );

      // Gated - config is NOT written when binary is missing
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_WRITE_FAILED");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("DOES NOT write config when healthcheck returns unusable", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates unusable binary
      const healthcheckUnusable = async () => ({
        status: "unusable" as const,
        command: "codebase-memory-mcp",
        reason: "Binary failed --version check",
      });

      const result = await writeCodebaseMemoryMcpConfig(
        { configPath, homeDir: home },
        healthcheckUnusable,
      );

      // Gated - config is NOT written when binary is unusable
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_WRITE_FAILED");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("DOES NOT write config when healthcheck returns blocked", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates blocked binary
      const healthcheckBlocked = async () => ({
        status: "blocked" as const,
        command: "codebase-memory-mcp",
        reason: "Binary permission denied",
      });

      const result = await writeCodebaseMemoryMcpConfig(
        { configPath, homeDir: home },
        healthcheckBlocked,
      );

      // Gated - config is NOT written when binary is blocked
      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(result.diagnostics[0]?.code).toBe("PI_MCP_CONFIG_WRITE_FAILED");
      expect(existsSync(configPath)).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("WRITES config when healthcheck returns ready", async () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);

      // Healthcheck simulates ready binary
      const healthcheckReady = async () => ({
        status: "ready" as const,
        command: "codebase-memory-mcp",
        version: "2.0.0",
      });

      const result = await writeCodebaseMemoryMcpConfig(
        { configPath, homeDir: home },
        healthcheckReady,
      );

      // Gated but ready - config IS written
      expect(result.ok).toBe(true);
      expect(result.action).toBe("created");
      expect(existsSync(configPath)).toBe(true);

      const config = readJson(configPath);
      expect(config.mcpServers["codebase-memory"]).toBeDefined();
      expect(config.mcpServers["codebase-memory"].command).toBe("codebase-memory-mcp");
    } finally {
      cleanup(home);
    }
  });
});
