import { describe, expect, test } from "bun:test";

import { reviewOpenCodeTools } from "./required-tools";

describe("reviewOpenCodeTools", () => {
  test("detects OpenCode packages from the config package manifest", () => {
    const result = reviewOpenCodeTools({
      packageManifest: "/home/tester/.config/opencode/package.json",
      commandExists: (command) => command === "codebase-memory-mcp" || command === "engram",
      pathExists: () => true,
      readFile: () => JSON.stringify({ dependencies: { "context-mode": "^1.0.0" } }),
    });

    expect(result.installedPackages).toEqual(["context-mode", "codebase-memory-mcp", "engram"]);
    expect(result.tools).toEqual([
      { name: "RTK", installed: false },
      { name: "context-mode", installed: true },
      { name: "codebase-memory", installed: true },
      { name: "Context7", installed: false },
      { name: "Engram memory", installed: true },
    ]);
    expect(result.toolStatuses.find((tool) => tool.name === "context-mode")).toEqual({
      name: "context-mode",
      available: "found",
      configured: "configured",
      ready: "ready",
    });
  });

  test("detects tools configured in opencode.json MCP and plugin sections", () => {
    const result = reviewOpenCodeTools({
      packageManifest: "/home/tester/.config/opencode/package.json",
      configPath: "/home/tester/.config/opencode/opencode.json",
      commandExists: (command) => command === "rtk" || command === "engram",
      pathExists: (path) => path.endsWith("package.json") || path.endsWith("opencode.json"),
      readFile: (path) => {
        if (path.endsWith("package.json")) return JSON.stringify({ dependencies: {} });
        return JSON.stringify({
          mcp: {
            "codebase-memory": {},
            "context-mode": {},
            context7: {},
            engram: {},
          },
          plugin: ["context-mode"],
        });
      },
    });

    expect(result.tools).toEqual([
      { name: "RTK", installed: true },
      { name: "context-mode", installed: true },
      { name: "codebase-memory", installed: true },
      { name: "Context7", installed: true },
      { name: "Engram memory", installed: true },
    ]);
  });

  test("reports missing tools when package manifest is missing", () => {
    const result = reviewOpenCodeTools({
      packageManifest: "/missing/package.json",
      pathExists: () => false,
    });

    expect(result.installedPackages).toEqual([]);
    expect(result.error).toBe("OpenCode package manifest not found.");
    expect(result.tools.every((tool) => !tool.installed)).toBe(true);
  });
});
