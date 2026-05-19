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
  writeSupermemoryPiMcpConfig,
} from "./pi-mcp-config";

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

describe("Pi global MCP config writer", () => {
  test("resolves default Pi MCP config path under the provided home directory", () => {
    const home = "/tmp/example-home";
    expect(defaultPiMcpConfigPath(home)).toBe(join(home, ".pi", "agent", "mcp.json"));
  });

  test("creates ~/.pi/agent/mcp.json with the Supermemory server entry", () => {
    const home = tempHome();
    try {
      const configPath = defaultPiMcpConfigPath(home);
      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });

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

      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });
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

      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });

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

      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });

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
      const first = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });
      const second = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });

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
      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });

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
      writeSupermemoryPiMcpConfig({ homeDir: home, token: SENTINEL_TOKEN });
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
      const result = writeSupermemoryPiMcpConfig({ homeDir: home, token: "   " });

      expect(result.ok).toBe(false);
      expect(result.action).toBe("failed");
      expect(existsSync(configPath)).toBe(false);
      expect(allDiagnosticsText(result)).not.toContain(SENTINEL_TOKEN);
    } finally {
      cleanup(home);
    }
  });
});
