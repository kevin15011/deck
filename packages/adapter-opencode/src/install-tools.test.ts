import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import { installOpenCodeTools, commandExistsInPath } from "./install-tools";
import type { InstallableOpenCodeTool } from "./installation-plan";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("installOpenCodeTools", () => {
  test("executes npm install -g for npm-package-plus-mcp and does NOT write to plugin array", async () => {
    // Create a temp config file
    const tmpDir = join("/tmp", `deck-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const originalHome = process.env.HOME;

    try {
      mkdirSync(tmpDir, { recursive: true });
      // installOpenCodePlugin uses join(homeDir, ".config", "opencode", "opencode.json")
      const configDir = join(tmpDir, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const configPath = join(configDir, "opencode.json");
      writeFileSync(configPath, JSON.stringify({}), "utf-8");

      const plan: InstallableOpenCodeTool[] = [
        { id: "context-mode", name: "context-mode", module: "context-mode", required: false, installKind: "npm-package-plus-mcp" },
      ];

      // Patch the home dir to use temp dir by setting HOME env
      process.env.HOME = tmpDir;

      const results = await installOpenCodeTools(
        "opencode",
        plan,
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      );

      expect(results[0].success).toBe(true);
      expect(results[0].message).toBeUndefined();

      // Verify no plugin was added (MCP-only installation)
      const content = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.plugin).toBeUndefined();
    } finally {
      // Restore HOME even if test fails
      if (originalHome !== undefined) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
      // Cleanup temp dir completely
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
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

  describe("python-tool (serena)", () => {
    test("skips serena when python3 is missing", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "uv" || cmd === "pipx";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Python3 is not installed");
    });

    test("succeeds when serena already exists in PATH", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "python3" || cmd === "serena";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Serena found in PATH");
    });

    test("installs via uv and verifies success", async () => {
      let callCount = 0;
      const mockCommandExists = (cmd: string): boolean => {
        if (cmd === "python3" || cmd === "uv") return true;
        if (cmd === "serena") {
          callCount++;
          return callCount > 1;
        }
        return false;
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "Installed serena", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("installed via uv");
    });

    test("fails when uv install succeeds but serena not in PATH", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "python3" || cmd === "uv";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "Installed serena", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found in PATH");
    });

    test("skips when neither uv nor pipx exists", async () => {
      const mockCommandExists = (cmd: string): boolean => {
        return cmd === "python3";
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("neither");
    });

    test("installs via pipx when uv not available", async () => {
      let callCount = 0;
      const mockCommandExists = (cmd: string): boolean => {
        if (cmd === "python3" || cmd === "pipx") return true;
        if (cmd === "serena") {
          callCount++;
          return callCount > 1;
        }
        return false;
      };

      const [result] = await installOpenCodeTools(
        "opencode",
        [{ id: "serena", name: "Serena", module: "oraios/serena", required: false, installKind: "python-tool" }],
        () => {},
        async () => ({ exitCode: 0, stdout: "Installed serena", stderr: "" }),
        { commandExists: mockCommandExists },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("installed via pipx");
    });
  });
});
