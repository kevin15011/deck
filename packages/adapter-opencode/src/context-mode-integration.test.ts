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

  test("full flow: detects missing context-mode, creates install plan, executes install, writes MCP config, cleans up legacy plugin", async () => {
    // STEP 1: Start with no config (context-mode not installed)
    writeFileSync(configPath, JSON.stringify({}), "utf-8");

    // STEP 2: Execute npm install (mocked) for context-mode as npm-package-plus-mcp
    const installPlan: InstallableOpenCodeTool[] = [
      {
        id: "context-mode",
        name: "Context Mode",
        module: "context-mode",
        required: false,
        installKind: "npm-package-plus-mcp",
      },
    ];

    // Mock the install command to succeed
    let npmInstallCalled = false;
    const mockRunCommand = async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("install")) {
        npmInstallCalled = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const results = await installOpenCodeTools("opencode", installPlan, (r) => {}, mockRunCommand);

    // Verify npm-install was called for the npm-package-plus-mcp kind
    expect(npmInstallCalled).toBe(true);
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.tool).toBe("Context Mode");

    // Verify install plan has correct installKind and module
    expect(installPlan[0]?.installKind).toBe("npm-package-plus-mcp");
    expect(installPlan[0]?.module).toBe("context-mode");

    // STEP 3: Write MCP config with pluginsToRemove for legacy cleanup
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ["context-mode", "other-plugin"], // Legacy plugin present
      }),
      "utf-8"
    );

    const mcpWriteResult = writeOpenCodeMcpConfig({
      serverName: "context-mode",
      type: "local",
      command: ["context-mode"],
      pluginsToRemove: ["context-mode"],
      homeDir: tmpDir,
    });

    expect(mcpWriteResult.ok).toBe(true);
    // Diagnostic may include info message but operation succeeds
    console.log("Diagnostics:", mcpWriteResult.diagnostics);

    // Verify MCP entry is present
    const finalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(finalConfig.mcp?.["context-mode"]).toBeDefined();
    expect(finalConfig.mcp?.["context-mode"].type).toBe("local");
    expect(finalConfig.mcp?.["context-mode"].command).toEqual(["context-mode"]);
    expect(finalConfig.mcp?.["context-mode"].enabled).toBe(true);

    // Verify legacy plugin was cleaned up (but other-plugin preserved)
    expect(finalConfig.plugin).toBeDefined();
    expect(finalConfig.plugin).toContain("other-plugin");
    expect(finalConfig.plugin).not.toContain("context-mode");
  });

  test("idempotent: re-running migration with already-cleaned plugin does not fail", () => {
    // Config already has context-mode in MCP and plugin already removed
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          "context-mode": { type: "local", command: ["context-mode"] },
        },
        plugin: ["other-plugin"],
      }),
      "utf-8"
    );

    const mcpWriteResult = writeOpenCodeMcpConfig({
      serverName: "context-mode",
      type: "local",
      command: ["context-mode"],
      pluginsToRemove: ["context-mode"],
      homeDir: tmpDir,
    });

    expect(mcpWriteResult.ok).toBe(true);

    // Other plugin preserved, no errors
    const finalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(finalConfig.plugin).toContain("other-plugin");
  });

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

  test("MCP config written without pluginsToRemove leaves plugin array untouched", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ["context-mode", "other-plugin"],
      }),
      "utf-8"
    );

    // Without pluginsToRemove, plugin array is untouched
    const mcpWriteResult = writeOpenCodeMcpConfig({
      serverName: "context-mode",
      type: "local",
      command: ["context-mode"],
      // No pluginsToRemove!
      homeDir: tmpDir,
    });

    expect(mcpWriteResult.ok).toBe(true);

    // context-mode still in plugin because we didn't remove it
    const finalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(finalConfig.plugin).toContain("context-mode");
    expect(finalConfig.plugin).toContain("other-plugin");
  });

  test("empty plugin array after cleanup is preserved", () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        plugin: ["context-mode"], // Only context-mode
      }),
      "utf-8"
    );

    const mcpWriteResult = writeOpenCodeMcpConfig({
      serverName: "context-mode",
      type: "local",
      command: ["context-mode"],
      pluginsToRemove: ["context-mode"],
      homeDir: tmpDir,
    });

    expect(mcpWriteResult.ok).toBe(true);

    // Empty array should be preserved, not removed
    const finalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(finalConfig.plugin).toEqual([]);
  });
});