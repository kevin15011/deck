import { describe, expect, test } from "bun:test";

import { inspectOpenCodeEnvironment } from "./preflight";

describe("inspectOpenCodeEnvironment", () => {
  test("detects OpenCode version and config package manifest", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "1.14.48\n" }),
      pathExists: (path) => path === "/home/tester/.config/opencode" || path === "/home/tester/.config/opencode/package.json",
    });

    expect(result).toEqual({
      version: "1.14.48",
      configDirectory: "/home/tester/.config/opencode",
      packageManifest: "/home/tester/.config/opencode/package.json",
      existingConfiguration: true,
    });
  });

  test("reports unknown version when OpenCode version command fails", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 1, stdout: "", stderr: "failed" }),
      pathExists: () => false,
    });

    expect(result.version).toBe("unknown");
    expect(result.existingConfiguration).toBe(false);
  });
});

// Preflight checks tests (TDD first - failing tests before implementation)
describe("inspectOpenCodeEnvironment with structured checks", () => {
  test("returns structured checks when includeChecks is enabled", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "1.14.48\n" }),
      pathExists: (path) => path === "/home/tester/.config/opencode/package.json",
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    expect(result.checks).toBeDefined();
    expect(result.checks!.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
  });

  test("fails config manifest presence check when missing", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "1.14.48\n" }),
      pathExists: () => false,
      readDir: () => [],
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const manifestCheck = result.checks!.find((c) => c.id === "config-manifest-presence");
    expect(manifestCheck?.status).toBe("warn");
    expect(manifestCheck?.severity).toBe("warning");
  });

  test("detects nested skills cleanup check", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "1.14.48\n" }),
      pathExists: (path) =>
        path === "/home/tester/.opencode/skills" ||
        path === "/home/tester/.opencode/skills/my-skill/SKILL.md/SKILL.md",
      readDir: (path) => (path === "/home/tester/.opencode/skills" ? ["my-skill"] : []),
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const nestedCheck = result.checks!.find((c) => c.id === "nested-skills-cleanup");
    expect(nestedCheck?.status).toBe("warn");
  });

  test("detects legacy SDD cleanup check", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
      homeDirectory: "/home/tester",
      runCommand: () => ({ exitCode: 0, stdout: "1.14.48\n" }),
      pathExists: (path) => path === "/home/tester/.opencode",
      readDir: (path) => (path === "/home/tester/.opencode" ? ["sdd-agent.md"] : []),
      readFile: () => "",
      getStat: () => ({ isDirectory: () => false, isFile: () => true }),
      includeChecks: true,
    });

    const legacyCheck = result.checks!.find((c) => c.id === "legacy-sdd-cleanup");
    expect(legacyCheck?.status).toBe("warn");
  });

  test("fails shared binary usability check when version unknown", () => {
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
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
    const result = inspectOpenCodeEnvironment({
      command: "opencode",
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
