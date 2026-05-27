import { describe, expect, test } from "bun:test";

import { installOpenCodeTools } from "./install-tools";
import type { InstallableOpenCodeTool } from "./installation-plan";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("installOpenCodeTools", () => {
  test("writes opencode-plugin to plugin array in opencode.json", async () => {
    // Create a temp config file
    const tmpDir = join("/tmp", `deck-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    // installOpenCodePlugin uses join(homeDir, ".config", "opencode", "opencode.json")
    const configDir = join(tmpDir, ".config", "opencode");
    mkdirSync(configDir, { recursive: true });
    const configPath = join(configDir, "opencode.json");
    writeFileSync(configPath, JSON.stringify({}), "utf-8");

    const plan: InstallableOpenCodeTool[] = [
      { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "opencode-plugin" },
    ];

    // Patch the home dir to use temp dir by setting HOME env
    const originalHome = process.env.HOME;
    process.env.HOME = tmpDir;

    const results = await installOpenCodeTools(
      "opencode",
      plan,
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    process.env.HOME = originalHome;

    expect(results[0].success).toBe(true);
    expect(results[0].message).toContain("Added 'context-mode' to plugin array");

    // Verify the plugin was added
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.plugin).toContain("context-mode");

    // Cleanup
    unlinkSync(configPath);
  });

  test("returns failure for external tools", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "rtk", name: "RTK", module: "rtk-ai/rtk", required: false, installKind: "external" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Manual install required from rtk-ai/rtk.");
  });

  test("skips mcp-server tools with informational message", async () => {
    const [result] = await installOpenCodeTools(
      "opencode",
      [{ id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "mcp-server" }],
      () => {},
      async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("MCP server configured via write-mcp-config action");
  });
});
