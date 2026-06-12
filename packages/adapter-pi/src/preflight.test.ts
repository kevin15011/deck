import { describe, expect, test } from "bun:test";

import { inspectPiEnvironment } from "./preflight";

describe("inspectPiEnvironment", () => {
  test("reads Pi version from stderr and detects the Pi agent config directory", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent",
    });

    expect(result).toEqual({
      version: "0.74.0",
      configDirectory: "/home/tester/.pi/agent",
      existingConfiguration: true,
    });
  });
});

// Preflight checks tests (TDD first - failing tests before implementation)
describe("inspectPiEnvironment with structured checks", () => {
  test("returns structured checks when includeChecks is enabled", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent/mcp.json",
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    expect(result.checks).toBeDefined();
    expect(result.checks!.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
  });

  test("fails MCP config persistence check when config missing", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const mcpCheck = result.checks!.find((c) => c.id === "mcp-config-persistence");
    expect(mcpCheck?.status).toBe("fail");
    expect(mcpCheck?.severity).toBe("error");
  });

  test("detects stale package replacement check", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) =>
        path === "/home/tester/.pi/agent" ||
        path === "/home/tester/.pi/agent/settings.json",
      readDir: () => [],
      readFile: (path) => {
        if (path.includes("settings.json")) {
          return JSON.stringify({ packages: [{ name: "@dreki-gg/pi-context7" }] });
        }
        return "";
      },
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const staleCheck = result.checks!.find((c) => c.id === "stale-package-replacement");
    expect(staleCheck?.status).toBe("warn");
    expect(staleCheck?.diagnostics).toContain("Found stale package: @dreki-gg/pi-context7");
  });

  test("detects nested skills cleanup check", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) =>
        path === "/home/tester/.pi/skills" ||
        path === "/home/tester/.pi/skills/my-skill/SKILL.md/SKILL.md",
      readDir: (path) => (path === "/home/tester/.pi/skills" ? ["my-skill"] : []),
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const nestedCheck = result.checks!.find((c) => c.id === "nested-skills-cleanup");
    expect(nestedCheck?.status).toBe("warn");
  });

  test("detects legacy SDD cleanup check", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "", stderr: "0.74.0\n" }),
      pathExists: (path) => path === "/home/tester/.pi/agent" || path === "/home/tester/.pi/skills",
      readDir: (path) =>
        path === "/home/tester/.pi/agent" ? ["sdd-agent.md"] : [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const legacyCheck = result.checks!.find((c) => c.id === "legacy-sdd-cleanup");
    expect(legacyCheck?.status).toBe("warn");
  });

  test("fails shared binary usability check when version unknown", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 1, stdout: "", stderr: "command not found" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const binaryCheck = result.checks!.find((c) => c.id === "shared-binary-usability");
    expect(binaryCheck?.status).toBe("fail");
    expect(binaryCheck?.severity).toBe("error");
  });

  test("computes summary with failed/warnings counts", () => {
    const result = inspectPiEnvironment({
      command: "pi",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    expect(result.summary?.ready).toBe(false);
    expect(result.summary?.failed).toBeGreaterThan(0);
  });
});
