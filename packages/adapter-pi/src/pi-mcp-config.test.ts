import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import * as adapterPi from "./index";

import {
  defaultPiMcpConfigPath,
  redactPiMcpConfigDiagnosticText,
  writeCodebaseMemoryMcpConfig,
  writeContextModeMcpConfig,
  writeEvidenceGatedSerenaMcpConfig,
  writeGatedLocalMcpConfig,
  writeLocalMcpConfig,
  writeSerenaMcpConfig,
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
const SERENA_ARGS = ["start-mcp-server", "--context", "ide", "--project-from-cwd", "--open-web-dashboard", "false"] as const;
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
  test("creates the exact absolute-path command and six fixed arguments atomically", async () => {
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

  test("upgrades the previous Deck Serena command, preserves unrelated MCP entries, and is idempotent", async () => {
    const configPath = "/fixtures/pi/mcp.json";
    const original = {
      mcpServers: {
        serena: { command: SERENA_PATH, args: ["start-mcp-server", "--context", "ide", "--project-from-cwd"] },
        filesystem: { command: "npx", args: ["filesystem"] },
      },
      topLevel: "preserved",
    };
    const fixture = memoryFileSystem({ [configPath]: JSON.stringify(original) });

    const first = await writeEvidenceGatedSerenaMcpConfig(serenaWriterOptions(fixture.fileSystem, configPath));
    const second = await writeEvidenceGatedSerenaMcpConfig(serenaWriterOptions(fixture.fileSystem, configPath));
    const written = JSON.parse(fixture.files.get(configPath)!);

    expect(first).toMatchObject({ ok: true, action: "updated" });
    expect(second).toMatchObject({ ok: true, action: "unchanged" });
    expect(fixture.calls.filter((call) => call.startsWith("write:")).length).toBe(1);
    expect(fixture.calls.filter((call) => call.startsWith("rename:")).length).toBe(1);
    expect(written.topLevel).toBe("preserved");
    expect(written.mcpServers.filesystem).toEqual(original.mcpServers.filesystem);
    expect(written.mcpServers.serena).toEqual({ command: SERENA_PATH, args: [...SERENA_ARGS] });
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

      mkdirSync(join(home, ".pi", "agent"), { recursive: true });
      writeFileSync(configPath, JSON.stringify({ mcpServers: { personal: { command: "personal" } } }));

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
      expect(config.mcpServers.personal).toEqual({ command: "personal" });
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

describe("defaultPiMcpConfigPath", () => {
  test("follows PI_CODING_AGENT_DIR when no home is given", () => {
    expect(defaultPiMcpConfigPath(undefined, { PI_CODING_AGENT_DIR: "/opt/pi-home" })).toBe("/opt/pi-home/mcp.json");
  });

  test("an explicit home keeps the conventional location", () => {
    expect(defaultPiMcpConfigPath("/home/tester", { PI_CODING_AGENT_DIR: "/opt/pi-home" })).toBe("/home/tester/.pi/agent/mcp.json");
  });

  test("an invalid override falls back to the default location", () => {
    expect(defaultPiMcpConfigPath(undefined, { PI_CODING_AGENT_DIR: "relative" })).toBe(`${homedir()}/.pi/agent/mcp.json`);
  });
});

test("redacts token-like diagnostic text and header values", () => {
    const redacted = redactPiMcpConfigDiagnosticText(
      `token=${SENTINEL_TOKEN} ${"x-api-key"}: ${SENTINEL_TOKEN} Bearer ${SENTINEL_TOKEN}`,
    );

    expect(redacted).not.toContain(SENTINEL_TOKEN);
    expect(redacted).toContain("[REDACTED]");
  });
test("redacts quoted JSON, env-style, authorization, and bearer secrets", () => {
    const redacted = redactPiMcpConfigDiagnosticText(
      JSON.stringify({
        headers: {
          ["x-api-key"]: SENTINEL_TOKEN,
          Authorization: `Bearer ${SENTINEL_TOKEN}`,
        },
        token: SENTINEL_TOKEN,
        apiKey: SENTINEL_TOKEN,
      }) + ` EXTERNAL_API_KEY=${SENTINEL_TOKEN}`,
    );

    expect(redacted).not.toContain(SENTINEL_TOKEN);
    expect(redacted).toContain("[REDACTED]");
  });
