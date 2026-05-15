import { describe, expect, test } from "bun:test";

import { reviewPiRequiredTools } from "./required-tools";

describe("reviewPiRequiredTools", () => {
  test("parses real pi list package source blocks", () => {
    const result = reviewPiRequiredTools({
      command: "pi",
      runCommand: () => ({
        exitCode: 0,
        stdout: [
          "User packages:",
          "  npm:pi-subagents",
          "    /some/path/pi-subagents",
          "  npm:pi-mcp-adapter",
          "    /some/path/pi-mcp-adapter",
        ].join("\n"),
      }),
      commandExists: (command) => command === "rtk" || command === "codebase-memory-mcp" || command === "engram",
    });

    expect(result.installedPackages).toEqual(["pi-subagents", "pi-mcp-adapter", "rtk", "codebase-memory-mcp", "engram"]);
    expect(result.requiredTools.find((tool) => tool.name === "sub-agents")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "MCP packages")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "RTK")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "codebase-memory")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "Engram memory")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "Context7")?.installed).toBe(false);
    expect(result.tools.find((tool) => tool.name === "RTK")).toEqual({
      name: "RTK",
      available: "found",
      configured: "configured",
      ready: "ready",
    });
    expect(result.tools.find((tool) => tool.name === "Context7")).toEqual({
      name: "Context7",
      available: "missing",
      configured: "missing",
      ready: "missing",
    });
  });
});
