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
          "  npm:@dreki-gg/pi-context7",
          "    /some/path/pi-context7",
        ].join("\n"),
      }),
      commandExists: (command) => command === "rtk" || command === "codebase-memory-mcp",
    });

    expect(result.installedPackages).toEqual(["@dreki-gg/pi-context7", "rtk", "codebase-memory-mcp"]);
    expect(result.requiredTools.find((tool) => tool.name === "RTK")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "codebase-memory")?.installed).toBe(true);
    expect(result.requiredTools.find((tool) => tool.name === "Context7")?.installed).toBe(true);
    expect(result.tools.find((tool) => tool.name === "RTK")).toEqual({
      name: "RTK",
      available: "found",
      configured: "configured",
      ready: "ready",
    });
  });

  test("does not require pi-subagents or pi-mcp-adapter on a clean machine", () => {
    const result = reviewPiRequiredTools({ command: "pi", runCommand: () => ({ exitCode: 0, stdout: "No packages installed." }), commandExists: () => false });
    const names = result.requiredTools.map((tool) => tool.name);
    expect(names).not.toContain("sub-agents");
    expect(names).not.toContain("MCP packages");
    expect(names).toEqual(["context-mode", "codebase-memory", "RTK", "Context7"]);
  });

  test("an installed pi-subagents / pi-mcp-adapter is not reported as a satisfied or missing requirement", () => {
    const result = reviewPiRequiredTools({
      command: "pi",
      runCommand: () => ({ exitCode: 0, stdout: "User packages:\n  npm:pi-subagents\n  npm:pi-mcp-adapter\n" }),
      commandExists: () => false,
    });
    expect(result.requiredTools.map((tool) => tool.name)).not.toContain("sub-agents");
    expect(result.requiredTools.map((tool) => tool.name)).not.toContain("MCP packages");
    // They are still visible to diagnostics through installedPackages.
    expect(result.installedPackages).toEqual(["pi-subagents", "pi-mcp-adapter"]);
  });

  test("RTK and Codebase Memory are detected through Deck-owned tools, not PATH", () => {
    const owned = { rtk: { command: () => "/data/deck/pi/tools/rtk/rtk" }, codebase: { command: () => "/data/deck/pi/tools/codebase/codebase-memory-mcp" } };
    const withOwned = reviewPiRequiredTools({ command: "pi", runCommand: () => ({ exitCode: 0, stdout: "No packages installed." }), commandExists: () => false, piTools: owned });
    expect(withOwned.requiredTools.find((tool) => tool.name === "RTK")?.installed).toBe(true);
    expect(withOwned.requiredTools.find((tool) => tool.name === "codebase-memory")?.installed).toBe(true);

    const pathOnly = reviewPiRequiredTools({ command: "pi", runCommand: () => ({ exitCode: 0, stdout: "No packages installed." }), commandExists: (command) => command === "rtk" || command === "codebase-memory-mcp", piTools: { rtk: { command: () => undefined }, codebase: { command: () => undefined } } });
    expect(pathOnly.requiredTools.find((tool) => tool.name === "RTK")?.installed).toBe(false);
    expect(pathOnly.requiredTools.find((tool) => tool.name === "codebase-memory")?.installed).toBe(false);
  });
});
