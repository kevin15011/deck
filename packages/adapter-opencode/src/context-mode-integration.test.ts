/**
 * Integration tests for the full context-mode capability flow.
 *
 * This test covers:
 * 1. Detects context-mode is not installed (capability-inventory)
 * 2. Generates correct install actions (capability-plan): npm-install + write-mcp-config + migrate-plugin
 * 3. Executes npm install (install-tools)
 * 4. Writes MCP config (opencode-mcp-config)
 * 5. Cleans up legacy plugin entry
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { installOpenCodeTools, type OpenCodeToolInstallResult } from "./install-tools";
import { writeOpenCodeMcpConfig } from "./opencode-mcp-config";
import type { InstallableOpenCodeTool } from "./installation-plan";

function createTempDir(): string {
  const dir = join(tmpdir(), `deck-context-mode-inttest-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("Context-Mode Full Capability Flow Integration", () => {
  let tmpDir: string;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, "opencode.json");
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test("retirement blocks stale install and MCP requests without effects", async () => { writeFileSync(configPath, '{}'); let effects = 0; const [installed] = await installOpenCodeTools('opencode', [{ id: 'context-mode', name: 'Context Mode', module: 'context-mode', required: false, installKind: 'npm-package-plus-mcp' }], () => { }, async () => { effects++; throw new Error('retired install'); }); expect(installed?.success).toBe(false); expect(effects).toBe(0); expect(writeOpenCodeMcpConfig({ configPath, serverName: 'context-mode' } as never).ok).toBe(false); expect(readFileSync(configPath, 'utf8')).toBe('{}'); });

  test("retired writer remains inert on repeated calls", () => { const before = JSON.stringify({ plugin: ['user-plugin'], mcp: { user: { command: ['user'] } } }); writeFileSync(configPath, before); for (let i = 0; i < 2; i++)
      expect(writeOpenCodeMcpConfig({ configPath, serverName: 'context-mode' } as never).ok).toBe(false); expect(readFileSync(configPath, 'utf8')).toBe(before); });

  test("installKind npm-package-plus-mcp is correctly typed and usable", () => {
    // This verifies the type was added correctly
    const planItem: InstallableOpenCodeTool = {
      id: "context-mode",
      name: "Context Mode",
      module: "context-mode",
      required: false,
      installKind: "npm-package-plus-mcp", // must be valid union member
    };

    expect(planItem.installKind).toBe("npm-package-plus-mcp");
    expect(planItem.module).toBe("context-mode");
  });
});

describe("context-mode MCP-only detection", () => {
  let tmpDir: string;
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, "opencode.json");
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test("retired writer preserves ambiguous plugins and RTK configuration", () => { const before = JSON.stringify({ plugin: ['context-mode', 'user-plugin'], mcp: { rtk: { command: ['rtk'] } } }); writeFileSync(configPath, before); expect(writeOpenCodeMcpConfig({ configPath, serverName: 'context-mode' } as never).ok).toBe(false); expect(readFileSync(configPath, 'utf8')).toBe(before); });

  test("retired writer preserves empty arrays and unrelated MCP settings", () => { const before = JSON.stringify({ plugin: [], mcp: { user: { command: ['user'] } } }); writeFileSync(configPath, before); expect(writeOpenCodeMcpConfig({ configPath, serverName: 'context-mode' } as never).ok).toBe(false); expect(readFileSync(configPath, 'utf8')).toBe(before); });
});